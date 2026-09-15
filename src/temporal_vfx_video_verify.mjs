#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { sha256 } from "./creative_scene_operator.mjs";

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["temporal-vfx-receipt", "bridge-receipt", "video-evidence", "out"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function json(path, label) {
  let value;
  try { value = JSON.parse((await readFile(path)).toString("utf8")); }
  catch (error) { throw new Error(`${label} must be valid JSON: ${error.message}`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const temporalPath = resolve(args["temporal-vfx-receipt"]);
  const bridgePath = resolve(args["bridge-receipt"]);
  const videoEvidencePath = resolve(args["video-evidence"]);
  const outPath = resolve(args.out);

  const [temporalBytes, bridgeBytes, videoBytes] = await Promise.all([
    readFile(temporalPath),
    readFile(bridgePath),
    readFile(videoEvidencePath),
  ]);
  const [temporal, bridge, video] = await Promise.all([
    json(temporalPath, "temporal VFX receipt"),
    json(bridgePath, "FrameState bridge receipt"),
    json(videoEvidencePath, "FrameState video evidence"),
  ]);

  if (temporal.contract !== "AXM_CREATIVE_TEMPORAL_VFX_RECEIPT" || temporal.version !== 1) throw new Error("unsupported temporal VFX receipt");
  if (temporal.observation?.repeat_verification !== "PASS") throw new Error("temporal VFX repeat verification did not pass");
  if (!Array.isArray(temporal.source_frames) || !Array.isArray(temporal.outputs) || temporal.outputs.length !== temporal.source_frames.length) {
    throw new Error("temporal VFX frame binding is incomplete");
  }
  if (temporal.observation?.changed_frame_count !== temporal.outputs.length) throw new Error("not every temporal VFX output changed its exact source frame");

  if (bridge.contract !== "AXM_CREATIVE_FRAMESTATE_PROJECT_RECEIPT" || bridge.version !== 1) throw new Error("unsupported FrameState bridge receipt");
  if (!Array.isArray(bridge.source_frames) || bridge.source_frames.length !== temporal.outputs.length) {
    throw new Error("FrameState source-frame count does not match temporal VFX output count");
  }
  for (let index = 0; index < temporal.outputs.length; index += 1) {
    if (temporal.outputs[index].composite_sha256 !== bridge.source_frames[index].sha256) {
      throw new Error(`FrameState source frame ${index} is not the exact temporal VFX composite output`);
    }
  }

  if (video.contract !== "AXM_CREATIVE_FRAMESTATE_VIDEO_EVIDENCE" || video.version !== 1) throw new Error("unsupported FrameState video evidence");
  if (video.source_frame_count !== temporal.outputs.length || video.source_frame_count !== bridge.frame_count) {
    throw new Error("FrameState video evidence source-frame count drifted");
  }
  if (!(video.video_bytes > 0) || typeof video.video_sha256 !== "string") throw new Error("FrameState video evidence does not bind a non-empty video");
  if (video.framestate_repeat_passed !== true || video.framestate_authority !== "EVIDENCE_ADMISSION_ONLY") {
    throw new Error("FrameState video evidence did not preserve repeat/evidence-only gates");
  }

  const rows = temporal.observation.frames ?? [];
  const evidence = {
    contract: "AXM_CREATIVE_TEMPORAL_VFX_VIDEO_EVIDENCE",
    version: 1,
    temporal_vfx_receipt_sha256: sha256(temporalBytes),
    frame_count: temporal.outputs.length,
    width: temporal.observation.width,
    height: temporal.observation.height,
    seed_policy: temporal.observation.policy,
    vfx_runtime_sha256: temporal.observation.donor_invariant?.vfx_runtime_sha256 ?? null,
    vfx_effect_module_sha256: temporal.observation.donor_invariant?.vfx_effect_module_sha256 ?? null,
    vfx_graph_id: temporal.observation.donor_invariant?.vfx_graph_id ?? null,
    vfx_graph_version: temporal.observation.donor_invariant?.vfx_graph_version ?? null,
    universal_creation_entry_sha256: temporal.observation.donor_invariant?.uc_entry_sha256 ?? null,
    universal_creation_hand_count: temporal.observation.donor_invariant?.uc_hand_count ?? null,
    universal_creation_recipe_count: temporal.observation.donor_invariant?.uc_recipe_count ?? null,
    source_frame_sha256: temporal.source_frames.map((row) => row.sha256),
    effect_state_hashes: rows.map((row) => row.vfx_final_state_hash),
    effect_raster_sha256: temporal.outputs.map((row) => row.effect_sha256),
    composite_frame_sha256: temporal.outputs.map((row) => row.composite_sha256),
    distinct_vfx_state_count: temporal.observation.distinct_vfx_state_count,
    distinct_effect_raster_count: temporal.observation.distinct_effect_raster_count,
    distinct_composite_frame_count: temporal.observation.distinct_composite_frame_count,
    changed_frame_count: temporal.observation.changed_frame_count,
    repeat_verification: temporal.observation.repeat_verification,
    framestate_bridge_receipt_sha256: sha256(bridgeBytes),
    framestate_video_evidence_sha256: sha256(videoBytes),
    source_frame_count: video.source_frame_count,
    realized_frame_count: video.realized_frame_count,
    fps: video.fps,
    duration_seconds: video.duration_seconds,
    video_sha256: video.video_sha256,
    video_bytes: video.video_bytes,
    framestate_authority: video.framestate_authority,
    truth_boundary: {
      proves: [
        "the exact temporal VFX composite frame hashes are the exact source hashes admitted into the FrameState project",
        "each composite is bound to one explicit VFX state/raster and one public Universal Creation composite flow",
        "FrameState repeat and evidence-only verification remain intact before the final MP4 evidence is admitted",
      ],
      does_not_prove: [
        "native Render Fabric effect passes or physical scene-light interaction",
        "continuous-time VFX simulation or interpolation between sparse effect samples",
        "visual/cinematic quality or artistic suitability",
        "cross-machine bitwise MP4 identity",
      ],
    },
  };

  const outBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await write(outPath, outBytes);
  console.log("temporal_vfx_video_evidence=PASS");
  console.log(`frame_count=${evidence.frame_count}`);
  console.log(`distinct_vfx_state_count=${evidence.distinct_vfx_state_count}`);
  console.log(`changed_frame_count=${evidence.changed_frame_count}`);
  console.log(`video_sha256=${evidence.video_sha256}`);
  console.log(`evidence_sha256=${sha256(outBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
