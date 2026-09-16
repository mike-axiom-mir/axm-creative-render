#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runUniversalCreationConstraintPreflightGuard } from "./uc_constraint_preflight_guard_native_bridge.mjs";

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
    throw new Error("usage: uc_constraint_preflight_guard_native_cli.mjs build --uc-root PATH --uc-revision SHA --source-scene FILE --blocked-scene FILE --accepted-scene FILE --receipt FILE");
  }
  for (const key of ["uc-root", "uc-revision", "source-scene", "blocked-scene", "accepted-scene", "receipt"]) {
    if (!parsed[key]) throw new Error(`missing --${key}`);
  }

  const result = await runUniversalCreationConstraintPreflightGuard(parsed["uc-root"], { ucRevision: parsed["uc-revision"] });
  const outputs = [
    [parsed["source-scene"], result.sourceSceneBytes],
    [parsed["blocked-scene"], result.blockedSceneBytes],
    [parsed["accepted-scene"], result.acceptedSceneBytes],
    [parsed.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("uc_constraint_preflight_guard_native=PASS");
  console.log(`blocked_reason=${result.receipt.blocked_branch.reason}`);
  console.log(`blocked_core_step=${result.receipt.blocked_branch.core_step_executed}`);
  console.log(`accepted_core_step=${result.receipt.accepted_branch.core_step_executed}`);
  console.log(`unsupported_distance_delegated=${result.receipt.unsupported_distance_branch.accepted}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
