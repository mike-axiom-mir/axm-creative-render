#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { sha256 } from "./creative_scene_operator.mjs";

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    values[key.slice(2)] = value;
  }
  for (const key of ["finish-receipt", "bridge-receipt", "video-evidence", "out"]) if (!values[key]) throw new Error(`missing --${key}`);
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
  const finishPath = resolve(args["finish-receipt"]);
  const bridgePath = resolve(args["bridge-receipt"]);
  const videoEvidencePath = resolve(args["video-evidence"]);
  const outPath = resolve(args.out);
  const [finishBytes, bridgeBytes, videoEvidenceBytes] = await Promise.all([
    readFile(finishPath), readFile(bridgePath), readFile(videoEvidencePath),
  ]);
  const [finish, bridge, video] = await Promise.all([
    json(finishPath, "temporal finish receipt"),
    json(bridgePath, "FrameState bridge receipt"),
    json(videoEvidencePath, "FrameState video evidence"),
  ]);

  if (finish.contract !== "AXM_CREATIVE_TEMPORAL_FINISH_RECEIPT" || finish.version !== 1) throw new Error("unsupported temporal finish receipt");
  if (finish.observation?.repeat_verification !== "PASS") throw new Error("temporal finish repeat verification did not pass");
  if (finish.observation?.finishing_hand_id !== "creative.frame-finish.motion-trail") throw new Error("unexpected temporal finishing hand");
  if (!Array.isArray(finish.source_frames) || !Array.isArray(finish.outputs) || finish.outputs.length !== finish.source_frames.length) {
    throw new Error("temporal finish frame binding is incomplete");
  }
  if (bridge.contract !== "AXM_CREATIVE_FRAMESTATE_PROJECT_RECEIPT" || bridge.version !== 1) throw new Error("unsupported FrameState bridge receipt");
  if (!Array.isArray(bridge.source_frames) || bridge.source_frames.length !== finish.outputs.length) throw new Error("FrameState source-frame count does not match temporal finish output count");
  for (let index = 0; index < finish.outputs.length; index += 1) {
    if (finish.outputs[index].sha256 !== bridge.source_frames[index].sha256) {
      throw new Error(`FrameState source frame ${index} is not the exact temporal-finish output`);
    }
  }
  if (video.contract !== "AXM_CREATIVE_FRAMESTATE_VIDEO_EVIDENCE" || video.version !== 1) throw new Error("unsupported FrameState video evidence");
  if (video.source_frame_count !== finish.outputs.length || video.source_frame_count !== bridge.frame_count) {
    throw new Error("FrameState video evidence source-frame count drifted");
  }
  if (!(video.video_bytes > 0) || typeof video.video_sha256 !== "string") throw new Error("FrameState video evidence does not bind a non-empty video");
  if (video.framestate_repeat_passed !== true || video.framestate_authority !== "EVIDENCE_ADMISSION_ONLY") {
    throw new Error("FrameState video evidence did not preserve repeat/evidence-only gates");
  }

  const evidence = {
    contract: "AXM_CREATIVE_TEMPORAL_FINISH_VIDEO_EVIDENCE",
    version: 1,
    temporal_finish_receipt_sha256: sha256(finishBytes),
    universal_creation_entry_sha256: finish.observation.entry_sha256 ?? null,
    universal_creation_hand_count: finish.observation.hand_count ?? null,
    universal_creation_recipe_count: finish.observation.recipe_count ?? null,
    finishing_hand_id: finish.observation.finishing_hand_id,
    finishing_hand_digest: finish.observation.finishing_hand_digest ?? null,
    flow_digest: finish.observation.flow_digest ?? null,
    repeat_verification: finish.observation.repeat_verification,
    source_frame_sha256: finish.source_frames.map((row) => row.sha256),
    finished_frame_sha256: finish.outputs.map((row) => row.sha256),
    changed_frame_count: finish.observation.changed_frame_count,
    max_window: finish.observation.max_window,
    decay: finish.observation.decay,
    framestate_bridge_receipt_sha256: sha256(bridgeBytes),
    framestate_video_evidence_sha256: sha256(videoEvidenceBytes),
    source_frame_count: video.source_frame_count,
    realized_frame_count: video.realized_frame_count,
    fps: video.fps,
    duration_seconds: video.duration_seconds,
    video_sha256: video.video_sha256,
    video_bytes: video.video_bytes,
    framestate_authority: video.framestate_authority,
    truth_boundary: {
      proves: [
        "verified Render Fabric PPM frames can enter Universal Creation's public frame-finishing Hand through Creative Flow",
        "the finished PPM bytes repeat exactly for the same sequence and explicit policy in the exercised environment",
        "the exact finished frame bytes, not unverified substitutes, become the FrameState project's source frames",
        "FrameState repeat and evidence-only verification remain intact before the final MP4 evidence is admitted",
      ],
      does_not_prove: [
        "optical-flow quality, semantic tracking, or camera solving",
        "continuous animation between sparse source samples",
        "visual or cinematic quality",
        "cross-machine bitwise MP4 identity",
        "that frame finishing is required for every Creative Render pipeline",
      ],
    },
  };
  const outBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await write(outPath, outBytes);
  console.log("temporal_finish_video_evidence=PASS");
  console.log(`source_frame_count=${evidence.source_frame_count}`);
  console.log(`changed_frame_count=${evidence.changed_frame_count}`);
  console.log(`hand_count=${evidence.universal_creation_hand_count}`);
  console.log(`recipe_count=${evidence.universal_creation_recipe_count}`);
  console.log(`video_sha256=${evidence.video_sha256}`);
  console.log(`evidence_sha256=${sha256(outBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
