import test from "node:test";
import assert from "node:assert/strict";

import { pathSweepRibbonSetToAxmScene } from "../src/vfx_path_sweep_ribbon_native_bridge.mjs";

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
    frameSetHash: "frame-set-hash",
  };
  const semantics = {
    algorithm: "frame-normal-ribbon-boundary2d/v0.1",
    profile: "symmetric-ribbon2d",
    boundaryPolicy: "center-plus-minus-normal-half-width",
    clipping: "none",
    joinAuthority: "none",
    capAuthority: "none",
    triangulation: "none",
    rendererAuthority: "none",
    meshAuthority: "none",
  };
  const ribbonSet = {
    schema: "axm.path-sweep-ribbon-set/v0.1",
    sweepSourceHash: sourceHash,
    pathSourceHash: "path-hash",
    frameSetHash: "frame-set-hash",
    pathCount: 1,
    pointCount: 3,
    semantics,
    paths: [{
      id: "path-a",
      pointCount: 3,
      points: [
        { index: 0, center: { x: 0.2, y: 0.2 }, left: { x: 0.19, y: 0.21 }, right: { x: 0.21, y: 0.19 } },
        { index: 1, center: { x: 0.5, y: 0.5 }, left: { x: 0.49, y: 0.52 }, right: { x: 0.51, y: 0.48 } },
        { index: 2, center: { x: 0.8, y: 0.5 }, left: { x: 0.8, y: 0.52 }, right: { x: 0.8, y: 0.48 } },
      ],
    }],
    provenance: { externalSourceReuse: "none" },
    derived: true,
    rebuildable: true,
    ribbonSetHash: "ribbon-set-hash",
  };
  return { paths, source, sourceHash, frameSet, ribbonSet };
}

test("path-sweep ribbon observer triangulates donor boundaries only as disposable native evidence", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet } = fixture();
  const result = pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, { maxPoints: 3 });
  assert.equal(result.observation.input_path_count, 1);
  assert.equal(result.observation.input_point_count, 3);
  assert.equal(result.observation.output_triangle_count, 4);
  assert.equal(result.observation.geometry_uses_only_donor_derived_ribbon_boundaries, true);
  assert.equal(result.observation.boundary_offsets_rederived_by_consumer, false);
  assert.equal(result.observation.consumer_triangulation_policy_applied, true);
  assert.equal(result.observation.triangulation_authority_scope, "DERIVED_REPLACEABLE_OBSERVER_ONLY");
  assert.equal(result.observation.canonical_mesh_authority_acquired, false);
  assert.equal(result.observation.renderer_authority_acquired, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
});

test("path-sweep ribbon observer capacity is structural and one below fails closed", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet } = fixture();
  const exact = pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, { maxPoints: 3 });
  const roomy = pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, { maxPoints: 64 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(
    () => pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, { maxPoints: 2 }),
    /point budget exceeded: 3 > 2/,
  );
});

test("path-sweep ribbon observer rejects promoted bodies, lineage drift, and donor authority drift", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet } = fixture();
  const promoted = structuredClone(ribbonSet);
  promoted.derived = false;
  assert.throws(() => pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, promoted), /derived rebuildable/);

  const lineage = structuredClone(ribbonSet);
  lineage.frameSetHash = "other";
  assert.throws(() => pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, lineage), /derived lineage mismatch/);

  const triangulatingDonor = structuredClone(ribbonSet);
  triangulatingDonor.semantics.triangulation = "consumer-strip";
  assert.throws(() => pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, triangulatingDonor), /semantic triangulation drifted/);

  const renderer = structuredClone(source);
  renderer.provenance.rendererAuthority = "vfx";
  assert.throws(() => pathSweepRibbonSetToAxmScene(paths, renderer, sourceHash, frameSet, ribbonSet), /renderer or mesh authority/);
});

test("path-sweep ribbon observer rejects centers that no longer match retained path truth", () => {
  const { paths, source, sourceHash, frameSet, ribbonSet } = fixture();
  const moved = structuredClone(ribbonSet);
  moved.paths[0].points[1].center.x = 0.51;
  assert.throws(() => pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, moved), /center\/canonical point mismatch/);
});
