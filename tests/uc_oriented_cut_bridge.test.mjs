import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUcOrientedCutScenePair,
  ucSurfaceToAxmScene,
  validateUcSurface,
  verifyOrientedCutDonorBundle,
} from "../src/uc_oriented_cut_bridge.mjs";
import { parseScene } from "../src/creative_scene_operator.mjs";

const sha256Hex = (c) => c.repeat(64);
const gitHex = (c) => c.repeat(40);

function surface(name, positions, indices) {
  return {
    schema: "axm.surface-3d/v0.1",
    name,
    primitives: [{
      id: "precision-cut-result",
      positions,
      normals: positions.map(() => [0, 0, 1]),
      indices,
      material: { color: "#527A91FF", metallic: 0.35, roughness: 0.42 },
    }],
  };
}

function bundle() {
  const sourceSurface = surface("source", [[0,0,0],[2,0,0],[2,2,0],[0,2,0]], [0,1,2,0,2,3]);
  const cutSurface = surface("cut", [[0,0,0],[2,0,0],[2,2,0],[1,1,0],[0,2,0]], [0,1,3,1,2,3,2,4,3]);
  return {
    contract: "AXM_UC_ORIENTED_CUT_DONOR_BUNDLE",
    version: 1,
    donor: {
      repository: "mike-axiom-mir/axm-universal-creation",
      revision: gitHex("a"),
      public_route: "mesh-laser-oriented-hole",
    },
    source: {
      glb_sha256: sha256Hex("b"),
      glb_bytes: 512,
      unchanged_after_cut: true,
      surface: sourceSurface,
    },
    cut: {
      glb_sha256: sha256Hex("c"),
      glb_bytes: 768,
      source_sha256: sha256Hex("b"),
      request_sha256: sha256Hex("d"),
      source_frame_sha256: sha256Hex("e"),
      operation: "round-through-hole",
      geometry: { vertices: 5, triangles: 3 },
      metrics: { source_volume: 24, output_volume: 20, removed_volume_by_closed_mesh: 4, axis_alignment: 1 },
      output_topology: { status: "CLOSED_ORIENTED_EDGE_MANIFOLD_CANDIDATE", triangle_component_count: 1 },
      glb_validation_passed: true,
      repeat_surface_match: true,
      truth_boundary: {
        source_file_mutated: false,
        axis_vector_bound_to_proven_source_frame: true,
        full_arbitrary_mesh_csg: false,
        arbitrary_angle_relative_to_source_frame: "NOT_SUPPORTED",
        output_to_next_arbitrary_cut_chaining: "NOT_YET_SUPPORTED",
      },
      surface: cutSurface,
    },
  };
}

test("UC surface adapter expands indexed geometry into AXM_SCENE 1 with explicit constant albedo", () => {
  const input = bundle().source.surface;
  const checked = validateUcSurface(input);
  assert.equal(checked.triangleCount, 2);
  const adapted = ucSurfaceToAxmScene(input, { albedo: [12, 34, 56] });
  const scene = parseScene(adapted.bytes.toString("utf8"));
  assert.equal(scene.triangles.length, 2);
  assert.deepEqual(scene.triangles[0].albedo, [12, 34, 56]);
  assert.equal(adapted.observation.normals_preserved, false);
  assert.equal(adapted.observation.material_semantics_preserved, false);
});

test("oriented-cut bundle preserves source authority and produces distinct derived scenes", () => {
  const input = bundle();
  const donor = verifyOrientedCutDonorBundle(input);
  assert.equal(donor.source_triangles, 2);
  assert.equal(donor.cut_triangles, 3);
  const pair = buildUcOrientedCutScenePair(Buffer.from(JSON.stringify(input)));
  assert.equal(pair.observation.source_preserved, true);
  assert.equal(pair.observation.same_adapter_albedo, true);
  assert.notEqual(pair.observation.source_scene.output_sha256, pair.observation.cut_scene.output_sha256);
  assert.equal(pair.observation.authority.cut_glb_and_surface, "DERIVED_UC_CREATIVE_CANDIDATE");
});

test("oriented-cut adapter fails closed when source mutation or unsupported authority boundaries drift", () => {
  const changed = bundle();
  changed.source.unchanged_after_cut = false;
  assert.throws(() => verifyOrientedCutDonorBundle(changed), /preserve source GLB bytes/);

  const arbitrary = bundle();
  arbitrary.cut.truth_boundary.full_arbitrary_mesh_csg = true;
  assert.throws(() => verifyOrientedCutDonorBundle(arbitrary), /truth boundary drifted/);

  const diagonal = bundle();
  diagonal.cut.metrics.axis_alignment = 0.71;
  assert.throws(() => verifyOrientedCutDonorBundle(diagonal), /proven source-frame axis/);

  const shortRevision = bundle();
  shortRevision.donor.revision = "abc123";
  assert.throws(() => verifyOrientedCutDonorBundle(shortRevision), /full lowercase Git object id/);
});

test("UC surface adapter rejects malformed topology and richer multi-primitive ambiguity", () => {
  const invalidIndex = bundle().source.surface;
  invalidIndex.primitives[0].indices[0] = 99;
  assert.throws(() => validateUcSurface(invalidIndex), /out of range/);

  const multi = bundle().source.surface;
  multi.primitives.push(structuredClone(multi.primitives[0]));
  assert.throws(() => validateUcSurface(multi), /exactly one primitive/);
});
