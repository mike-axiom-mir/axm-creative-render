import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  brokenPathSetToAxmScene,
  observeVisualEffectPathBreakFragmentation,
} from "../src/vfx_path_break_fragmentation_bridge.mjs";

function fixture(overrides = {}) {
  return {
    schema: "axm.broken-path-set/v0.1",
    breakSourceHash: "break-source",
    pathSourceHash: "path-source",
    sourcePathCount: 1,
    sourcePointCount: 3,
    fragmentCount: 2,
    pointCount: 4,
    paths: [
      {
        id: "neutral::fragment:0",
        sourcePathId: "neutral",
        fragmentIndex: 0,
        normalizedArcRange: { start: 0, end: 0.4 },
        userData: { retained: true },
        points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }],
      },
      {
        id: "neutral::fragment:1",
        sourcePathId: "neutral",
        fragmentIndex: 1,
        normalizedArcRange: { start: 0.5, end: 1 },
        userData: { retained: true },
        points: [{ x: 0.5, y: 0.6 }, { x: 0.9, y: 0.4 }],
      },
    ],
    removedNormalizedLengthPerPath: 0.1,
    derived: true,
    rebuildable: true,
    pathSetHash: "path-set",
    ...overrides,
  };
}

test("path-break scene adapter is deterministic, bounded and does not bridge gaps", () => {
  const first = brokenPathSetToAxmScene(fixture());
  const second = brokenPathSetToAxmScene(structuredClone(fixture()));
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.observation.source_path_count, 1);
  assert.equal(first.observation.fragment_count, 2);
  assert.equal(first.observation.derived_point_count, 4);
  assert.equal(first.observation.segment_count, 2);
  assert.equal(first.observation.geometry_encodes_derived_fragment_topology, true);
  assert.equal(first.observation.albedo_is_constant_observation_style, true);
  assert.equal(first.observation.consumer_semantics_preserved, false);
  const scene = parseScene(first.bytes.toString("utf8"));
  assert.equal(scene.triangles.length, 4);
  for (const triangle of scene.triangles) assert.deepEqual(triangle.albedo, [232, 170, 74]);
});

test("path-break bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectPathBreakFragmentation("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});

test("path-break adapter fails closed on promoted authority and degenerate fragments", () => {
  assert.throws(
    () => brokenPathSetToAxmScene(fixture({ derived: false })),
    /derived and rebuildable/,
  );
  const degenerate = fixture();
  degenerate.paths[0].points[1] = structuredClone(degenerate.paths[0].points[0]);
  assert.throws(
    () => brokenPathSetToAxmScene(degenerate),
    /degenerate segment/,
  );
});
