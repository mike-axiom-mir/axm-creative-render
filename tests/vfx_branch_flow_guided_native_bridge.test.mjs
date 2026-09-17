import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  flowGuidedBranchCurveSetToAxmScene,
  observeVisualEffectBranchFlowGuidedNative,
} from "../src/vfx_branch_flow_guided_native_bridge.mjs";

function curveSet(control = [0.5, 0.5]) {
  return {
    schema: "axm.flow-guided-branch-curves2d/v0.1",
    branchSourceHash: "branch-source",
    baseNetworkHash: "network-hash",
    scalarSourceHash: "scalar-source",
    flowSourceHash: "flow-source",
    guidanceSourceHash: `guidance-${control.join("-")}`,
    curveSetHash: `curve-set-${control.join("-")}`,
    curveCount: 1,
    clampedControlCount: 0,
    maxOffsetMagnitude: 0,
    meanOffsetMagnitude: 0,
    derived: true,
    rebuildable: true,
    curves: [
      {
        id: "guidance:growth:root",
        index: 0,
        segmentId: "growth:root",
        parentId: null,
        generation: 0,
        start: [0.25, 0.75],
        control,
        end: [0.75, 0.25],
        sampledAt: [0.5, 0.5],
        flow: { x: 0, y: 0, magnitude: 0 },
        offset: [0, 0],
        offsetMagnitude: 0,
      },
    ],
  };
}

test("flow-guided branch curve adapter is deterministic, fixed-style and control-point-sensitive", () => {
  const straight = flowGuidedBranchCurveSetToAxmScene(curveSet([0.5, 0.5]));
  const repeat = flowGuidedBranchCurveSetToAxmScene(curveSet([0.5, 0.5]));
  const bent = flowGuidedBranchCurveSetToAxmScene(curveSet([0.68, 0.58]));

  assert.deepEqual(straight.bytes, repeat.bytes);
  assert.notDeepEqual(straight.bytes, bent.bytes);
  assert.equal(straight.observation.subdivisions_per_curve, 8);
  assert.equal(straight.observation.polyline_segment_count, 8);
  assert.equal(straight.observation.output_triangle_count, 16);
  assert.equal(straight.observation.geometry_encodes_only_derived_quadratic_start_control_end, true);
  assert.equal(straight.observation.style_is_fixed, true);
  assert.equal(straight.observation.consumer_semantics_assigned, false);

  const straightScene = parseScene(straight.bytes.toString("utf8"));
  const bentScene = parseScene(bent.bytes.toString("utf8"));
  assert.equal(straightScene.triangles.length, 16);
  assert.equal(bentScene.triangles.length, 16);
  assert.deepEqual(straightScene.triangles.map((triangle) => triangle.albedo), bentScene.triangles.map((triangle) => triangle.albedo));
  assert.notDeepEqual(straightScene.triangles.map((triangle) => triangle.vertices), bentScene.triangles.map((triangle) => triangle.vertices));
});

test("flow-guided branch adapter keeps tessellation resolution an explicit bounded observation choice", () => {
  const four = flowGuidedBranchCurveSetToAxmScene(curveSet(), { subdivisions: 4 });
  const twelve = flowGuidedBranchCurveSetToAxmScene(curveSet(), { subdivisions: 12 });
  assert.equal(four.observation.output_triangle_count, 8);
  assert.equal(twelve.observation.output_triangle_count, 24);
  assert.throws(() => flowGuidedBranchCurveSetToAxmScene(curveSet(), { subdivisions: 1 }), /within \[2,32\]/);
  assert.throws(() => flowGuidedBranchCurveSetToAxmScene(curveSet(), { subdivisions: 33 }), /within \[2,32\]/);
});

test("flow-guided branch adapter fails closed on invalid or zero-length derived geometry", () => {
  const zero = curveSet([0.5, 0.5]);
  zero.curves[0].start = [0.5, 0.5];
  zero.curves[0].control = [0.5, 0.5];
  zero.curves[0].end = [0.5, 0.5];
  assert.throws(() => flowGuidedBranchCurveSetToAxmScene(zero), /does not silently realize zero-length tessellation segment/);

  const invalid = curveSet();
  invalid.curves[0].control = [1.2, 0.5];
  assert.throws(() => flowGuidedBranchCurveSetToAxmScene(invalid), /normalized 0\.\.1 space/);
});

test("flow-guided branch native bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectBranchFlowGuidedNative("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
