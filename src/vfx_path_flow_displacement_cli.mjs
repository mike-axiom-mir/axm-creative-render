#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { observeVisualEffectPathFlowDisplacement } from "./vfx_path_flow_displacement_bridge.mjs";

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
  const required = ["vfx-root", "vfx-revision", "source-paths", "zero-scene", "flowed-scene", "zero-state", "flowed-state", "receipt"];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectPathFlowDisplacement(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["source-paths"], result.sourcePathsBytes],
    [a["zero-scene"], result.zeroSceneBytes],
    [a["flowed-scene"], result.activeSceneBytes],
    [a["zero-state"], result.zeroStateBytes],
    [a["flowed-state"], result.activeStateBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_path_flow_displacement_native=PASS");
  console.log(`source_path_hash=${result.receipt.shared_retained_sources.path_source_hash}`);
  console.log(`zero_path_set_hash=${result.receipt.zero_amplitude.path_set_hash}`);
  console.log(`flowed_path_set_hash=${result.receipt.active_flow.path_set_hash}`);
  console.log(`active_max_displacement=${result.receipt.active_flow.max_displacement}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
