#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { observeVisualEffectParticleFlowAdvection } from "./vfx_particle_flow_advection_bridge.mjs";

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
  const required = ["vfx-root", "vfx-revision", "source-particles", "zero-scene", "advected-scene", "zero-state", "advected-state", "receipt"];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectParticleFlowAdvection(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["source-particles"], result.sourceParticlesBytes],
    [a["zero-scene"], result.zeroSceneBytes],
    [a["advected-scene"], result.activeSceneBytes],
    [a["zero-state"], result.zeroStateBytes],
    [a["advected-state"], result.activeStateBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_particle_flow_advection_native=PASS");
  console.log(`source_particle_hash=${result.receipt.shared_retained_sources.particle_source_hash}`);
  console.log(`zero_particle_set_hash=${result.receipt.zero_step_size.particle_set_hash}`);
  console.log(`advected_particle_set_hash=${result.receipt.active_flow.particle_set_hash}`);
  console.log(`moved_particle_count=${result.receipt.active_flow.moved_particle_count}`);
  console.log(`active_max_step_distance=${result.receipt.active_flow.max_step_distance}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
