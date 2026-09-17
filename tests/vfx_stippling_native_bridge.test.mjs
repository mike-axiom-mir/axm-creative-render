import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  stipplingPointSetToAxmScene,
  observeVisualEffectStipplingNative,
} from "../src/vfx_stippling_native_bridge.mjs";

function source(radiusCell = 0.12) {
  return {
    schema: "axm.stippling-source2d/v0.1",
    __sourceHash: "stippling-source-hash",
    fieldSourceHash: "field-source-hash",
    radiusCell,
  };
}

function pointSet(secondPosition = [0.7, 0.7]) {
  return {
    schema: "axm.stippling-point-set2d/v0.1",
    sourceHash: "stippling-source-hash",
    fieldSourceHash: "field-source-hash",
    pointSetHash: `point-set-${secondPosition.join("-")}`,
    columns: 2,
    rows: 2,
    candidatesPerCell: 2,
    candidateCount: 8,
    pointCount: 2,
    derived: true,
    rebuildable: true,
    points: [
      { index: 0, candidateIndex: 1, column: 0, row: 0, candidate: 1, position: [0.2, 0.3], fieldValue: 0.2, density: 0.3, decision: 0.1 },
      { index: 1, candidateIndex: 6, column: 1, row: 1, candidate: 0, position: secondPosition, fieldValue: 0.8, density: 0.7, decision: 0.2 },
    ],
  };
}

test("stippling point-set adapter is deterministic, fixed-style and position-driven", () => {
  const first = stipplingPointSetToAxmScene(pointSet(), source());
  const repeat = stipplingPointSetToAxmScene(pointSet(), source());
  const changed = stipplingPointSetToAxmScene(pointSet([0.6, 0.8]), source());

  assert.deepEqual(first.bytes, repeat.bytes);
  assert.notDeepEqual(first.bytes, changed.bytes);
  assert.equal(first.observation.output_triangle_count, 4);
  assert.equal(first.observation.positions_and_constant_radius_only, true);
  assert.equal(first.observation.style_is_fixed, true);
  assert.equal(first.observation.consumer_semantics_assigned, false);

  const firstScene = parseScene(first.bytes.toString("utf8"));
  const changedScene = parseScene(changed.bytes.toString("utf8"));
  assert.equal(firstScene.triangles.length, 4);
  assert.equal(changedScene.triangles.length, 4);
  assert.deepEqual(firstScene.triangles.map((triangle) => triangle.albedo), changedScene.triangles.map((triangle) => triangle.albedo));
  assert.notDeepEqual(firstScene.triangles.map((triangle) => triangle.vertices), changedScene.triangles.map((triangle) => triangle.vertices));
});

test("stippling point-set adapter fails closed on invalid retained radius", () => {
  assert.throws(() => stipplingPointSetToAxmScene(pointSet(), source(0)), /positive bounded radiusCell/);
});

test("stippling point-set adapter fails closed on non-monotonic candidate identity", () => {
  const broken = pointSet();
  broken.points[1].candidateIndex = 1;
  assert.throws(() => stipplingPointSetToAxmScene(broken, source()), /point order\/identity mismatch/);
});

test("stippling native bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectStipplingNative("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
