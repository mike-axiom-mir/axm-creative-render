import test from "node:test";
import assert from "node:assert/strict";

import { propagationFrontSampleSetToAxmScene } from "../src/vfx_propagation_front_native_bridge.mjs";

function sampleSet(weights) {
  return {
    schema: "axm.propagation-front-samples/v0.1",
    sourceHash: "retained-propagation-source-hash",
    phase: 0.5,
    sampleCount: weights.length,
    samples: weights.map((weight, index) => ({
      index,
      position: index / (weights.length - 1),
      weight,
    })),
    minWeight: Math.min(...weights),
    maxWeight: Math.max(...weights),
    derived: true,
    rebuildable: true,
    sampleSetHash: `sample-set-${weights.join("-")}`,
  };
}

test("propagation observer keeps capacity structural rather than creative", () => {
  const set = sampleSet([1, 0.8, 0.2, 0]);
  const exact = propagationFrontSampleSetToAxmScene(set, { maxSamples: 4 });
  const roomy = propagationFrontSampleSetToAxmScene(set, { maxSamples: 4097 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.equal(exact.observation.output_triangle_count, 8);
  assert.throws(
    () => propagationFrontSampleSetToAxmScene(set, { maxSamples: 3 }),
    /sample budget exceeded/,
  );
});

test("propagation phases can change only neutral albedo while fixed sample geometry stays identical", () => {
  const a = propagationFrontSampleSetToAxmScene(sampleSet([1, 0.8, 0.2, 0]));
  const b = propagationFrontSampleSetToAxmScene(sampleSet([1, 1, 0.9, 0.3]));
  assert.equal(a.observation.geometry_sha256, b.observation.geometry_sha256);
  assert.notEqual(a.observation.output_sha256, b.observation.output_sha256);
  assert.deepEqual(
    a.scene.triangles.map((triangle) => triangle.vertices),
    b.scene.triangles.map((triangle) => triangle.vertices),
  );
  assert.notDeepEqual(
    a.scene.triangles.map((triangle) => triangle.albedo),
    b.scene.triangles.map((triangle) => triangle.albedo),
  );
  assert.equal(a.observation.geometry_encodes_weight, false);
  assert.equal(a.observation.albedo_encodes_derived_weight, true);
  assert.equal(a.observation.semantic_reveal_preserved, false);
});

test("propagation observer refuses authority promotion and malformed derived weights", () => {
  const promoted = sampleSet([1, 0]);
  promoted.derived = false;
  assert.throws(() => propagationFrontSampleSetToAxmScene(promoted), /must remain derived and rebuildable/);

  const invalid = sampleSet([1, 0]);
  invalid.samples[1].weight = 1.5;
  assert.throws(() => propagationFrontSampleSetToAxmScene(invalid), /weight must be within/);
});

test("propagation observer refuses reordered derived sample identity", () => {
  const reordered = sampleSet([1, 0.5, 0]);
  reordered.samples[1].index = 2;
  assert.throws(() => propagationFrontSampleSetToAxmScene(reordered), /identity mismatch/);
});
