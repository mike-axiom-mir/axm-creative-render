#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { observeUniversalCreationTemporal, normalizeSampleTimes } from "./temporal_uc_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function usage() {
  console.error("usage: node src/temporal_cli.mjs sample --uc-root PATH --out-dir PATH --receipt PATH [--times 0,1,2]");
}

function parseArgs(argv) {
  if (argv[0] !== "sample") throw new Error("only the 'sample' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "out-dir", "receipt"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

function parseTimes(value) {
  if (value == null) return [0, 1, 2];
  return normalizeSampleTimes(String(value).split(",").map((part) => Number(part.trim())));
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

function requestBytes(sceneFile, outputFile) {
  return Buffer.from(
    [
      "# AXM Creative Render temporal sample.",
      "AXM_RENDER_REQUEST 1",
      `scene ${sceneFile}`,
      "backend axm.native.cpu.reference",
      "width 320",
      "height 180",
      "format ppm-rgb8",
      `output ${outputFile}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

try {
  const args = parseArgs(process.argv.slice(2));
  const ucRoot = resolve(args["uc-root"]);
  const outDir = resolve(args["out-dir"]);
  const receiptPath = resolve(args.receipt);
  const times = parseTimes(args.times);

  if (pathIsInside(ucRoot, outDir) || pathIsInside(ucRoot, receiptPath)) {
    throw new Error("temporal proof outputs may not be written inside the Universal Creation donor repository");
  }

  const first = await observeUniversalCreationTemporal(ucRoot, times);
  const second = await observeUniversalCreationTemporal(ucRoot, times);

  const firstSceneHashes = first.samples.map((sample) => sample.scene_sha256);
  const secondSceneHashes = second.samples.map((sample) => sample.scene_sha256);
  const repeatMatch =
    first.observation.baseline_flow_digest === second.observation.baseline_flow_digest &&
    JSON.stringify(firstSceneHashes) === JSON.stringify(secondSceneHashes) &&
    JSON.stringify(first.observation.samples.map((sample) => sample.flow_digest)) ===
      JSON.stringify(second.observation.samples.map((sample) => sample.flow_digest));
  if (!repeatMatch) throw new Error("temporal sampling repeat verification failed");

  await mkdir(outDir, { recursive: true });
  const outputs = [];
  for (let i = 0; i < first.samples.length; i += 1) {
    const sample = first.samples[i];
    const stem = `frame-${String(i).padStart(3, "0")}`;
    const sceneFile = `${stem}.axmscene`;
    const requestFile = `${stem}.axmrender`;
    const outputFile = `${stem}.ppm`;
    const renderReceiptFile = `${stem}.axmreceipt`;
    const renderRequestBytes = requestBytes(sceneFile, outputFile);
    await write(join(outDir, sceneFile), sample.scene_bytes);
    await write(join(outDir, requestFile), renderRequestBytes);
    outputs.push({
      index: i,
      time: sample.time,
      scene_file: sceneFile,
      scene_sha256: sample.scene_sha256,
      request_file: requestFile,
      request_sha256: sha256(renderRequestBytes),
      output_file: outputFile,
      render_receipt_file: renderReceiptFile,
    });
  }

  const receipt = {
    contract: "AXM_CREATIVE_TEMPORAL_RECEIPT",
    version: 1,
    mode: "universal-creation-animation-samples",
    repeat_verification: "PASS",
    observation: first.observation,
    outputs,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("temporal_sampling=PASS");
  console.log("repeat_verification=PASS");
  console.log(`hand_count=${receipt.observation.hand_count}`);
  console.log(`recipe_count=${receipt.observation.recipe_count}`);
  console.log(`sample_count=${receipt.observation.sample_count}`);
  console.log(`distinct_scene_count=${receipt.observation.distinct_scene_count}`);
  for (const output of outputs) console.log(`frame_${output.index}_scene_sha256=${output.scene_sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
