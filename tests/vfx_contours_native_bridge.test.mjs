import test from "node:test";
import assert from "node:assert/strict";

import { contourSegmentSetToAxmScene } from "../src/vfx_contours_native_bridge.mjs";

function fixture() {
  return {
    schema: "axm.contour-segment-set2d/v0.1",
    sourceHash: "contour-source-hash",
    fieldSourceHash: "field-source-hash",
    columns: 4,
    rows: 4,
    levels: [0.4, 0.6],
    cellLevelProbes: 32,
    segmentCount: 2,
    segments: [
      { index: 0, levelIndex: 0, level: 0.4, column: 0, row: 0, branch: 0, startEdge: "left", endEdge: "right", start: [0.1, 0.2], end: [0.4, 0.2], length: 0.3 },
      { index: 1, levelIndex: 1, level: 0.6, column: 2, row: 2, branch: 0, startEdge: "top", endEdge: "bottom", start: [0.7, 0.3], end: [0.7, 0.8], length: 0.5 },
    ],
    segmentSetHash: "segment-set-hash",
    derived: true,
    rebuildable: true,
  };
}

test("contour native adapter preserves derived-only observation boundary", () => {
  const result = contourSegmentSetToAxmScene(fixture());
  assert.equal(result.scene.version, 1);
  assert.equal(result.scene.triangles.length, 4);
  assert.equal(result.observation.input_segment_count, 2);
  assert.equal(result.observation.output_triangle_count, 4);
  assert.equal(result.observation.endpoints_only, true);
  assert.equal(result.observation.style_is_fixed, true);
  assert.equal(result.observation.consumer_semantics_assigned, false);
  assert.ok(result.scene.triangles.every((triangle) => assert.deepEqual(triangle.albedo, [238, 238, 238]) === undefined));
});

test("contour native adapter fails closed on non-derived input", () => {
  const value = fixture();
  value.derived = false;
  assert.throws(() => contourSegmentSetToAxmScene(value), /derived rebuildable/);
});

test("contour native adapter fails closed on level lineage mismatch", () => {
  const value = fixture();
  value.segments[0].level = 0.45;
  assert.throws(() => contourSegmentSetToAxmScene(value), /level lineage mismatch/);
});

test("contour native adapter fails closed on zero-length geometry", () => {
  const value = fixture();
  value.segments[0].end = [...value.segments[0].start];
  value.segments[0].length = 0;
  assert.throws(() => contourSegmentSetToAxmScene(value), /zero-length segment/);
});
