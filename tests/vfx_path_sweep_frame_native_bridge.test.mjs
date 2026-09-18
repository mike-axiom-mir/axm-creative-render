import test from "node:test";
import assert from "node:assert/strict";

import { pathSweepFrameSetToAxmScene } from "../src/vfx_path_sweep_frame_native_bridge.mjs";

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
  const tangent0 = { x: 0.707107, y: 0.707107 };
  const tangent1 = { x: 0.92388, y: 0.382683 };
  const tangent2 = { x: 1, y: 0 };
  const frameSet = {
    schema: "axm.path-sweep-frame-set/v0.1",
    sourceHash,
    pathSourceHash: "path-hash",
    pathCount: 1,
    pointCount: 3,
    paths: [{
      id: "path-a",
      frameCount: 3,
      frames: [
        { index: 0, x: 0.2, y: 0.2, tangent: tangent0, normal: { x: -tangent0.y, y: tangent0.x }, halfWidth: 0.02 },
        { index: 1, x: 0.5, y: 0.5, tangent: tangent1, normal: { x: -tangent1.y, y: tangent1.x }, halfWidth: 0.02 },
        { index: 2, x: 0.8, y: 0.5, tangent: tangent2, normal: { x: 0, y: 1 }, halfWidth: 0.02 },
      ],
    }],
    derived: true,
    rebuildable: true,
    frameSetHash: "frame-set-hash",
  };
  return { paths, source, sourceHash, frameSet };
}

test("path-sweep observer creates a derived ribbon without claiming source, mesh, renderer, or consumer authority", () => {
  const { paths, source, sourceHash, frameSet } = fixture();
  const result = pathSweepFrameSetToAxmScene(paths, source, sourceHash, frameSet, { maxPoints: 3 });
  assert.equal(result.observation.input_path_count, 1);
  assert.equal(result.observation.input_point_count, 3);
  assert.equal(result.observation.output_triangle_count, 4);
  assert.equal(result.observation.geometry_uses_only_retained_points_plus_donor_derived_normals_and_half_width, true);
  assert.equal(result.observation.albedo_encodes_frame_semantics, false);
  assert.equal(result.observation.mesh_authority_acquired, false);
  assert.equal(result.observation.renderer_authority_acquired, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
});

test("path-sweep observer capacity is structural and one below fails closed", () => {
  const { paths, source, sourceHash, frameSet } = fixture();
  const exact = pathSweepFrameSetToAxmScene(paths, source, sourceHash, frameSet, { maxPoints: 3 });
  const roomy = pathSweepFrameSetToAxmScene(paths, source, sourceHash, frameSet, { maxPoints: 64 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(
    () => pathSweepFrameSetToAxmScene(paths, source, sourceHash, frameSet, { maxPoints: 2 }),
    /point budget exceeded: 3 > 2/,
  );
});

test("path-sweep observer rejects promoted bodies, lineage drift, and invented donor authority", () => {
  const { paths, source, sourceHash, frameSet } = fixture();
  const promoted = structuredClone(frameSet);
  promoted.derived = false;
  assert.throws(() => pathSweepFrameSetToAxmScene(paths, source, sourceHash, promoted), /derived rebuildable/);

  const drift = structuredClone(frameSet);
  drift.pathSourceHash = "other";
  assert.throws(() => pathSweepFrameSetToAxmScene(paths, source, sourceHash, drift), /path-source lineage mismatch/);

  const renderer = structuredClone(source);
  renderer.provenance.rendererAuthority = "vfx";
  assert.throws(() => pathSweepFrameSetToAxmScene(paths, renderer, sourceHash, frameSet), /renderer or mesh authority/);
});

test("path-sweep observer rejects frame geometry that no longer matches retained points or left-normal semantics", () => {
  const { paths, source, sourceHash, frameSet } = fixture();
  const moved = structuredClone(frameSet);
  moved.paths[0].frames[1].x = 0.51;
  assert.throws(() => pathSweepFrameSetToAxmScene(paths, source, sourceHash, moved), /frame\/canonical point mismatch/);

  const flipped = structuredClone(frameSet);
  flipped.paths[0].frames[1].normal.x *= -1;
  flipped.paths[0].frames[1].normal.y *= -1;
  assert.throws(() => pathSweepFrameSetToAxmScene(paths, source, sourceHash, flipped), /left-normal orientation drifted/);
});
