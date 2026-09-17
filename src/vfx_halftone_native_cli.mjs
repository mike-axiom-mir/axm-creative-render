#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { observeVisualEffectHalftoneNative } from "./vfx_halftone_native_bridge.mjs";

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
    "normal-halftone-source", "invert-halftone-source",
    "normal-dot-set", "invert-dot-set",
    "normal-svg", "invert-svg",
    "normal-state", "invert-state",
    "normal-scene", "invert-scene",
    "receipt",
  ];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectHalftoneNative(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["normal-field-source"], result.normalFieldSourceBytes],
    [a["invert-field-source"], result.invertFieldSourceBytes],
    [a["normal-halftone-source"], result.normalHalftoneSourceBytes],
    [a["invert-halftone-source"], result.invertHalftoneSourceBytes],
    [a["normal-dot-set"], result.normalDotSetBytes],
    [a["invert-dot-set"], result.invertDotSetBytes],
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

  console.log("vfx_halftone_native=PASS");
  for (const [name, row] of Object.entries(result.receipt.variants)) {
    console.log(`${name}_field_source_hash=${row.field_source.hash}`);
    console.log(`${name}_halftone_source_hash=${row.halftone_source.hash}`);
    console.log(`${name}_dot_set_hash=${row.dot_set.hash}`);
    console.log(`${name}_dot_count=${row.dot_set.dot_count}`);
    console.log(`${name}_svg_sha256=${row.donor_svg.bytes_sha256}`);
    console.log(`${name}_scene_sha256=${row.native_scene.bytes_sha256}`);
  }
  console.log(`radius_difference_count=${result.receipt.comparison.radius_difference_count}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
