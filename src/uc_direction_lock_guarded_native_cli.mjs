#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runUniversalCreationGuardedDirectionLock } from "./uc_direction_lock_guarded_native_bridge.mjs";

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
  if (parsed._[0] !== "build") {
    throw new Error("usage: uc_direction_lock_guarded_native_cli.mjs build --uc-root PATH --uc-revision SHA --source-scene FILE --disabled-scene FILE --enabled-scene FILE --receipt FILE");
  }
  for (const key of ["uc-root", "uc-revision", "source-scene", "disabled-scene", "enabled-scene", "receipt"]) {
    if (!parsed[key]) throw new Error(`missing --${key}`);
  }

  const result = await runUniversalCreationGuardedDirectionLock(parsed["uc-root"], { ucRevision: parsed["uc-revision"] });
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

  console.log("uc_direction_lock_guarded_native=PASS");
  console.log(`disabled_core_contact=${result.receipt.disabled_branch.donor_core_contact_present}`);
  console.log(`enabled_core_contact=${result.receipt.enabled_branch.donor_core_contact_present}`);
  console.log(`enabled_projection_error=${result.receipt.enabled_branch.max_direction_lock_error_after_stabilization}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
