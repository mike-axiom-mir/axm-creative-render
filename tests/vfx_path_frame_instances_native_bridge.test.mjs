import test from "node:test";
import assert from "node:assert/strict";

import { pathFrameInstanceSetToAxmScene } from "../src/vfx_path_frame_instances_native_bridge.mjs";

function fixture() {
  const source = {
    schema: "axm.path-sweep-frame-source/v0.1",
    id: "sweep",
    algorithm: "polyline-bisector-sweep-frame2d/v0.1",
    profile: "symmetric-ribbon2d",
    framePolicy: "left-normal-bisector2d",
    reversalFallback: "outgoing-segment",
    widthMode: "constant-half-width",
    halfWidth: 0.02,
    pathSource: { sourceHash: "path-hash", pathCount: 1, pointCount: 2 },
    provenance: { sourceReuse: "none", rendererAuthority: "none", meshAuthority: "none" },
  };
  const sourceHash = "sweep-hash";
  const frameSet = {
    schema: "axm.path-sweep-frame-set/v0.1",
    sourceHash,
    pathSourceHash: "path-hash",
    pathCount: 1,
    pointCount: 2,
    paths: [],
    derived: true,
    rebuildable: true,
    frameSetHash: "frame-hash",
  };
  const instanceSet = {
    schema: "axm.path-frame-instance-transform-set2d/v0.1",
    sweepSourceHash: sourceHash,
    pathSourceHash: "path-hash",
    frameSetHash: "frame-hash",
    pathCount: 1,
    sourcePointCount: 2,
    instanceCount: 2,
    selection: { stride: 1, includeFinalFrame: true },
    semantics: {
      algorithm: "verified-path-frame-rigid-instance2d/v0.1",
      selectionPolicy: "stride-with-final-frame",
      translationPolicy: "frame-position",
      orientationPolicy: "tangent-normal-rigid-basis",
      scalePolicy: "identity-only",
      widthPolicy: "carry-sweep-half-width-as-neutral-hint",
      prototypeBinding: "external-required",
      rendererAuthority: "none",
      meshAuthority: "none",
      consumerPlacementAuthority: "none",
    },
    paths: [{
      id: "path-a",
      sourceFrameCount: 2,
      instanceCount: 2,
      instances: [
        { frameIndex: 0, translation: { x: 0.2, y: 0.3 }, basisX: { x: 1, y: 0 }, basisY: { x: 0, y: 1 }, scale: { x: 1, y: 1 }, sweepHalfWidth: 0.02 },
        { frameIndex: 1, translation: { x: 0.7, y: 0.6 }, basisX: { x: 0, y: 1 }, basisY: { x: -1, y: 0 }, scale: { x: 1, y: 1 }, sweepHalfWidth: 0.02 },
      ],
    }],
    provenance: { externalSourceReuse: "none" },
    derived: true,
    rebuildable: true,
    instanceSetHash: "instance-hash",
  };
  const prototype = {
    schema: "axm.creative-render.external-neutral-prototype2d/v1",
    id: "triangle",
    vertices: [{ x: -0.01, y: -0.005 }, { x: 0.015, y: 0 }, { x: -0.01, y: 0.005 }],
    albedo: [176, 176, 176],
  };
  return { source, sourceHash, frameSet, instanceSet, prototype };
}

test("path-frame instance observer applies donor rigid bases to caller-owned prototype only", () => {
  const { source, sourceHash, frameSet, instanceSet, prototype } = fixture();
  const result = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, instanceSet, prototype, { maxInstances: 2 });
  assert.equal(result.observation.input_instance_count, 2);
  assert.equal(result.observation.output_triangle_count, 2);
  assert.equal(result.observation.basis_consumed_directly, true);
  assert.equal(result.observation.angle_rederived_by_consumer, false);
  assert.equal(result.observation.sweep_half_width_used_as_scale, false);
  assert.equal(result.observation.donor_identity_scale_preserved, true);
  assert.equal(result.observation.prototype_authority, "CALLER_OWNED_REPLACEABLE_OBSERVER_INPUT");
  assert.equal(result.observation.canonical_mesh_authority_acquired, false);
  assert.deepEqual(result.scene.triangles[0].vertices[1], [0.21500000000000002, 0.3, 0]);
  assert.deepEqual(result.scene.triangles[1].vertices[1], [0.7, 0.615, 0]);
});

test("path-frame instance observer capacity is structural and fails one below", () => {
  const { source, sourceHash, frameSet, instanceSet, prototype } = fixture();
  const exact = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, instanceSet, prototype, { maxInstances: 2 });
  const roomy = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, instanceSet, prototype, { maxInstances: 64 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(
    () => pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, instanceSet, prototype, { maxInstances: 1 }),
    /instance budget exceeded: 2 > 1/,
  );
});

test("path-frame instance observer rejects promoted bodies, lineage drift, authority drift, and non-identity scale", () => {
  const { source, sourceHash, frameSet, instanceSet, prototype } = fixture();
  const promoted = structuredClone(instanceSet);
  promoted.derived = false;
  assert.throws(() => pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, promoted, prototype), /derived rebuildable/);

  const lineage = structuredClone(instanceSet);
  lineage.frameSetHash = "other";
  assert.throws(() => pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, lineage, prototype), /derived lineage mismatch/);

  const authoritative = structuredClone(instanceSet);
  authoritative.semantics.prototypeBinding = "donor-owned";
  assert.throws(() => pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, authoritative, prototype), /semantic prototypeBinding drifted/);

  const scaled = structuredClone(instanceSet);
  scaled.paths[0].instances[0].scale.x = 2;
  assert.throws(() => pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, scaled, prototype), /must retain donor identity scale/);
});

test("path-frame instance observer treats sweep width as a non-scaling hint", () => {
  const { source, sourceHash, frameSet, instanceSet, prototype } = fixture();
  const wider = structuredClone(instanceSet);
  for (const instance of wider.paths[0].instances) instance.sweepHalfWidth = 0.2;
  const a = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, instanceSet, prototype);
  const b = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, wider, prototype);
  assert.equal(a.observation.geometry_sha256, b.observation.geometry_sha256);
});
