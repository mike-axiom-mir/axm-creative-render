#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { observeVisualEffectHatchingNative } from "./vfx_hatching_native_bridge.mjs";

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
    "normal-field-source", "invert-field-source",
    "normal-flow-source", "invert-flow-source",
    "normal-hatching-source", "invert-hatching-source",
    "normal-stroke-set", "invert-stroke-set",
    "normal-svg", "invert-svg",
    "normal-state", "invert-state",
    "normal-scene", "invert-scene",
    "receipt",
  ];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectHatchingNative(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["normal-field-source"], result.normalFieldSourceBytes],
    [a["invert-field-source"], result.invertFieldSourceBytes],
    [a["normal-flow-source"], result.normalFlowSourceBytes],
    [a["invert-flow-source"], result.invertFlowSourceBytes],
    [a["normal-hatching-source"], result.normalHatchingSourceBytes],
    [a["invert-hatching-source"], result.invertHatchingSourceBytes],
    [a["normal-stroke-set"], result.normalStrokeSetBytes],
    [a["invert-stroke-set"], result.invertStrokeSetBytes],
    [a["normal-svg"], result.normalSvgBytes],
    [a["invert-svg"], result.invertSvgBytes],
    [a["normal-state"], result.normalStateBytes],
    [a["invert-state"], result.invertStateBytes],
    [a["normal-scene"], result.normalSceneBytes],
    [a["invert-scene"], result.invertSceneBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_hatching_native=PASS");
  for (const [name, row] of Object.entries(result.receipt.variants)) {
    console.log(`${name}_field_source_hash=${row.field_source.hash}`);
    console.log(`${name}_flow_source_hash=${row.flow_source.hash}`);
    console.log(`${name}_hatching_source_hash=${row.hatching_source.hash}`);
    console.log(`${name}_stroke_set_hash=${row.stroke_set.hash}`);
    console.log(`${name}_stroke_count=${row.stroke_set.stroke_count}`);
    console.log(`${name}_svg_sha256=${row.donor_svg.bytes_sha256}`);
    console.log(`${name}_scene_sha256=${row.native_scene.bytes_sha256}`);
  }
  console.log(`length_difference_count=${result.receipt.comparison.length_difference_count}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
