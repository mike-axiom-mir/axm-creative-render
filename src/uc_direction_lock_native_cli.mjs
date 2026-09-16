#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { runUniversalCreationDirectionLock } from "./uc_direction_lock_native_bridge.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "build") throw new Error("usage: uc_direction_lock_native_cli.mjs build --uc-root PATH --uc-revision SHA --source-scene PATH --locked-scene PATH --trace PATH --receipt PATH");
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = rest[++index];
    if (value == null || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  for (const required of ["uc-root", "uc-revision", "source-scene", "locked-scene", "trace", "receipt"]) {
    if (!options[required]) throw new Error(`missing --${required}`);
  }
  return options;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runUniversalCreationDirectionLock(args["uc-root"], {
    ucRevision: args["uc-revision"],
    steps: args.steps == null ? undefined : Number(args.steps),
    dt: args.dt == null ? undefined : Number(args.dt),
    gravityY: args["gravity-y"] == null ? undefined : Number(args["gravity-y"]),
    perpendicularImpulse: args["perpendicular-impulse"] == null ? undefined : Number(args["perpendicular-impulse"]),
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8");
  await Promise.all([
    write(args["source-scene"], result.sourceSceneBytes),
    write(args["locked-scene"], result.lockedSceneBytes),
    write(args.trace, result.traceBytes),
    write(args.receipt, receiptBytes),
  ]);
  const proof = result.receipt.composer;
  console.log("uc_direction_lock_native=PASS");
  console.log(`uc_revision=${result.receipt.donor.revision}`);
  console.log(`composer_version=${result.receipt.donor.constraint_composer_version}`);
  console.log(`physics_core_version=${result.receipt.donor.physics_core_version}`);
  console.log(`steps=${proof.steps}`);
  console.log(`final_checksum=${proof.final_checksum}`);
  console.log(`max_after_core_error=${proof.max_after_core_direction_lock_error}`);
  console.log(`max_after_stabilization_error=${proof.max_after_stabilization_direction_lock_error}`);
  console.log(`perpendicular_translation_delta=${proof.perpendicular_translation_delta}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
