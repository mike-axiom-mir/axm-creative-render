#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { rasterizeElectricStateToPpm } from "./vfx_frame_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

function parseArgs(argv) {
  if (argv[0] !== "rasterize") throw new Error("only the 'rasterize' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["state", "vfx-receipt", "out", "receipt"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const statePath = resolve(args.state);
  const sourceReceiptPath = resolve(args["vfx-receipt"]);
  const outPath = resolve(args.out);
  const receiptPath = resolve(args.receipt);
  if (new Set([statePath, sourceReceiptPath, outPath, receiptPath]).size !== 4) {
    throw new Error("VFX raster source/output paths must be distinct");
  }

  const [stateBytes, sourceReceiptBytes] = await Promise.all([readFile(statePath), readFile(sourceReceiptPath)]);
  const sourceReceipt = JSON.parse(sourceReceiptBytes.toString("utf8"));
  if (sourceReceipt.contract !== "AXM_CREATIVE_VFX_SOURCE_RECEIPT" || sourceReceipt.version !== 1) {
    throw new Error("unsupported VFX source receipt");
  }
  if (sourceReceipt.outputs?.state?.sha256 !== sha256(stateBytes)) {
    throw new Error("VFX state bytes do not match their source receipt");
  }

  const width = args.width == null ? 320 : Number(args.width);
  const height = args.height == null ? 180 : Number(args.height);
  const first = rasterizeElectricStateToPpm(stateBytes, width, height);
  const second = rasterizeElectricStateToPpm(stateBytes, width, height);
  if (!first.ppmBytes.equals(second.ppmBytes) || first.evidence.output_ppm_sha256 !== second.evidence.output_ppm_sha256) {
    throw new Error("electric state raster repeat verification failed");
  }
  await write(outPath, first.ppmBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_RASTER_RECEIPT",
    version: 1,
    mode: "canonical-electric-path-state-to-ppm",
    repeat_verification: "PASS",
    source: {
      vfx_source_receipt_sha256: sha256(sourceReceiptBytes),
      graph_id: sourceReceipt.visual_effect_fabric?.graph_id ?? null,
      final_state_hash: sourceReceipt.visual_effect_fabric?.final_state_hash ?? null,
      state_sha256: sha256(stateBytes),
    },
    adapter: first.evidence,
    output: {
      media_type: "image/x-portable-pixmap; format=P6-rgb8",
      sha256: sha256(first.ppmBytes),
      bytes: first.ppmBytes.length,
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("vfx_state_raster=PASS");
  console.log(`graph=${receipt.source.graph_id}`);
  console.log(`path_count=${receipt.adapter.path_count}`);
  console.log(`segment_count=${receipt.adapter.segment_count}`);
  console.log(`ppm_sha256=${receipt.output.sha256}`);
  console.log(`repeat_verification=${receipt.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
