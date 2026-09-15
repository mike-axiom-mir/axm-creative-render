#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { executeElectricEffect } from "./vfx_frame_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

function parseArgs(argv) {
  if (argv[0] !== "export") throw new Error("only the 'export' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["vfx-root", "svg", "state", "receipt"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

function inside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !resolve(rel).startsWith("/"));
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const vfxRoot = resolve(args["vfx-root"]);
  const svgPath = resolve(args.svg);
  const statePath = resolve(args.state);
  const receiptPath = resolve(args.receipt);
  const seed = args.seed == null ? 20260915 : Number(args.seed);
  const outputs = [svgPath, statePath, receiptPath];
  if (new Set(outputs).size !== outputs.length) throw new Error("VFX export paths must be distinct");
  for (const path of outputs) if (inside(path, vfxRoot)) throw new Error("VFX export outputs may not be written inside the Visual Effect Fabric donor repository");

  const first = await executeElectricEffect(vfxRoot, seed);
  const second = await executeElectricEffect(vfxRoot, seed);
  if (
    first.observation.final_state_hash !== second.observation.final_state_hash ||
    first.observation.svg_sha256 !== second.observation.svg_sha256 ||
    !first.svgBytes.equals(second.svgBytes)
  ) throw new Error("VFX effect repeat verification failed");

  await write(svgPath, first.svgBytes);
  await write(statePath, first.stateBytes);
  const receipt = {
    contract: "AXM_CREATIVE_VFX_SOURCE_RECEIPT",
    version: 1,
    mode: "visual-effect-fabric-electric-svg",
    repeat_verification: "PASS",
    visual_effect_fabric: first.observation,
    outputs: {
      svg: { media_type: "image/svg+xml", sha256: sha256(first.svgBytes), bytes: first.svgBytes.length },
      state: { media_type: "application/json", sha256: sha256(first.stateBytes), bytes: first.stateBytes.length },
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);
  console.log("vfx_source_export=PASS");
  console.log(`graph=${receipt.visual_effect_fabric.graph_id}`);
  console.log(`path_count=${receipt.visual_effect_fabric.path_count}`);
  console.log(`svg_sha256=${receipt.outputs.svg.sha256}`);
  console.log(`repeat_verification=${receipt.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
