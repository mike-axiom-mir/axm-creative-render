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
  for (const key of ["motion-receipt", "bridge-receipt", "video-evidence", "out"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function readJson(path, label) {
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
  const motionPath = resolve(args["motion-receipt"]);
  const bridgePath = resolve(args["bridge-receipt"]);
  const videoEvidencePath = resolve(args["video-evidence"]);
  const outPath = resolve(args.out);
  const [motionBytes, bridgeBytes, videoEvidenceBytes, motion, bridge, video] = await Promise.all([
    readFile(motionPath),
    readFile(bridgePath),
    readFile(videoEvidencePath),
    readJson(motionPath, "temporal motion receipt"),
    readJson(bridgePath, "FrameState bridge receipt"),
    readJson(videoEvidencePath, "FrameState video evidence"),
  ]);

  if (motion.contract !== "AXM_CREATIVE_TEMPORAL_MOTION_RECEIPT" || motion.version !== 1) throw new Error("unsupported temporal motion receipt");
  if (motion.observation?.repeat_verification !== "PASS") throw new Error("temporal motion repeat verification did not pass");
  if (!(motion.observation?.nonzero_track_count >= 1)) throw new Error("temporal motion proof contains no non-zero track");
  if (!(motion.observation?.strictly_improved_track_count >= 1)) throw new Error("temporal motion proof contains no region whose alignment error strictly improved");
  const requiredOperations = new Set([
    "creative.frame-finish.block-match-track",
    "creative.frame-finish.stabilize-translation",
    "creative.frame-finish.difference-frame",
    "creative.frame-finish.motion-trail",
  ]);
  const observedOperations = new Set(motion.observation?.operation_ids ?? []);
  for (const id of requiredOperations) if (!observedOperations.has(id)) throw new Error(`temporal motion proof is missing ${id}`);
  if (!Array.isArray(motion.outputs) || !Array.isArray(motion.source_frames) || motion.outputs.length !== motion.source_frames.length) throw new Error("temporal motion frame binding is incomplete");

  if (bridge.contract !== "AXM_CREATIVE_FRAMESTATE_PROJECT_RECEIPT" || bridge.version !== 1) throw new Error("unsupported FrameState bridge receipt");
  if (!Array.isArray(bridge.source_frames) || bridge.source_frames.length !== motion.outputs.length) throw new Error("FrameState source count does not match temporal motion output count");
  for (let index = 0; index < motion.outputs.length; index += 1) {
    if (motion.outputs[index]?.finished?.sha256 !== bridge.source_frames[index]?.sha256) throw new Error(`FrameState source frame ${index} is not the exact tracked/finished output`);
  }

  if (video.contract !== "AXM_CREATIVE_FRAMESTATE_VIDEO_EVIDENCE" || video.version !== 1) throw new Error("unsupported FrameState video evidence");
  if (video.source_frame_count !== motion.outputs.length || video.source_frame_count !== bridge.frame_count) throw new Error("FrameState video source count drifted");
  if (video.framestate_repeat_passed !== true || video.framestate_authority !== "EVIDENCE_ADMISSION_ONLY") throw new Error("FrameState video evidence did not preserve repeat/evidence-only gates");
  if (!(video.video_bytes > 0) || typeof video.video_sha256 !== "string") throw new Error("FrameState video evidence does not bind a non-empty video");

  const evidence = {
    contract: "AXM_CREATIVE_TEMPORAL_MOTION_VIDEO_EVIDENCE",
    version: 1,
    temporal_motion_receipt_sha256: sha256(motionBytes),
    universal_creation_entry_sha256: motion.observation.entry_sha256 ?? null,
    universal_creation_hand_count: motion.observation.hand_count ?? null,
    universal_creation_recipe_count: motion.observation.recipe_count ?? null,
    flow_digest: motion.observation.flow_digest ?? null,
    operation_ids: motion.observation.operation_ids ?? [],
    repeat_verification: motion.observation.repeat_verification,
    policy: motion.observation.policy,
    motion: motion.observation.motion,
    nonzero_track_count: motion.observation.nonzero_track_count,
    strictly_improved_track_count: motion.observation.strictly_improved_track_count,
    source_frame_sha256: motion.source_frames.map((row) => row.sha256),
    stabilized_frame_sha256: motion.outputs.map((row) => row.stabilized.sha256),
    finished_frame_sha256: motion.outputs.map((row) => row.finished.sha256),
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
        "real rendered frame samples entered Universal Creation block-match tracking through public Creative Flow",
        "at least one bounded translation track was non-zero and at least one tracked region had strictly lower MSE after translation stabilization",
        "the track, stabilization, residual-difference and aligned motion-trail path repeated exactly for the same explicit inputs and policy",
        "the exact tracked/finished output hashes became the FrameState project source hashes before the final MP4 evidence was admitted",
      ],
      does_not_prove: [
        "optical flow, semantic object tracking, perspective or camera solving",
        "rotation or scale stabilization beyond the translation Hand",
        "continuous-time interpolation between sampled states",
        "visual or cinematic quality",
        "cross-machine bit-identical MP4 output",
      ],
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await write(outPath, bytes);
  console.log("temporal_motion_video_evidence=PASS");
  console.log(`source_frame_count=${evidence.source_frame_count}`);
  console.log(`nonzero_track_count=${evidence.nonzero_track_count}`);
  console.log(`strictly_improved_track_count=${evidence.strictly_improved_track_count}`);
  console.log(`video_sha256=${evidence.video_sha256}`);
  console.log(`evidence_sha256=${sha256(bytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
