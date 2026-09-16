import test from "node:test";
import assert from "node:assert/strict";

import { refinedSurfaceToUcPrecisionMesh } from "../src/vfx_uc_live_edit_bridge.mjs";
import { precisionMeshToAxmScene } from "../src/donor_bridge.mjs";
import { serializeScene, sha256 } from "../src/creative_scene_operator.mjs";

function fixtureSurface() {
  return {
    schema: "axm.holographic-triangle-surface/v0.2",
    method: "marching-tetrahedra-plus-feature-preserving-refine",
    derived: true,
    rebuildable: true,
    sourceVoxelDigest: "voxel-fixture",
    parentMeshDigest: "parent-fixture",
    triangleCount: 2,
    vertices: [
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
      -0.5, -0.5, 0.4, 0.5, -0.5, 0.4, 0, 0.6, 0.4,
    ],
    normals: [
      0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ],
    refinement: {
      iterations: 2,
      lambda: 0.18,
      featurePreserve: 0.72,
      maxMove: 0.02,
      uniqueVertices: 6,
      movedSamples: 6,
      meanAppliedMove: 0.005,
      maxAppliedMove: 0.01,
    },
    digest: "refined-fixture",
  };
}

test("refined VFX triangle state becomes bounded caller-owned UC precision-mesh state", () => {
  const source = fixtureSurface();
  const original = structuredClone(source);
  const result = refinedSurfaceToUcPrecisionMesh(source, { id: "fixture-vfx-surface" });

  assert.deepEqual(source, original);
  assert.equal(result.mesh.schema, "axm.precision-mesh/v1");
  assert.equal(result.mesh.version, "1.0.0");
  assert.equal(result.mesh.id, "fixture-vfx-surface");
  assert.deepEqual(result.mesh.positions, source.vertices);
  assert.deepEqual(result.mesh.normals, source.normals);
  assert.deepEqual(result.mesh.indices, [0, 1, 2, 3, 4, 5]);
  assert.equal(result.mesh.uvs.length, 12);
  assert(result.mesh.uvs.every((value) => value === 0));
  assert.equal(result.observation.source_surface_digest, source.digest);
  assert.equal(result.observation.source_parent_mesh_digest, source.parentMeshDigest);
  assert.equal(result.observation.output_triangle_count, 2);
  assert.equal(result.observation.normals_carried, true);
  assert.equal(result.observation.uvs_preserved, false);
  assert.equal(result.observation.topology_semantics_preserved, false);

  const scene = precisionMeshToAxmScene(result.mesh, { scale: 1, albedo: [72, 220, 180] });
  const sceneBytes = Buffer.from(serializeScene(scene), "utf8");
  assert.equal(scene.triangles.length, 2);
  assert.equal(typeof sha256(sceneBytes), "string");
});

test("refined-surface adapter fails closed on old schema or inconsistent normal evidence", () => {
  const old = fixtureSurface();
  old.schema = "axm.holographic-triangle-surface/v0.1";
  assert.throws(() => refinedSurfaceToUcPrecisionMesh(old), /unexpected refined VFX surface schema/);

  const badNormals = fixtureSurface();
  badNormals.normals.pop();
  assert.throws(() => refinedSurfaceToUcPrecisionMesh(badNormals), /normals must match positions/);

  const badCount = fixtureSurface();
  badCount.triangleCount = 3;
  assert.throws(() => refinedSurfaceToUcPrecisionMesh(badCount), /triangle count drifted/);
});
