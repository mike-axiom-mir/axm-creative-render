import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectLightParticleLayerPlanNative } from "./vfx_light_particle_layer_native_bridge.mjs";

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[++i];
  }
  return out;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

const [command, ...rest] = process.argv.slice(2);
if (command !== "build") {
  console.error("usage: node src/vfx_light_particle_layer_native_cli.mjs build --vfx-root PATH --vfx-revision SHA --rays-under-scene PATH --particles-under-scene PATH --donor-state PATH --receipt PATH");
  process.exit(2);
}
const a = args(rest);
for (const key of ["vfx-root", "vfx-revision", "rays-under-scene", "particles-under-scene", "donor-state", "receipt"]) {
  if (!a[key]) throw new Error(`missing --${key}`);
}

const result = await observeVisualEffectLightParticleLayerPlanNative(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
const underBytes = result.scenes["rays-under-particles"].bytes;
const overBytes = result.scenes["particles-under-rays"].bytes;
const donorState = {
  schema: "axm.creative-render.vfx-light-particle-layer-native-donor-state/v1",
  visual_effect_fabric_revision: result.vfxRevision,
  lightRayState: result.lightState,
  particleFlowState: result.particleState,
  plans: result.plans,
};
const donorStateBytes = Buffer.from(`${JSON.stringify(donorState, null, 2)}\n`, "utf8");
const receipt = structuredClone(result.receipt);
receipt.outputs = {
  rays_under_scene: { sha256: sha256(underBytes), bytes: underBytes.length },
  particles_under_scene: { sha256: sha256(overBytes), bytes: overBytes.length },
  donor_state: { sha256: sha256(donorStateBytes), bytes: donorStateBytes.length },
};
const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");

await Promise.all([
  write(a["rays-under-scene"], underBytes),
  write(a["particles-under-scene"], overBytes),
  write(a["donor-state"], donorStateBytes),
  write(a.receipt, receiptBytes),
]);

console.log("vfx_light_particle_layer_native=PASS");
console.log(`vfx_revision=${result.vfxRevision}`);
console.log(`rays_under_plan_hash=${result.plans["rays-under-particles"].planHash}`);
console.log(`particles_under_plan_hash=${result.plans["particles-under-rays"].planHash}`);
console.log(`rays_under_scene_sha256=${receipt.outputs.rays_under_scene.sha256}`);
console.log(`particles_under_scene_sha256=${receipt.outputs.particles_under_scene.sha256}`);
