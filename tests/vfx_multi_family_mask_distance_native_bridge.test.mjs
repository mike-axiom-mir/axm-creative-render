import test from "node:test";
import assert from "node:assert/strict";

import { signedMaskDistanceGridToAxmScene } from "../src/vfx_multi_family_mask_distance_native_bridge.mjs";

function fixture(overrides = {}) {
  const values = [-0.2, -0.1, 0.1, 0.2];
  return {
    schema: "axm.signed-mask-distance-grid/v0.1",
    distanceSourceHash: "distance-source-hash",
    maskSourceHash: "mask-source-hash",
    maskHash: "mask-hash",
    width: 2,
    height: 2,
    values,
    min: -0.2,
    max: 0.2,
    maxAbs: 0.2,
    insideCells: 2,
    outsideCells: 2,
    comparisonCount: 8,
    distanceGridHash: "distance-grid-hash",
    derived: true,
    rebuildable: true,
    ...overrides,
  };
}

test("signed mask-distance native adapter preserves a derived replaceable boundary", () => {
  const result = signedMaskDistanceGridToAxmScene(fixture());
  assert.equal(result.scene.version, 1);
  assert.equal(result.scene.triangles.length, 8);
  assert.equal(result.observation.input_schema, "axm.signed-mask-distance-grid/v0.1");
  assert.equal(result.observation.output_triangles, 8);
  assert.equal(result.observation.source_family_branching, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
  assert.equal(result.observation.canonical_source_rewritten, false);
  assert.equal(result.observation.derived, true);
  assert.equal(result.observation.replaceable, true);
  assert.notDeepEqual(result.scene.triangles[0].albedo, result.scene.triangles.at(-1).albedo);
});

test("signed mask-distance native adapter keeps geometry independent of distance values", () => {
  const a = signedMaskDistanceGridToAxmScene(fixture());
  const b = signedMaskDistanceGridToAxmScene(fixture({
    distanceSourceHash: "other-distance-source",
    maskSourceHash: "other-mask-source",
    maskHash: "other-mask",
    distanceGridHash: "other-grid",
    values: [-0.05, 0.05, 0.15, 0.25],
    min: -0.05,
    max: 0.25,
    maxAbs: 0.25,
    insideCells: 3,
    outsideCells: 1,
    comparisonCount: 6,
  }));
  assert.deepEqual(a.scene.triangles.map((triangle) => triangle.vertices), b.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(a.scene.triangles.map((triangle) => triangle.albedo), b.scene.triangles.map((triangle) => triangle.albedo));
  assert.notEqual(a.bytes.toString("utf8"), b.bytes.toString("utf8"));
});

test("signed mask-distance native adapter fails closed on non-derived input", () => {
  assert.throws(() => signedMaskDistanceGridToAxmScene(fixture({ derived: false })), /derived rebuildable/);
});

test("signed mask-distance native adapter fails closed on value cardinality mismatch", () => {
  assert.throws(() => signedMaskDistanceGridToAxmScene(fixture({ values: [0, 0] })), /cardinality mismatch/);
});

test("signed mask-distance native adapter fails closed on impossible values", () => {
  const values = [-0.2, -0.1, 0.1, 2];
  assert.throws(() => signedMaskDistanceGridToAxmScene(fixture({ values, max: 2, maxAbs: 2 })), /normalized-domain diagonal/);
});

test("signed mask-distance native adapter verifies retained summaries", () => {
  assert.throws(() => signedMaskDistanceGridToAxmScene(fixture({ maxAbs: 0.9 })), /summary evidence/);
});

test("signed mask-distance native adapter verifies retained class counts", () => {
  assert.throws(() => signedMaskDistanceGridToAxmScene(fixture({ insideCells: 3, outsideCells: 1 })), /class counts/);
});
