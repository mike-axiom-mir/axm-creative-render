import test from "node:test";
import assert from "node:assert/strict";

import { precisionMeshToPhysicsProxy } from "../src/vfx_uc_physics_proxy_bridge.mjs";

function mesh() {
  return {
    schema: "axm.precision-mesh/v1",
    version: "1.0.0",
    id: "proxy-test",
    positions: [
      -2, -1, 0,
       2, -1, 0,
       2,  3, 0,
      -2, -1, 0,
       2,  3, 0,
      -2,  3, 0,
    ],
    normals: new Array(18).fill(0),
    uvs: new Array(12).fill(0),
    indices: [0, 1, 2, 3, 4, 5],
    metadata: { source: "test" },
    digest: "caller-digest-not-used-as-adapter-truth",
  };
}

test("precision mesh becomes an explicit 2D X/Y AABB physics proxy", () => {
  const first = precisionMeshToPhysicsProxy(mesh());
  const second = precisionMeshToPhysicsProxy(mesh());
  assert.deepEqual(first, second);
  assert.equal(first.proxy.schema, "axm.creative-render.physics-proxy-2d/v1");
  assert.equal(first.proxy.projection, "precision-mesh-x-y-axis-aligned-bounds");
  assert.deepEqual(first.proxy.shape, { kind: "box", halfWidth: 2, halfHeight: 2 });
  assert.deepEqual(first.proxy.source_bounds_xy.center, { x: 0, y: 1 });
  assert.equal(first.observation.source_triangle_count, 2);
  assert.equal(first.observation.mesh_collision_preserved, false);
  assert.equal(first.observation.z_axis_represented, false);
  assert.equal(first.proxy.source_mesh_sha256.length, 64);
});

test("flat source axes are padded explicitly instead of pretending zero-size physics", () => {
  const flat = mesh();
  for (let index = 1; index < flat.positions.length; index += 3) flat.positions[index] = 4;
  const result = precisionMeshToPhysicsProxy(flat, { minHalfExtent: 0.025 });
  assert.equal(result.proxy.shape.halfHeight, 0.025);
  assert.equal(result.proxy.padding_applied.y, true);
  assert.equal(result.observation.padding_applied.y, true);
});

test("physics proxy adapter fails closed on non-precision or malformed meshes", () => {
  assert.throws(() => precisionMeshToPhysicsProxy({ schema: "other", positions: [0, 0, 0], indices: [0, 0, 0] }), /axm\.precision-mesh\/v1/);
  const bad = mesh();
  bad.positions[2] = Number.NaN;
  assert.throws(() => precisionMeshToPhysicsProxy(bad), /must be finite/);
});
