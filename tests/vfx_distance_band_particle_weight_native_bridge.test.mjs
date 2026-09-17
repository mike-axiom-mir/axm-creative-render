import test from "node:test";
import assert from "node:assert/strict";

import { distanceBandParticleWeightSetToAxmScene } from "../src/vfx_distance_band_particle_weight_native_bridge.mjs";

function fixture(overrides = {}) {
  const samples = [
    { particleId: "p0", x: 0.1, y: 0.2, weight: 0 },
    { particleId: "p1", x: 0.35, y: 0.45, weight: 0.25 },
    { particleId: "p2", x: 0.65, y: 0.55, weight: 0.75 },
    { particleId: "p3", x: 0.9, y: 0.8, weight: 1 },
  ];
  return {
    schema: "axm.distance-band-particle-weight-set/v0.1",
    weightSourceHash: "weight-source-hash",
    particleSourceHash: "particle-source-hash",
    distanceBandSourceHash: "band-source-hash",
    bandGridHash: "band-grid-hash",
    particleCount: samples.length,
    samples,
    minWeight: 0,
    maxWeight: 1,
    meanWeight: 0.5,
    zeroWeightCount: 1,
    fullWeightCount: 1,
    weightedSetHash: "weighted-set-hash",
    derived: true,
    rebuildable: true,
    ...overrides,
  };
}

test("distance-band particle native adapter preserves the derived replaceable boundary", () => {
  const result = distanceBandParticleWeightSetToAxmScene(fixture());
  assert.equal(result.scene.version, 1);
  assert.equal(result.scene.triangles.length, 8);
  assert.equal(result.observation.input_schema, "axm.distance-band-particle-weight-set/v0.1");
  assert.equal(result.observation.input_particles, 4);
  assert.equal(result.observation.output_triangles, 8);
  assert.equal(result.observation.source_family_branching, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
  assert.equal(result.observation.opacity_size_emission_gameplay_semantics_assigned, false);
  assert.equal(result.observation.canonical_source_rewritten, false);
  assert.equal(result.observation.derived, true);
  assert.equal(result.observation.replaceable, true);
  assert.notDeepEqual(result.scene.triangles[0].albedo, result.scene.triangles.at(-1).albedo);
});

test("distance-band particle native adapter keeps geometry independent of neutral weights", () => {
  const a = distanceBandParticleWeightSetToAxmScene(fixture());
  const changedSamples = fixture().samples.map((sample, index) => ({ ...sample, weight: [0.1, 0.2, 0.3, 0.4][index] }));
  const b = distanceBandParticleWeightSetToAxmScene(fixture({
    weightSourceHash: "other-weight-source",
    distanceBandSourceHash: "other-band-source",
    bandGridHash: "other-band-grid",
    weightedSetHash: "other-weighted-set",
    samples: changedSamples,
    minWeight: 0.1,
    maxWeight: 0.4,
    meanWeight: 0.25,
    zeroWeightCount: 0,
    fullWeightCount: 0,
  }));
  assert.deepEqual(a.scene.triangles.map((triangle) => triangle.vertices), b.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(a.scene.triangles.map((triangle) => triangle.albedo), b.scene.triangles.map((triangle) => triangle.albedo));
  assert.notEqual(a.bytes.toString("utf8"), b.bytes.toString("utf8"));
});

test("distance-band particle native adapter fails closed on non-derived input", () => {
  assert.throws(() => distanceBandParticleWeightSetToAxmScene(fixture({ derived: false })), /derived rebuildable/);
});

test("distance-band particle native adapter fails closed on sample cardinality mismatch", () => {
  assert.throws(() => distanceBandParticleWeightSetToAxmScene(fixture({ particleCount: 5 })), /cardinality mismatch/);
});

test("distance-band particle native adapter fails closed on duplicate particle identity", () => {
  const samples = fixture().samples.map((sample) => ({ ...sample }));
  samples[1].particleId = "p0";
  assert.throws(() => distanceBandParticleWeightSetToAxmScene(fixture({ samples })), /duplicate weighted particle id/);
});

test("distance-band particle native adapter fails closed on out-of-range weight", () => {
  const samples = fixture().samples.map((sample) => ({ ...sample }));
  samples[2].weight = 1.1;
  assert.throws(() => distanceBandParticleWeightSetToAxmScene(fixture({ samples, maxWeight: 1.1 })), /within \[0,1\]/);
});

test("distance-band particle native adapter verifies retained summaries", () => {
  assert.throws(() => distanceBandParticleWeightSetToAxmScene(fixture({ meanWeight: 0.9 })), /summary does not match/);
});

test("distance-band particle native adapter verifies retained weight counts", () => {
  assert.throws(() => distanceBandParticleWeightSetToAxmScene(fixture({ fullWeightCount: 2 })), /weight counts/);
});
