import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  hatchingStrokeSetToAxmScene,
  observeVisualEffectHatchingNative,
} from "../src/vfx_hatching_native_bridge.mjs";

function strokeSet(firstTo = [0.42, 0.25]) {
  return {
    schema: "axm.hatching-stroke-set2d/v0.1",
    sourceHash: "hatching-source-hash",
    fieldSourceHash: "field-source-hash",
    flowSourceHash: "flow-source-hash",
    strokeSetHash: `stroke-set-${firstTo.join("-")}`,
    columns: 2,
    rows: 2,
    strokeCount: 4,
    derived: true,
    rebuildable: true,
    strokes: [
      { index: 0, column: 0, row: 0, center: [0.25, 0.25], fieldValue: 0.2, flowMagnitude: 0.7, direction: [1, 0], lengthCell: 0.34, from: [0.08, 0.25], to: firstTo },
      { index: 1, column: 1, row: 0, center: [0.75, 0.25], fieldValue: 0.4, flowMagnitude: 0.7, direction: [0, 1], lengthCell: 0.4, from: [0.75, 0.05], to: [0.75, 0.45] },
      { index: 2, column: 0, row: 1, center: [0.25, 0.75], fieldValue: 0.6, flowMagnitude: 0.7, direction: [1, 0], lengthCell: 0.5, from: [0.0, 0.75], to: [0.5, 0.75] },
      { index: 3, column: 1, row: 1, center: [0.75, 0.75], fieldValue: 0.8, flowMagnitude: 0.7, direction: [0, 1], lengthCell: 0.6, from: [0.75, 0.45], to: [0.75, 1.05] },
    ],
  };
}

test("hatching stroke-set adapter is deterministic, fixed-style and endpoint-driven", () => {
  const first = hatchingStrokeSetToAxmScene(strokeSet());
  const repeat = hatchingStrokeSetToAxmScene(strokeSet());
  const changed = hatchingStrokeSetToAxmScene(strokeSet([0.5, 0.25]));

  assert.deepEqual(first.bytes, repeat.bytes);
  assert.notDeepEqual(first.bytes, changed.bytes);
  assert.equal(first.observation.output_triangle_count, 8);
  assert.equal(first.observation.endpoints_only, true);
  assert.equal(first.observation.style_is_fixed, true);
  assert.equal(first.observation.consumer_semantics_assigned, false);

  const firstScene = parseScene(first.bytes.toString("utf8"));
  const changedScene = parseScene(changed.bytes.toString("utf8"));
  assert.equal(firstScene.triangles.length, 8);
  assert.equal(changedScene.triangles.length, 8);
  assert.deepEqual(firstScene.triangles.map((triangle) => triangle.albedo), changedScene.triangles.map((triangle) => triangle.albedo));
  assert.notDeepEqual(firstScene.triangles.map((triangle) => triangle.vertices), changedScene.triangles.map((triangle) => triangle.vertices));
});

test("hatching stroke-set adapter fails closed on zero-length derived stroke", () => {
  const broken = strokeSet();
  broken.strokes[0].to = [...broken.strokes[0].from];
  assert.throws(() => hatchingStrokeSetToAxmScene(broken), /positive finite stroke length/);
});

test("hatching native bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectHatchingNative("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
