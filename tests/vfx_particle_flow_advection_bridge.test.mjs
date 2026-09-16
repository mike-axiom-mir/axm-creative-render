import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  flowAdvectedParticleSetToAxmScene,
  observeVisualEffectParticleFlowAdvection,
} from "../src/vfx_particle_flow_advection_bridge.mjs";

function fixture(overrides = {}) {
  return {
    schema: "axm.flow-advected-particle-set/v0.1",
    advectionSourceHash: "advection-source",
    particleSourceHash: "particle-source",
    flowSourceHash: "flow-source",
    scalarSourceHash: "scalar-source",
    particleCount: 2,
    sampleCount: 6,
    particles: [
      { id: "p0", x: 0.25, y: 0.35, userData: { retained: true } },
      { id: "p1", x: 0.70, y: 0.65, userData: { retained: true } },
    ],
    trajectories: [
      { id: "p0", points: [{ x: 0.20, y: 0.30 }, { x: 0.23, y: 0.33 }, { x: 0.25, y: 0.35 }] },
      { id: "p1", points: [{ x: 0.66, y: 0.61 }, { x: 0.68, y: 0.63 }, { x: 0.70, y: 0.65 }] },
    ],
    maxStepDistance: 0.04,
    movedParticleCount: 2,
    clampedStepCount: 0,
    derived: true,
    rebuildable: true,
    particleSetHash: "particle-set",
    ...overrides,
  };
}

test("particle-flow scene adapter is deterministic, bounded and constant styled", () => {
  const first = flowAdvectedParticleSetToAxmScene(fixture());
  const second = flowAdvectedParticleSetToAxmScene(structuredClone(fixture()));
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.observation.particle_count, 2);
  assert.equal(first.observation.retained_trajectory_sample_count, 6);
  assert.equal(first.observation.geometry_encodes_final_derived_particle_positions, true);
  assert.equal(first.observation.trajectories_remain_evidence_only, true);
  assert.equal(first.observation.albedo_is_constant_observation_style, true);
  assert.equal(first.observation.consumer_semantics_preserved, false);
  const scene = parseScene(first.bytes.toString("utf8"));
  assert.equal(scene.triangles.length, 4);
  for (const triangle of scene.triangles) assert.deepEqual(triangle.albedo, [236, 174, 76]);
});

test("particle-flow bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectParticleFlowAdvection("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});

test("particle-flow adapter fails closed on promoted authority and malformed trajectory evidence", () => {
  assert.throws(
    () => flowAdvectedParticleSetToAxmScene(fixture({ derived: false })),
    /derived and rebuildable/,
  );
  const malformed = fixture();
  malformed.trajectories[1].id = "wrong-id";
  assert.throws(
    () => flowAdvectedParticleSetToAxmScene(malformed),
    /trajectory must align/,
  );
});
