#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { observeVisualEffectPathBreakFragmentation } from "./vfx_path_break_fragmentation_bridge.mjs";

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
  const required = ["vfx-root", "vfx-revision", "source-paths", "zero-scene", "fragmented-scene", "zero-state", "fragmented-state", "receipt"];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectPathBreakFragmentation(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["source-paths"], result.sourcePathsBytes],
    [a["zero-scene"], result.zeroSceneBytes],
    [a["fragmented-scene"], result.activeSceneBytes],
    [a["zero-state"], result.zeroStateBytes],
    [a["fragmented-state"], result.activeStateBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_path_break_fragmentation_native=PASS");
  console.log(`source_path_hash=${result.receipt.caller_authority.source_path_hash}`);
  console.log(`zero_path_set_hash=${result.receipt.zero_break.path_set_hash}`);
  console.log(`fragmented_path_set_hash=${result.receipt.active_break.path_set_hash}`);
  console.log(`fragment_count=${result.receipt.active_break.path_set.fragment_count}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
