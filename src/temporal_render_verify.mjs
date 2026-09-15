#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { sha256 } from "./creative_scene_operator.mjs";

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    values[key.slice(2)] = value;
  }
  for (const key of ["dir", "temporal-receipt", "out"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function bytes(path) {
  return readFile(path);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir);
  const temporalReceiptPath = resolve(args["temporal-receipt"]);
  const outPath = resolve(args.out);
  const temporalReceiptBytes = await bytes(temporalReceiptPath);
  const temporal = JSON.parse(temporalReceiptBytes.toString("utf8"));
  if (temporal.contract !== "AXM_CREATIVE_TEMPORAL_RECEIPT" || temporal.version !== 1) {
    throw new Error("unsupported temporal receipt");
  }
  if (!Array.isArray(temporal.outputs) || temporal.outputs.length < 2) throw new Error("temporal receipt has no usable output set");

  const frames = [];
  for (const row of temporal.outputs) {
    const sceneBytes = await bytes(join(dir, row.scene_file));
    const requestBytes = await bytes(join(dir, row.request_file));
    const outputBytes = await bytes(join(dir, row.output_file));
    const renderReceiptBytes = await bytes(join(dir, row.render_receipt_file));
    const sceneHash = sha256(sceneBytes);
    const requestHash = sha256(requestBytes);
    if (sceneHash !== row.scene_sha256) throw new Error(`scene hash mismatch for frame ${row.index}`);
    if (requestHash !== row.request_sha256) throw new Error(`request hash mismatch for frame ${row.index}`);
    if (outputBytes.length === 0) throw new Error(`empty renderer output for frame ${row.index}`);
    if (renderReceiptBytes.length === 0) throw new Error(`empty render receipt for frame ${row.index}`);
    frames.push({
      index: row.index,
      time: row.time,
      scene_sha256: sceneHash,
      request_sha256: requestHash,
      output_sha256: sha256(outputBytes),
      render_receipt_sha256: sha256(renderReceiptBytes),
      output_bytes: outputBytes.length,
    });
  }

  const distinctOutputs = new Set(frames.map((row) => row.output_sha256)).size;
  if (distinctOutputs !== frames.length) throw new Error("temporal render outputs are not all distinct");

  const evidence = {
    contract: "AXM_CREATIVE_TEMPORAL_RENDER_EVIDENCE",
    version: 1,
    temporal_receipt_sha256: sha256(temporalReceiptBytes),
    frame_count: frames.length,
    distinct_output_count: distinctOutputs,
    frames,
    truth_boundary: {
      proves: [
        "sampled Universal Creation animation states became distinct AXM_SCENE 1 bodies",
        "each sampled scene produced a non-empty Render Fabric output and render receipt",
        "the rendered frame bytes differ across the sampled times in this verified run",
      ],
      does_not_prove: [
        "video encoding",
        "continuous-time animation correctness between samples",
        "visual quality",
        "material, UV, rig, or animation semantic preservation through AXM_SCENE 1",
        "cross-machine bitwise determinism",
      ],
    },
  };
  const outBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, outBytes, { flag: "w" });
  console.log("temporal_render_evidence=PASS");
  console.log(`frame_count=${evidence.frame_count}`);
  console.log(`distinct_output_count=${evidence.distinct_output_count}`);
  for (const frame of frames) console.log(`frame_${frame.index}_output_sha256=${frame.output_sha256}`);
  console.log(`evidence_sha256=${sha256(outBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
