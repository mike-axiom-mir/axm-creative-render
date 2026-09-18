import test from "node:test";
import assert from "node:assert/strict";

import { branchPropagationEnvelopeToAxmScene } from "../src/vfx_branch_propagation_native_bridge.mjs";

function network() {
  return {
    schema: "axm.branch-growth-network2d/v0.1",
    sourceHash: "branch-source-hash",
    networkHash: "branch-network-hash",
    segmentCount: 2,
    clippedSegmentCount: 0,
    terminalSegmentCount: 1,
    segments: [
      { id: "segment-0", index: 0, parentId: null, generation: 0, start: [0.5, 0.9], end: [0.5, 0.6] },
      { id: "segment-1", index: 1, parentId: "segment-0", generation: 1, start: [0.5, 0.6], end: [0.65, 0.4] },
    ],
    derived: true,
    rebuildable: true,
  };
}

function envelope(weights = [[0, 0.2], [0.2, 0.8]]) {
  return {
    schema: "axm.branch-propagation-envelope2d/v0.1",
    algorithm: "branch-root-path-propagation-envelope/v0.1",
    distanceMetric: "root-path-actual-length",
    normalization: "max-root-path-end-distance",
    sampleSites: "segment-start-end",
    phaseMode: "clamp",
    branchSourceHash: "branch-source-hash",
    networkHash: "branch-network-hash",
    propagationSourceHash: "propagation-source-hash",
    phase: 0.5,
    maxPathLength: 0.5,
    segmentCount: 2,
    segments: [
      { segmentId: "segment-0", index: 0, parentId: null, generation: 0, normalizedStart: 0, normalizedEnd: 0.6, startWeight: weights[0][0], endWeight: weights[0][1] },
      { segmentId: "segment-1", index: 1, parentId: "segment-0", generation: 1, normalizedStart: 0.6, normalizedEnd: 1, startWeight: weights[1][0], endWeight: weights[1][1] },
    ],
    derived: true,
    rebuildable: true,
    envelopeHash: "envelope-hash",
  };
}

test("branch propagation observer keeps geometry fixed while donor-derived weights change only neutral albedo", () => {
  const first = branchPropagationEnvelopeToAxmScene(network(), envelope([[0, 0], [0.2, 0.2]]));
  const second = branchPropagationEnvelopeToAxmScene(network(), envelope([[0.8, 0.8], [1, 1]]));
  assert.equal(first.observation.geometry_sha256, second.observation.geometry_sha256);
  assert.notEqual(first.observation.output_sha256, second.observation.output_sha256);
  assert.deepEqual(first.scene.triangles.map((triangle) => triangle.vertices), second.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(first.scene.triangles.map((triangle) => triangle.albedo), second.scene.triangles.map((triangle) => triangle.albedo));
  assert.equal(first.observation.geometry_encodes_weight, false);
  assert.equal(first.observation.albedo_encodes_only_donor_derived_segment_mean_weight, true);
  assert.equal(first.observation.consumer_semantics_assigned, false);
});

test("branch propagation observer treats segment capacity as structural and fails one below", () => {
  const exact = branchPropagationEnvelopeToAxmScene(network(), envelope(), { maxSegments: 2 });
  const roomy = branchPropagationEnvelopeToAxmScene(network(), envelope(), { maxSegments: 4096 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), envelope(), { maxSegments: 1 }), /segment budget exceeded: 2 > 1/);
});

test("branch propagation observer rejects authority, fixed-semantics, and lineage drift", () => {
  const promoted = envelope();
  promoted.derived = false;
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), promoted), /derived rebuildable/);

  const semantics = envelope();
  semantics.distanceMetric = "generation-index";
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), semantics), /distanceMetric drifted/);

  const lineage = envelope();
  lineage.networkHash = "other-network";
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), lineage), /lost branch\/network lineage/);
});

test("branch propagation observer rejects cardinality, ordering, intervals, and out-of-range weights", () => {
  const cardinality = envelope();
  cardinality.segmentCount = 3;
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), cardinality), /cardinality mismatch/);

  const ordering = envelope();
  ordering.segments[1].segmentId = "wrong-segment";
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), ordering), /lineage\/order mismatch/);

  const interval = envelope();
  interval.segments[0].normalizedStart = 0.7;
  interval.segments[0].normalizedEnd = 0.6;
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), interval), /interval is reversed/);

  const weight = envelope();
  weight.segments[0].startWeight = 1.1;
  assert.throws(() => branchPropagationEnvelopeToAxmScene(network(), weight), /startWeight must remain within \[0,1\]/);
});
