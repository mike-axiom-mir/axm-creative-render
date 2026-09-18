import test from "node:test";
import assert from "node:assert/strict";

import { pathSweepPropagationWeightSetToAxmScene } from "../src/vfx_path_sweep_propagation_native_bridge.mjs";

function fixture(weight = 0.25) {
  const stripSet = {
    schema: "axm.path-sweep-indexed-strip-set/v0.1",
    sweepSourceHash: "sweep",
    pathSourceHash: "paths",
    frameSetHash: "frames",
    ribbonSetHash: "ribbon",
    indexedStripSetHash: "strip",
    pathCount: 1,
    pointCount: 3,
    vertexCount: 6,
    triangleCount: 4,
    indexCount: 12,
    derived: true,
    rebuildable: true,
    paths: [{
      id: "path-a",
      pointCount: 3,
      vertexCount: 6,
      triangleCount: 4,
      indexCount: 12,
      vertices: [
        { index: 0, pointIndex: 0, side: "left", x: 0.19, y: 0.21 },
        { index: 1, pointIndex: 0, side: "right", x: 0.21, y: 0.19 },
        { index: 2, pointIndex: 1, side: "left", x: 0.49, y: 0.52 },
        { index: 3, pointIndex: 1, side: "right", x: 0.51, y: 0.48 },
        { index: 4, pointIndex: 2, side: "left", x: 0.80, y: 0.52 },
        { index: 5, pointIndex: 2, side: "right", x: 0.80, y: 0.48 },
      ],
      triangles: [[0, 1, 2], [1, 3, 2], [2, 3, 4], [3, 5, 4]],
    }],
  };
  const weights = [1, 1, weight, weight, 0, 0];
  const distances = [0, 0, 0.5, 0.5, 1, 1];
  const weightSet = {
    schema: "axm.path-sweep-propagation-weight-set2d/v0.1",
    sweepSourceHash: "sweep",
    pathSourceHash: "paths",
    frameSetHash: "frames",
    ribbonSetHash: "ribbon",
    indexedStripSetHash: "strip",
    propagationSourceHash: "front",
    weightSetHash: `weights-${weight}`,
    phase: 0.5,
    pathCount: 1,
    pointCount: 3,
    vertexCount: 6,
    minWeight: 0,
    maxWeight: 1,
    derived: true,
    rebuildable: true,
    semantics: {
      attributeMeaning: "neutral-scalar-weight",
      geometryMutation: "none",
      materialAuthority: "none",
      rendererAuthority: "none",
      consumerAuthority: "none",
    },
    paths: [{
      id: "path-a",
      pointCount: 3,
      vertexCount: 6,
      vertices: stripSet.paths[0].vertices.map((vertex, index) => ({
        vertexIndex: index,
        pointIndex: vertex.pointIndex,
        side: vertex.side,
        normalizedDistance: distances[index],
        weight: weights[index],
      })),
    }],
  };
  return { stripSet, weightSet };
}

test("sweep propagation observer keeps geometry fixed while neutral weights change observation", () => {
  const a = fixture(0.2);
  const b = fixture(0.8);
  const first = pathSweepPropagationWeightSetToAxmScene(a.stripSet, a.weightSet, { maxTriangles: 4 });
  const later = pathSweepPropagationWeightSetToAxmScene(b.stripSet, b.weightSet, { maxTriangles: 4 });
  assert.equal(first.observation.geometry_sha256, later.observation.geometry_sha256);
  assert.notEqual(first.observation.output_sha256, later.observation.output_sha256);
  assert.equal(first.observation.donor_connectivity_consumed_directly, true);
  assert.equal(first.observation.donor_neutral_weights_consumed_directly, true);
  assert.equal(first.observation.geometry_mutated_by_weight, false);
  assert.equal(first.observation.propagation_recomputed_by_consumer, false);
  assert.equal(first.observation.consumer_semantics_assigned, false);
});

test("sweep propagation observer capacity is structural and fails closed one below", () => {
  const { stripSet, weightSet } = fixture();
  const exact = pathSweepPropagationWeightSetToAxmScene(stripSet, weightSet, { maxTriangles: 4 });
  const roomy = pathSweepPropagationWeightSetToAxmScene(stripSet, weightSet, { maxTriangles: 64 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(() => pathSweepPropagationWeightSetToAxmScene(stripSet, weightSet, { maxTriangles: 3 }), /triangle budget exceeded/);
});

test("sweep propagation observer rejects authority, lineage, and paired-side drift", () => {
  const { stripSet, weightSet } = fixture();
  const promoted = structuredClone(weightSet);
  promoted.derived = false;
  assert.throws(() => pathSweepPropagationWeightSetToAxmScene(stripSet, promoted), /derived rebuildable/);

  const lineage = structuredClone(weightSet);
  lineage.indexedStripSetHash = "other";
  assert.throws(() => pathSweepPropagationWeightSetToAxmScene(stripSet, lineage), /lineage mismatch/);

  const authority = structuredClone(weightSet);
  authority.semantics.materialAuthority = "emission";
  assert.throws(() => pathSweepPropagationWeightSetToAxmScene(stripSet, authority), /authority semantics drifted/);

  const paired = structuredClone(weightSet);
  paired.paths[0].vertices[1].weight = 0.5;
  assert.throws(() => pathSweepPropagationWeightSetToAxmScene(stripSet, paired), /paired-side policy drifted/);
});
