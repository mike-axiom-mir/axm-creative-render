#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { observeVisualEffectBranchFlowGuidedNative } from "./vfx_branch_flow_guided_native_bridge.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { out._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a._[0] !== "build") throw new Error("expected build command");
  const required = [
    "vfx-root", "vfx-revision",
    "zero-growth-source", "active-growth-source",
    "zero-network", "active-network",
    "zero-field-source", "active-field-source",
    "zero-flow-source", "active-flow-source",
    "zero-guidance-source", "active-guidance-source",
    "zero-curve-set", "active-curve-set",
    "zero-svg", "active-svg",
    "zero-state", "active-state",
    "zero-scene", "active-scene",
    "receipt",
  ];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectBranchFlowGuidedNative(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["zero-growth-source"], result.zeroGrowthSourceBytes],
    [a["active-growth-source"], result.activeGrowthSourceBytes],
    [a["zero-network"], result.zeroNetworkBytes],
    [a["active-network"], result.activeNetworkBytes],
    [a["zero-field-source"], result.zeroFieldSourceBytes],
    [a["active-field-source"], result.activeFieldSourceBytes],
    [a["zero-flow-source"], result.zeroFlowSourceBytes],
    [a["active-flow-source"], result.activeFlowSourceBytes],
    [a["zero-guidance-source"], result.zeroGuidanceSourceBytes],
    [a["active-guidance-source"], result.activeGuidanceSourceBytes],
    [a["zero-curve-set"], result.zeroCurveSetBytes],
    [a["active-curve-set"], result.activeCurveSetBytes],
    [a["zero-svg"], result.zeroSvgBytes],
    [a["active-svg"], result.activeSvgBytes],
    [a["zero-state"], result.zeroStateBytes],
    [a["active-state"], result.activeStateBytes],
    [a["zero-scene"], result.zeroSceneBytes],
    [a["active-scene"], result.activeSceneBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];

  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_branch_flow_guided_native=PASS");
  for (const [name, row] of Object.entries(result.receipt.variants)) {
    console.log(`${name}_growth_source_hash=${row.growth_source.hash}`);
    console.log(`${name}_network_hash=${row.network.hash}`);
    console.log(`${name}_flow_source_hash=${row.flow_source.hash}`);
    console.log(`${name}_guidance_source_hash=${row.guidance_source.hash}`);
    console.log(`${name}_curve_set_hash=${row.curve_set.hash}`);
    console.log(`${name}_max_offset=${row.curve_set.max_offset_magnitude}`);
    console.log(`${name}_svg_sha256=${row.donor_svg.bytes_sha256}`);
    console.log(`${name}_scene_sha256=${row.native_scene.bytes_sha256}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
