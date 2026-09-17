import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  halftoneDotSetToAxmScene,
  observeVisualEffectHalftoneNative,
} from "../src/vfx_halftone_native_bridge.mjs";

function dotSet(firstRadius = 0.12) {
  return {
    schema: "axm.halftone-dot-set2d/v0.1",
    sourceHash: "halftone-source-hash",
    fieldSourceHash: "field-source-hash",
    dotSetHash: `dot-set-${firstRadius}`,
    columns: 2,
    rows: 2,
    dotCount: 4,
    derived: true,
    rebuildable: true,
    dots: [
      { index: 0, column: 0, row: 0, center: [0.25, 0.25], fieldValue: 0.2, radiusCell: firstRadius },
      { index: 1, column: 1, row: 0, center: [0.75, 0.25], fieldValue: 0.4, radiusCell: 0.18 },
      { index: 2, column: 0, row: 1, center: [0.25, 0.75], fieldValue: 0.6, radiusCell: 0.24 },
      { index: 3, column: 1, row: 1, center: [0.75, 0.75], fieldValue: 0.8, radiusCell: 0.3 },
    ],
  };
}

test("halftone dot-set adapter is deterministic, fixed-style and radius-driven", () => {
  const first = halftoneDotSetToAxmScene(dotSet());
  const repeat = halftoneDotSetToAxmScene(dotSet());
  const changed = halftoneDotSetToAxmScene(dotSet(0.34));

  assert.deepEqual(first.bytes, repeat.bytes);
  assert.notDeepEqual(first.bytes, changed.bytes);
  assert.equal(first.observation.output_triangle_count, 8);
  assert.equal(first.observation.centers_and_radius_only, true);
  assert.equal(first.observation.style_is_fixed, true);
  assert.equal(first.observation.consumer_semantics_assigned, false);

  const firstScene = parseScene(first.bytes.toString("utf8"));
  const changedScene = parseScene(changed.bytes.toString("utf8"));
  assert.equal(firstScene.triangles.length, 8);
  assert.equal(changedScene.triangles.length, 8);
  assert.deepEqual(firstScene.triangles.map((triangle) => triangle.albedo), changedScene.triangles.map((triangle) => triangle.albedo));
  assert.notDeepEqual(firstScene.triangles.map((triangle) => triangle.vertices), changedScene.triangles.map((triangle) => triangle.vertices));
});

test("halftone dot-set adapter fails closed on non-positive derived radius", () => {
  assert.throws(() => halftoneDotSetToAxmScene(dotSet(0)), /positive bounded radius/);
});

test("halftone native bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectHalftoneNative("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
