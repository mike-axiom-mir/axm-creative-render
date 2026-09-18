import test from "node:test";
import assert from "node:assert/strict";

import { pathSweepIndexedStripSetToAxmScene } from "../src/vfx_path_sweep_indexed_strip_native_bridge.mjs";

function fixture() {
  const paths = [{
    id: "path-a",
    points: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }],
  }];
  const source = {
    schema: "axm.path-sweep-frame-source/v0.1",
    id: "sweep",
    algorithm: "polyline-bisector-sweep-frame2d/v0.1",
    profile: "symmetric-ribbon2d",
    framePolicy: "left-normal-bisector2d",
    reversalFallback: "outgoing-segment",
    widthMode: "constant-half-width",
    halfWidth: 0.02,
    pathSource: { sourceHash: "path-hash", pathCount: 1, pointCount: 3 },
    provenance: { sourceReuse: "none", rendererAuthority: "none", meshAuthority: "none" },
  };
  const sourceHash = "sweep-hash";
  const frameSet = {
    schema: "axm.path-sweep-frame-set/v0.1",
    sourceHash,
    pathSourceHash: "path-hash",
    pathCount: 1,
    pointCount: 3,
    paths: [],
    derived: true,
    rebuildable: true,
    frameSetHash: "frame-hash",
  };
  const ribbonSet = {
    schema: "axm.path-sweep-ribbon-set/v0.1",
    sweepSourceHash: sourceHash,
    pathSourceHash: "path-hash",
    frameSetHash: "frame-hash",
    pathCount: 1,
    pointCount: 3,
    semantics: {
      algorithm: "frame-normal-ribbon-boundary2d/v0.1",
      profile: "symmetric-ribbon2d",
      boundaryPolicy: "center-plus-minus-normal-half-width",
      clipping: "none",
      joinAuthority: "none",
      capAuthority: "none",
      triangulation: "none",
      rendererAuthority: "none",
      meshAuthority: "none",
    },
    paths: [],
    provenance: { externalSourceReuse: "none" },
    derived: true,
    rebuildable: true,
    ribbonSetHash: "ribbon-hash",
  };
  const stripSet = {
    schema: "axm.path-sweep-indexed-strip-set/v0.1",
    sweepSourceHash: sourceHash,
    pathSourceHash: "path-hash",
    frameSetHash: "frame-hash",
    ribbonSetHash: "ribbon-hash",
    pathCount: 1,
    pointCount: 3,
    vertexCount: 6,
    triangleCount: 4,
    indexCount: 12,
    semantics: {
      algorithm: "ribbon-adjacent-pair-indexed-strip2d/v0.1",
      primitiveTopology: "triangle-list",
      vertexOrder: "left-right-per-path-point",
      trianglePolicy: "left_i-right_i-left_next;right_i-right_next-left_next",
      pathBridging: "forbidden",
      joinAuthority: "none",
      capAuthority: "none",
      clipping: "none",
      uvAuthority: "none",
      materialAuthority: "none",
      rendererAuthority: "none",
      frontFaceAuthority: "none",
      manifoldAuthority: "none",
      selfIntersectionResolution: "none",
      geometryValidityClaim: "connectivity-only",
    },
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
        { index: 4, pointIndex: 2, side: "left", x: 0.8, y: 0.52 },
        { index: 5, pointIndex: 2, side: "right", x: 0.8, y: 0.48 },
      ],
      triangles: [[0, 1, 2], [1, 3, 2], [2, 3, 4], [3, 5, 4]],
    }],
    provenance: { externalSourceReuse: "none" },
    derived: true,
    rebuildable: true,
    indexedStripSetHash: "strip-hash",
  };
  return { paths, source, sourceHash, frameSet, ribbonSet, stripSet };
}

test("indexed-strip observer consumes donor triangle connectivity directly", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet, stripSet } = fixture();
  const result = pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, stripSet, { maxTriangles: 4 });
  assert.equal(result.observation.output_triangle_count, 4);
  assert.equal(result.observation.donor_triangle_connectivity_consumed_directly, true);
  assert.equal(result.observation.triangulation_rederived_by_consumer, false);
  assert.equal(result.observation.boundary_offsets_rederived_by_consumer, false);
  assert.equal(result.observation.path_bridging_introduced_by_consumer, false);
  assert.equal(result.observation.canonical_mesh_authority_acquired, false);
  assert.deepEqual(result.scene.triangles[0].vertices, [[0.19, 0.21, 0], [0.21, 0.19, 0], [0.49, 0.52, 0]]);
  assert.deepEqual(result.scene.triangles[1].vertices, [[0.21, 0.19, 0], [0.51, 0.48, 0], [0.49, 0.52, 0]]);
});

test("indexed-strip observer capacity is structural and one below fails closed", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet, stripSet } = fixture();
  const exact = pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, stripSet, { maxTriangles: 4 });
  const roomy = pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, stripSet, { maxTriangles: 64 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(
    () => pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, stripSet, { maxTriangles: 3 }),
    /triangle budget exceeded: 4 > 3/,
  );
});

test("indexed-strip observer rejects lineage and donor authority drift", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet, stripSet } = fixture();
  const promoted = structuredClone(stripSet);
  promoted.derived = false;
  assert.throws(() => pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, promoted), /derived rebuildable/);

  const lineage = structuredClone(stripSet);
  lineage.ribbonSetHash = "other";
  assert.throws(() => pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, lineage), /derived lineage mismatch/);

  const renderer = structuredClone(stripSet);
  renderer.semantics.rendererAuthority = "vfx";
  assert.throws(() => pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, renderer), /topology semantic rendererAuthority drifted/);

  const surfaceClaim = structuredClone(stripSet);
  surfaceClaim.semantics.geometryValidityClaim = "general-surface";
  assert.throws(() => pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, surfaceClaim), /topology semantic geometryValidityClaim drifted/);
});

test("indexed-strip observer fails closed on invalid donor-local connectivity", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet, stripSet } = fixture();
  const crossBoundary = structuredClone(stripSet);
  crossBoundary.paths[0].triangles[0][2] = 99;
  assert.throws(
    () => pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, crossBoundary),
    /donor triangle index out of range/,
  );

  const wrongPath = structuredClone(stripSet);
  wrongPath.paths[0].id = "other";
  assert.throws(
    () => pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, wrongPath),
    /path lineage\/count mismatch/,
  );
});
