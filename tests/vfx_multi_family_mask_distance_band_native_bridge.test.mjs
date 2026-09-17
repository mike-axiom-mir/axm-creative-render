import test from "node:test";
import assert from "node:assert/strict";

import { distanceBandGridToAxmScene } from "../src/vfx_multi_family_mask_distance_band_native_bridge.mjs";

function fixture(overrides = {}) {
  const values = [0, 0.25, 0.75, 1];
  return {
    schema: "axm.distance-band-grid/v0.1",
    bandSourceHash: "band-source-hash",
    distanceSourceHash: "distance-source-hash",
    distanceGridHash: "distance-grid-hash",
    width: 2,
    height: 2,
    values,
    min: 0,
    max: 1,
    mean: 0.5,
    fullCells: 1,
    zeroCells: 1,
    bandGridHash: "band-grid-hash",
    derived: true,
    rebuildable: true,
    ...overrides,
  };
}

test("distance-band native adapter preserves a derived replaceable boundary", () => {
  const result = distanceBandGridToAxmScene(fixture());
  assert.equal(result.scene.version, 1);
  assert.equal(result.scene.triangles.length, 8);
  assert.equal(result.observation.input_schema, "axm.distance-band-grid/v0.1");
  assert.equal(result.observation.output_triangles, 8);
  assert.equal(result.observation.source_family_branching, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
  assert.equal(result.observation.canonical_source_rewritten, false);
  assert.equal(result.observation.derived, true);
  assert.equal(result.observation.replaceable, true);
  assert.notDeepEqual(result.scene.triangles[0].albedo, result.scene.triangles.at(-1).albedo);
});

test("distance-band native adapter keeps geometry independent of coverage values", () => {
  const a = distanceBandGridToAxmScene(fixture());
  const b = distanceBandGridToAxmScene(fixture({
    bandSourceHash: "other-band-source",
    distanceSourceHash: "other-distance-source",
    distanceGridHash: "other-distance-grid",
    bandGridHash: "other-band-grid",
    values: [0.1, 0.2, 0.3, 0.4],
    min: 0.1,
    max: 0.4,
    mean: 0.25,
    fullCells: 0,
    zeroCells: 0,
  }));
  assert.deepEqual(a.scene.triangles.map((triangle) => triangle.vertices), b.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(a.scene.triangles.map((triangle) => triangle.albedo), b.scene.triangles.map((triangle) => triangle.albedo));
  assert.notEqual(a.bytes.toString("utf8"), b.bytes.toString("utf8"));
});

test("distance-band native adapter fails closed on non-derived input", () => {
  assert.throws(() => distanceBandGridToAxmScene(fixture({ derived: false })), /derived rebuildable/);
});

test("distance-band native adapter fails closed on value cardinality mismatch", () => {
  assert.throws(() => distanceBandGridToAxmScene(fixture({ values: [0, 1] })), /cardinality mismatch/);
});

test("distance-band native adapter fails closed on out-of-range coverage", () => {
  assert.throws(() => distanceBandGridToAxmScene(fixture({ values: [0, 0.25, 0.75, 1.1], max: 1.1 })), /within \[0,1\]/);
});

test("distance-band native adapter verifies retained summaries", () => {
  assert.throws(() => distanceBandGridToAxmScene(fixture({ mean: 0.9 })), /summary evidence/);
});

test("distance-band native adapter verifies retained cell counts", () => {
  assert.throws(() => distanceBandGridToAxmScene(fixture({ fullCells: 2 })), /cell counts/);
});
