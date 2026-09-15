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
  for (const key of ["bridge-receipt", "project", "render-receipt", "repeat", "verify-render", "video", "ffmpeg-evidence", "out"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

async function json(path, label) {
  let value;
  try { value = JSON.parse((await readFile(path)).toString("utf8")); }
  catch (error) { throw new Error(`${label} must be valid JSON: ${error.message}`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}
async function write(path, bytes) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: "w" }); }

try {
  const args = parseArgs(process.argv.slice(2));
  const bridgeReceiptPath = resolve(args["bridge-receipt"]);
  const projectPath = resolve(args.project);
  const renderReceiptPath = resolve(args["render-receipt"]);
  const repeatPath = resolve(args.repeat);
  const verifyRenderPath = resolve(args["verify-render"]);
  const videoPath = resolve(args.video);
  const ffmpegEvidencePath = resolve(args["ffmpeg-evidence"]);
  const outPath = resolve(args.out);

  const [bridgeReceiptBytes, projectBytes, renderReceiptBytes, repeatBytes, verifyBytes, videoBytes, ffmpegEnvironmentBytes] = await Promise.all([
    readFile(bridgeReceiptPath),
    readFile(projectPath),
    readFile(renderReceiptPath),
    readFile(repeatPath),
    readFile(verifyRenderPath),
    readFile(videoPath),
    readFile(ffmpegEvidencePath),
  ]);
  if (ffmpegEnvironmentBytes.length === 0) throw new Error("FFmpeg environment evidence is empty");
  const ffmpegEnvironmentText = ffmpegEnvironmentBytes.toString("utf8");
  if (!ffmpegEnvironmentText.includes("resolved_executable=") || !ffmpegEnvironmentText.includes("package_version=")) {
    throw new Error("FFmpeg environment evidence is incomplete");
  }

  const [bridge, renderReceipt, repeat, verify] = await Promise.all([
    json(bridgeReceiptPath, "FrameState bridge receipt"),
    json(renderReceiptPath, "FrameState render receipt"),
    json(repeatPath, "FrameState repeat verification"),
    json(verifyRenderPath, "FrameState render-output verification"),
  ]);

  if (bridge.contract !== "AXM_CREATIVE_FRAMESTATE_PROJECT_RECEIPT" || bridge.version !== 1) throw new Error("unsupported FrameState bridge receipt");
  if (bridge.project_sha256 !== sha256(projectBytes)) throw new Error("FrameState project bytes do not match bridge receipt");
  if (!String(renderReceipt.schema ?? "").startsWith("axm.framestate.render-receipt/")) throw new Error("unsupported FrameState render receipt schema");
  if (renderReceipt.assembly?.requested !== true || renderReceipt.assembly?.attempted !== true || renderReceipt.assembly?.succeeded !== true) {
    throw new Error("FrameState video assembly did not succeed");
  }
  if (!renderReceipt.video || typeof renderReceipt.video.digest !== "string") throw new Error("FrameState render receipt has no video digest");
  const videoHash = `sha256:${sha256(videoBytes)}`;
  if (renderReceipt.video.digest !== videoHash) throw new Error("FrameState video bytes do not match render receipt");
  if (repeat.passed !== true) throw new Error("FrameState repeat verification did not pass");
  if (verify.verified !== true || verify.authority !== "EVIDENCE_ADMISSION_ONLY") throw new Error("FrameState render-output verification did not pass with evidence-only authority");
  if (verify.receipt_digest !== renderReceipt.receipt_digest || verify.project_digest !== renderReceipt.project_digest) {
    throw new Error("FrameState read-only verification pins do not match the render receipt");
  }
  if (verify.video_digest !== videoHash) throw new Error("FrameState read-only verifier did not bind the same video bytes");
  if (verify.frame_count !== bridge.duration_frames) throw new Error("FrameState verified frame count does not match bridge duration");

  const evidence = {
    contract: "AXM_CREATIVE_FRAMESTATE_VIDEO_EVIDENCE",
    version: 1,
    bridge_receipt_sha256: sha256(bridgeReceiptBytes),
    project_sha256: sha256(projectBytes),
    framestate_render_receipt_sha256: sha256(renderReceiptBytes),
    framestate_receipt_digest: renderReceipt.receipt_digest,
    framestate_project_digest: renderReceipt.project_digest,
    framestate_repeat_verification_sha256: sha256(repeatBytes),
    framestate_repeat_passed: true,
    framestate_render_output_verification_sha256: sha256(verifyBytes),
    framestate_render_output_verification_digest: verify.verification_digest ?? null,
    framestate_authority: verify.authority,
    source_frame_count: bridge.frame_count,
    realized_frame_count: verify.frame_count,
    fps: bridge.fps,
    duration_seconds: bridge.duration_seconds,
    video_sha256: sha256(videoBytes),
    video_bytes: videoBytes.length,
    ffmpeg_boundary: {
      environment_sha256: sha256(ffmpegEnvironmentBytes),
      environment_text: ffmpegEnvironmentText.trim(),
      version: renderReceipt.assembly.version ?? null,
      profile: renderReceipt.assembly.profile ?? null,
      bit_exact_claim: renderReceipt.assembly.bit_exact_claim ?? false,
      installation_scope: "GitHub Actions proof runner only; FrameState keeps FFmpeg as an explicit optional external assembly boundary",
    },
    truth_boundary: {
      proves: [
        "the exact Creative Render source-frame sequence was admitted into one canonical FrameState project",
        "FrameState rendered the declared frame count and its own deterministic repeat verification passed in the exercised runtime",
        "FrameState's read-only verifier admitted the caller-pinned render evidence with EVIDENCE_ADMISSION_ONLY authority",
        "FrameState successfully assembled a playable MP4 whose exact bytes are bound here and in its render receipt",
        "the CI-only FFmpeg installation environment used for this assembly proof is retained as exact evidence",
      ],
      does_not_prove: [
        "bit-identical MP4 encoding across FFmpeg versions or machines",
        "that FFmpeg is bundled with or required by Creative Render outside this explicit proof path",
        "motion interpolation between the sparse source samples",
        "visual or cinematic quality",
        "native FrameState understanding of Universal Creation rig or Visual Effect Fabric semantics",
      ],
    },
  };
  const outBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await write(outPath, outBytes);
  console.log("framestate_video_evidence=PASS");
  console.log(`source_frame_count=${evidence.source_frame_count}`);
  console.log(`realized_frame_count=${evidence.realized_frame_count}`);
  console.log(`duration_seconds=${evidence.duration_seconds}`);
  console.log(`video_sha256=${evidence.video_sha256}`);
  console.log(`video_bytes=${evidence.video_bytes}`);
  console.log(`ffmpeg_environment_sha256=${evidence.ffmpeg_boundary.environment_sha256}`);
  console.log(`authority=${evidence.framestate_authority}`);
  console.log(`evidence_sha256=${sha256(outBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
