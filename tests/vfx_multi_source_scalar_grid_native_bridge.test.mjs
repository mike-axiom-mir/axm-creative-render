import test from "node:test";
import assert from "node:assert/strict";

import { scalarGridToAxmScene } from "../src/vfx_multi_source_scalar_grid_native_bridge.mjs";

function fixture(overrides = {}) {
  return {
    schema: "axm.scalar-field-grid/v0.1",
    sourceHash: "source-hash",
    width: 2,
    height: 2,
    values: [0, 0.25, 0.75, 1],
    min: 0,
    max: 1,
    mean: 0.5,
    derived: true,
    rebuildable: true,
    fieldHash: "field-hash",
    ...overrides,
  };
}

test("scalar-grid native adapter preserves a source-family-neutral derived observation boundary", () => {
  const result = scalarGridToAxmScene(fixture());
  assert.equal(result.scene.version, 1);
  assert.equal(result.scene.triangles.length, 8);
  assert.equal(result.observation.input_schema, "axm.scalar-field-grid/v0.1");
  assert.equal(result.observation.input_cells, 4);
  assert.equal(result.observation.output_triangles, 8);
  assert.equal(result.observation.source_family_branching, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
  assert.equal(result.observation.canonical_source_rewritten, false);
  assert.equal(result.observation.derived, true);
  assert.equal(result.observation.replaceable, true);
  assert.deepEqual(result.scene.triangles[0].albedo, [32, 32, 32]);
  assert.deepEqual(result.scene.triangles[1].albedo, [32, 32, 32]);
  assert.deepEqual(result.scene.triangles.at(-1).albedo, [255, 255, 255]);
});

test("scalar-grid native adapter keeps geometry identical across source identities when dimensions match", () => {
  const a = scalarGridToAxmScene(fixture());
  const b = scalarGridToAxmScene(fixture({
    sourceHash: "other-source-hash",
    fieldHash: "other-field-hash",
    values: [1, 0.75, 0.25, 0],
  }));
  assert.deepEqual(a.scene.triangles.map((triangle) => triangle.vertices), b.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(a.scene.triangles.map((triangle) => triangle.albedo), b.scene.triangles.map((triangle) => triangle.albedo));
  assert.notEqual(a.bytes.toString("utf8"), b.bytes.toString("utf8"));
});

test("scalar-grid native adapter fails closed on non-derived input", () => {
  assert.throws(() => scalarGridToAxmScene(fixture({ derived: false })), /derived rebuildable/);
});

test("scalar-grid native adapter fails closed on value cardinality mismatch", () => {
  assert.throws(() => scalarGridToAxmScene(fixture({ values: [0, 1] })), /cardinality mismatch/);
});

test("scalar-grid native adapter fails closed on out-of-range values", () => {
  assert.throws(() => scalarGridToAxmScene(fixture({ values: [0, 0.25, 0.75, 1.1], max: 1.1, mean: 0.525 })), /within 0..1/);
});

test("scalar-grid native adapter fails closed when retained summaries do not match values", () => {
  assert.throws(() => scalarGridToAxmScene(fixture({ mean: 0.6 })), /summary evidence/);
});
