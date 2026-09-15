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
  for (const key of ["consensus-receipt", "bridge-receipt", "video-evidence", "out"]) if (!values[key]) throw new Error(`missing --${key}`);
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
  const consensusPath = resolve(args["consensus-receipt"]), bridgePath = resolve(args["bridge-receipt"]), videoPath = resolve(args["video-evidence"]), outPath = resolve(args.out);
  const [consensusBytes, bridgeBytes, videoBytes, consensus, bridge, video] = await Promise.all([
    readFile(consensusPath), readFile(bridgePath), readFile(videoPath),
    json(consensusPath, "temporal consensus receipt"), json(bridgePath, "FrameState bridge receipt"), json(videoPath, "FrameState video evidence"),
  ]);

  if (consensus.contract !== "AXM_CREATIVE_TEMPORAL_CONSENSUS_RECEIPT" || consensus.version !== 1) throw new Error("unsupported temporal consensus receipt");
  const observation = consensus.observation;
  if (observation?.repeat_verification !== "PASS") throw new Error("temporal consensus repeat verification did not pass");
  if (!(observation?.policy?.regionCount >= 3) || observation.policy.regionCount % 2 === 0) throw new Error("temporal consensus region count is invalid");
  if (observation.agreement_frame_count !== observation.frame_count - 1) throw new Error("not every non-reference frame passed the consensus agreement gate");
  if (!(observation.nonzero_consensus_frame_count >= 1)) throw new Error("temporal consensus proof has no non-zero motion consensus");
  if (!(observation.mean_improved_frame_count >= 1)) throw new Error("temporal consensus proof has no frame whose mean selected-region MSE improved");
  for (const row of observation.motion?.slice(1) ?? []) {
    if (row.agreement !== true) throw new Error(`frame ${row.index} lost consensus agreement`);
    if (!Array.isArray(row.region_tracks) || row.region_tracks.length !== observation.policy.regionCount) throw new Error(`frame ${row.index} has incomplete regional track evidence`);
    const representative = row.region_tracks[row.representative_region_index];
    if (!representative || representative.track_digest !== row.representative_track_digest) throw new Error(`frame ${row.index} representative is not one of the real Universal Creation track receipts`);
    if (representative.dx !== row.representative_dx || representative.dy !== row.representative_dy) throw new Error(`frame ${row.index} representative track values drifted`);
  }
  const requiredTrack = new Set(["creative.frame-finish.block-match-track"]);
  const requiredPost = new Set(["creative.frame-finish.stabilize-translation", "creative.frame-finish.difference-frame", "creative.frame-finish.motion-trail"]);
  for (const id of requiredTrack) if (!(observation.track_operation_ids ?? []).includes(id)) throw new Error(`missing consensus track operation ${id}`);
  for (const id of requiredPost) if (!(observation.post_operation_ids ?? []).includes(id)) throw new Error(`missing consensus post operation ${id}`);

  if (!Array.isArray(consensus.outputs) || !Array.isArray(consensus.source_frames) || consensus.outputs.length !== consensus.source_frames.length) throw new Error("temporal consensus frame binding is incomplete");
  if (bridge.contract !== "AXM_CREATIVE_FRAMESTATE_PROJECT_RECEIPT" || bridge.version !== 1) throw new Error("unsupported FrameState bridge receipt");
  if (!Array.isArray(bridge.source_frames) || bridge.source_frames.length !== consensus.outputs.length) throw new Error("FrameState source count does not match consensus output count");
  for (let index = 0; index < consensus.outputs.length; index += 1) {
    if (consensus.outputs[index]?.finished?.sha256 !== bridge.source_frames[index]?.sha256) throw new Error(`FrameState source frame ${index} is not the exact consensus-finished output`);
  }

  if (video.contract !== "AXM_CREATIVE_FRAMESTATE_VIDEO_EVIDENCE" || video.version !== 1) throw new Error("unsupported FrameState video evidence");
  if (video.source_frame_count !== consensus.outputs.length || video.source_frame_count !== bridge.frame_count) throw new Error("FrameState video source count drifted");
  if (video.framestate_repeat_passed !== true || video.framestate_authority !== "EVIDENCE_ADMISSION_ONLY") throw new Error("FrameState video evidence did not preserve repeat/evidence-only gates");
  if (!(video.video_bytes > 0) || typeof video.video_sha256 !== "string") throw new Error("FrameState video evidence does not bind a non-empty video");

  const evidence = {
    contract: "AXM_CREATIVE_TEMPORAL_CONSENSUS_VIDEO_EVIDENCE",
    version: 1,
    temporal_consensus_receipt_sha256: sha256(consensusBytes),
    universal_creation_entry_sha256: observation.entry_sha256 ?? null,
    universal_creation_hand_count: observation.hand_count ?? null,
    universal_creation_recipe_count: observation.recipe_count ?? null,
    track_flow_digest: observation.track_flow_digest ?? null,
    post_flow_digest: observation.post_flow_digest ?? null,
    repeat_verification: observation.repeat_verification,
    policy: observation.policy,
    region_selection: observation.region_selection,
    motion: observation.motion,
    agreement_frame_count: observation.agreement_frame_count,
    nonzero_consensus_frame_count: observation.nonzero_consensus_frame_count,
    mean_improved_frame_count: observation.mean_improved_frame_count,
    source_frame_sha256: consensus.source_frames.map((row) => row.sha256),
    stabilized_frame_sha256: consensus.outputs.map((row) => row.stabilized.sha256),
    finished_frame_sha256: consensus.outputs.map((row) => row.finished.sha256),
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
        "several independently selected spatial regions were each measured by the real Universal Creation block-match Hand",
        "the regional measurements stayed within the explicit disagreement bound on every non-reference proof frame",
        "the median is evidence only and stabilization consumed one actual receipt-bound Universal Creation track selected nearest that median",
        "the multi-region selection, track set, representative selection, stabilization and finished frame bytes repeated exactly for the same inputs and policy",
        "the exact consensus-finished hashes became the exact FrameState project source hashes before final video evidence admission",
      ],
      does_not_prove: [
        "optical flow, semantic tracking, global camera motion under parallax or independent object motion",
        "rotation, scale or perspective stabilization",
        "continuous interpolation or cinematic quality",
        "cross-machine bit-identical MP4 output",
      ],
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await write(outPath, bytes);
  console.log("temporal_consensus_video_evidence=PASS");
  console.log(`regions=${evidence.policy.regionCount}`);
  console.log(`agreement_frame_count=${evidence.agreement_frame_count}`);
  console.log(`nonzero_consensus_frame_count=${evidence.nonzero_consensus_frame_count}`);
  console.log(`mean_improved_frame_count=${evidence.mean_improved_frame_count}`);
  console.log(`video_sha256=${evidence.video_sha256}`);
  console.log(`evidence_sha256=${sha256(bytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
