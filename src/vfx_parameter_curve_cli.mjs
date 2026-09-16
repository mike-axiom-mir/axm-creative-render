#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { observeVisualEffectParameterCurve } from "./vfx_parameter_curve_bridge.mjs";

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
    "vfx-root", "vfx-revision", "source", "samples-33", "samples-129", "state",
    "start-scene", "mid-scene", "end-scene", "receipt",
  ];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectParameterCurve(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a.source, result.sourceBytes],
    [a["samples-33"], result.samples33Bytes],
    [a["samples-129"], result.samples129Bytes],
    [a.state, result.stateBytes],
    [a["start-scene"], result.startSceneBytes],
    [a["mid-scene"], result.midSceneBytes],
    [a["end-scene"], result.endSceneBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_parameter_curve_native=PASS");
  console.log(`curve_source_hash=${result.receipt.canonical_source.hash}`);
  console.log(`samples_33_hash=${result.receipt.derived_sample_tables.sample_33.sample_set_hash}`);
  console.log(`samples_129_hash=${result.receipt.derived_sample_tables.sample_129.sample_set_hash}`);
  for (const sample of result.receipt.observations) console.log(`${sample.id}_value=${sample.value}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
