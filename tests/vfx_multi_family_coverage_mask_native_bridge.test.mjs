import test from "node:test";
import assert from "node:assert/strict";

import { coverageMaskGridToAxmScene } from "../src/vfx_multi_family_coverage_mask_native_bridge.mjs";

function fixture(overrides = {}) {
  const values = [0, 0.25, 0.75, 1, 0, 0.25, 0.75, 1, 0, 0.25, 0.75, 1, 0, 0.25, 0.75, 1];
  return {
    schema: "axm.coverage-mask-grid/v0.1",
    fieldSourceHash: "field-source-hash",
    maskSourceHash: "mask-source-hash",
    maskHash: "mask-hash",
    width: 4,
    height: 4,
    values,
    min: 0,
    max: 1,
    mean: 0.5,
    opaqueCells: 4,
    transparentCells: 4,
    derived: true,
    rebuildable: true,
    ...overrides,
  };
}

test("coverage-mask native adapter preserves a source-family-neutral derived observation boundary", () => {
  const result = coverageMaskGridToAxmScene(fixture());
  assert.equal(result.scene.version, 1);
  assert.equal(result.scene.triangles.length, 32);
  assert.equal(result.observation.input_schema, "axm.coverage-mask-grid/v0.1");
  assert.equal(result.observation.input_cells, 16);
  assert.equal(result.observation.output_triangles, 32);
  assert.equal(result.observation.source_family_branching, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
  assert.equal(result.observation.canonical_source_rewritten, false);
  assert.equal(result.observation.derived, true);
  assert.equal(result.observation.replaceable, true);
  assert.deepEqual(result.scene.triangles[0].albedo, [24, 24, 24]);
  assert.deepEqual(result.scene.triangles[1].albedo, [24, 24, 24]);
  assert.deepEqual(result.scene.triangles.at(-1).albedo, [240, 240, 240]);
});

test("coverage-mask native adapter keeps geometry identical across retained source identities", () => {
  const a = coverageMaskGridToAxmScene(fixture());
  const values = fixture().values.map((value) => 1 - value);
  const b = coverageMaskGridToAxmScene(fixture({
    fieldSourceHash: "other-field-source-hash",
    maskSourceHash: "other-mask-source-hash",
    maskHash: "other-mask-hash",
    values,
  }));
  assert.deepEqual(a.scene.triangles.map((triangle) => triangle.vertices), b.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(a.scene.triangles.map((triangle) => triangle.albedo), b.scene.triangles.map((triangle) => triangle.albedo));
  assert.notEqual(a.bytes.toString("utf8"), b.bytes.toString("utf8"));
});

test("coverage-mask native adapter fails closed on non-derived input", () => {
  assert.throws(() => coverageMaskGridToAxmScene(fixture({ derived: false })), /derived rebuildable/);
});

test("coverage-mask native adapter fails closed on value cardinality mismatch", () => {
  assert.throws(() => coverageMaskGridToAxmScene(fixture({ values: [0, 1] })), /cardinality mismatch/);
});

test("coverage-mask native adapter fails closed on out-of-range values", () => {
  const values = fixture().values.slice();
  values[15] = 1.1;
  assert.throws(() => coverageMaskGridToAxmScene(fixture({ values, max: 1.1, mean: 0.50625, opaqueCells: 3 })), /within 0..1/);
});

test("coverage-mask native adapter fails closed when retained summaries do not match values", () => {
  assert.throws(() => coverageMaskGridToAxmScene(fixture({ mean: 0.6 })), /summary evidence/);
});

test("coverage-mask native adapter fails closed when retained binary-cell counts do not match values", () => {
  assert.throws(() => coverageMaskGridToAxmScene(fixture({ opaqueCells: 3 })), /binary-cell counts/);
});
