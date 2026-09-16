#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runUniversalCreationConstraintActivity } from "./uc_constraint_activity_native_bridge.mjs";

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) { out._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[++i];
    if (value == null || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

async function main() {
  const parsed = args(process.argv.slice(2));
  if (parsed._[0] !== "build") throw new Error("usage: uc_constraint_activity_native_cli.mjs build --uc-root PATH --uc-revision SHA --source-scene FILE --disabled-scene FILE --enabled-scene FILE --receipt FILE");
  for (const key of ["uc-root", "uc-revision", "source-scene", "disabled-scene", "enabled-scene", "receipt"]) {
    if (!parsed[key]) throw new Error(`missing --${key}`);
  }
  const result = await runUniversalCreationConstraintActivity(parsed["uc-root"], { ucRevision: parsed["uc-revision"] });
  const outputs = [
    [parsed["source-scene"], result.sourceSceneBytes],
    [parsed["disabled-scene"], result.disabledSceneBytes],
    [parsed["enabled-scene"], result.enabledSceneBytes],
    [parsed.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  console.log("uc_constraint_activity_native=PASS");
  console.log(`disabled_payload_translation=${result.receipt.disabled_branch.payload_translation_from_source}`);
  console.log(`enabled_payload_translation=${result.receipt.enabled_branch.payload_translation_from_source}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
