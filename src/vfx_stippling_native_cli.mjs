#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { observeVisualEffectStipplingNative } from "./vfx_stippling_native_bridge.mjs";

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
    "normal-stippling-source", "invert-stippling-source",
    "normal-point-set", "invert-point-set",
    "normal-svg", "invert-svg",
    "normal-state", "invert-state",
    "normal-scene", "invert-scene",
    "receipt",
  ];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectStipplingNative(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["normal-field-source"], result.normalFieldSourceBytes],
    [a["invert-field-source"], result.invertFieldSourceBytes],
    [a["normal-stippling-source"], result.normalStipplingSourceBytes],
    [a["invert-stippling-source"], result.invertStipplingSourceBytes],
    [a["normal-point-set"], result.normalPointSetBytes],
    [a["invert-point-set"], result.invertPointSetBytes],
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

  console.log("vfx_stippling_native=PASS");
  for (const [name, row] of Object.entries(result.receipt.variants)) {
    console.log(`${name}_field_source_hash=${row.field_source.hash}`);
    console.log(`${name}_stippling_source_hash=${row.stippling_source.hash}`);
    console.log(`${name}_point_set_hash=${row.point_set.hash}`);
    console.log(`${name}_point_count=${row.point_set.point_count}`);
    console.log(`${name}_svg_sha256=${row.donor_svg.bytes_sha256}`);
    console.log(`${name}_scene_sha256=${row.native_scene.bytes_sha256}`);
  }
  console.log(`shared_accepted_candidate_count=${result.receipt.comparison.shared_accepted_candidate_count}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
