import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  branchGrowthNetworkToAxmScene,
  observeVisualEffectBranchGrowthNative,
} from "../src/vfx_branch_growth_native_bridge.mjs";

function network(end = [0.5, 0.3]) {
  return {
    schema: "axm.branch-growth-network2d/v0.1",
    sourceHash: "source-hash",
    networkHash: `network-${end.join("-")}`,
    segmentCount: 1,
    clippedSegmentCount: 0,
    terminalSegmentCount: 1,
    derived: true,
    rebuildable: true,
    segments: [
      {
        id: "growth:root",
        index: 0,
        parentId: null,
        generation: 0,
        branchIndex: null,
        start: [0.5, 0.8],
        end,
        headingTurns: 0.75,
        requestedLength: 0.5,
        actualLength: 0.5,
        clipped: false,
        terminal: true,
      },
    ],
  };
}

test("branch-growth network adapter is deterministic, fixed-style and geometry-only", () => {
  const first = branchGrowthNetworkToAxmScene(network());
  const repeat = branchGrowthNetworkToAxmScene(network());
  const changed = branchGrowthNetworkToAxmScene(network([0.65, 0.35]));

  assert.deepEqual(first.bytes, repeat.bytes);
  assert.notDeepEqual(first.bytes, changed.bytes);
  assert.equal(first.observation.output_triangle_count, 2);
  assert.equal(first.observation.geometry_encodes_only_derived_network_endpoints, true);
  assert.equal(first.observation.style_is_fixed, true);
  assert.equal(first.observation.consumer_semantics_assigned, false);

  const firstScene = parseScene(first.bytes.toString("utf8"));
  const changedScene = parseScene(changed.bytes.toString("utf8"));
  assert.equal(firstScene.triangles.length, 2);
  assert.equal(changedScene.triangles.length, 2);
  assert.deepEqual(firstScene.triangles.map((triangle) => triangle.albedo), changedScene.triangles.map((triangle) => triangle.albedo));
  assert.notDeepEqual(firstScene.triangles.map((triangle) => triangle.vertices), changedScene.triangles.map((triangle) => triangle.vertices));
});

test("branch-growth network adapter fails closed on zero-length derived geometry", () => {
  const zero = network([0.5, 0.8]);
  assert.throws(() => branchGrowthNetworkToAxmScene(zero), /does not silently realize zero-length segment/);
});

test("branch-growth native bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectBranchGrowthNative("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
