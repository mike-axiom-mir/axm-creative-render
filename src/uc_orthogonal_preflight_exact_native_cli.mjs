#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runUniversalCreationOrthogonalPreflightExact } from "./uc_orthogonal_preflight_exact_native_bridge.mjs";

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
    throw new Error("usage: uc_orthogonal_preflight_exact_native_cli.mjs build --uc-root PATH --uc-revision SHA --source-scene FILE --blocked-scene FILE --accepted-scene FILE --receipt FILE");
  }
  for (const key of ["uc-root", "uc-revision", "source-scene", "blocked-scene", "accepted-scene", "receipt"]) {
    if (!parsed[key]) throw new Error(`missing --${key}`);
  }

  const result = await runUniversalCreationOrthogonalPreflightExact(parsed["uc-root"], { ucRevision: parsed["uc-revision"] });
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

  console.log("uc_orthogonal_preflight_exact_native=PASS");
  console.log(`blocked_reason=${result.receipt.exact_orthogonal_block.reason}`);
  console.log(`near_caller_direction_x=${result.receipt.near_orthogonal_rounding_boundary.caller_direction_x}`);
  console.log(`near_presentation_direction_x=${result.receipt.near_orthogonal_rounding_boundary.presentation_direction_x}`);
  console.log(`near_delegated=${result.receipt.near_orthogonal_rounding_boundary.guard_accepted}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
