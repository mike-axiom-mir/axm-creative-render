import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  flowGuidedPathSetToAxmScene,
  observeVisualEffectPathFlowDisplacement,
} from "../src/vfx_path_flow_displacement_bridge.mjs";

function fixture(overrides = {}) {
  return {
    schema: "axm.flow-guided-path-set/v0.1",
    displacementSourceHash: "displacement-source",
    pathSourceHash: "path-source",
    flowSourceHash: "flow-source",
    scalarSourceHash: "scalar-source",
    pathCount: 1,
    pointCount: 3,
    paths: [{
      id: "neutral",
      userData: { retained: true },
      points: [
        { x: 0.1, y: 0.2, userData: { i: 0 } },
        { x: 0.5, y: 0.6, userData: { i: 1 } },
        { x: 0.9, y: 0.4, userData: { i: 2 } },
      ],
    }],
    maxDisplacement: 0.1,
    derived: true,
    rebuildable: true,
    pathSetHash: "path-set",
    ...overrides,
  };
}

test("path-flow scene adapter is deterministic, bounded and constant styled", () => {
  const first = flowGuidedPathSetToAxmScene(fixture());
  const second = flowGuidedPathSetToAxmScene(structuredClone(fixture()));
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.observation.path_count, 1);
  assert.equal(first.observation.point_count, 3);
  assert.equal(first.observation.segment_count, 2);
  assert.equal(first.observation.geometry_encodes_derived_path_coordinates, true);
  assert.equal(first.observation.albedo_is_constant_observation_style, true);
  assert.equal(first.observation.consumer_semantics_preserved, false);
  const scene = parseScene(first.bytes.toString("utf8"));
  assert.equal(scene.triangles.length, 4);
  for (const triangle of scene.triangles) assert.deepEqual(triangle.albedo, [72, 190, 220]);
});

test("path-flow bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectPathFlowDisplacement("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});

test("path-flow adapter fails closed on promoted authority and degenerate segments", () => {
  assert.throws(
    () => flowGuidedPathSetToAxmScene(fixture({ derived: false })),
    /derived and rebuildable/,
  );
  const degenerate = fixture();
  degenerate.paths[0].points[1] = structuredClone(degenerate.paths[0].points[0]);
  assert.throws(
    () => flowGuidedPathSetToAxmScene(degenerate),
    /degenerate segment/,
  );
});
