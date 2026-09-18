#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { observeVisualEffectPropagationFront } from "./vfx_propagation_front_native_bridge.mjs";

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
  const required = ["vfx-root", "vfx-revision", "phase-a-scene", "phase-b-scene", "donor-state", "receipt"];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectPropagationFront(a["vfx-root"], {
    vfxRevision: a["vfx-revision"],
    phaseA: a["phase-a"] === undefined ? undefined : Number(a["phase-a"]),
    phaseB: a["phase-b"] === undefined ? undefined : Number(a["phase-b"]),
    sampleCount: a["sample-count"] === undefined ? undefined : Number(a["sample-count"]),
  });
  const outputs = [
    [a["phase-a-scene"], result.phaseASceneBytes],
    [a["phase-b-scene"], result.phaseBSceneBytes],
    [a["donor-state"], result.donorStateBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_propagation_front_native=PASS");
  console.log(`retained_source_hash=${result.sourceHash}`);
  console.log(`phase_a_sample_set_hash=${result.phaseASampleSet.sampleSetHash}`);
  console.log(`phase_b_sample_set_hash=${result.phaseBSampleSet.sampleSetHash}`);
  console.log(`phase_a_scene_sha256=${result.receipt.outputs.phase_a_scene.sha256}`);
  console.log(`phase_b_scene_sha256=${result.receipt.outputs.phase_b_scene.sha256}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
