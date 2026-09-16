import assert from "node:assert/strict";
import test from "node:test";
import { buildUcRigidSceneGraphScenePair } from "../src/uc_rigid_scene_graph_bridge.mjs";
import { sha256 } from "../src/creative_scene_operator.mjs";

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function fixture({ rebound = false, nonUnitScale = false } = {}) {
  const chunks = [];
  let binaryLength = 0;
  function append(buffer, target) {
    const pad = (4 - (binaryLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      binaryLength += pad;
    }
    const offset = binaryLength;
    chunks.push(buffer);
    binaryLength += buffer.length;
    return { buffer: 0, byteOffset: offset, byteLength: buffer.length, target };
  }
  const positions = [
    [[-0.8, -0.2, 0], [-0.55, -0.2, 0], [-0.8, 0.05, 0]],
    [[0.15, -0.15, 0], [0.4, -0.15, 0], [0.15, 0.1, 0]],
  ];
  const views = [];
  const accessors = [];
  const meshes = [];
  for (let meshIndex = 0; meshIndex < positions.length; meshIndex += 1) {
    const positionBuffer = Buffer.alloc(positions[meshIndex].length * 12);
    positions[meshIndex].forEach((point, row) => point.forEach((value, axis) => positionBuffer.writeFloatLE(value, row * 12 + axis * 4)));
    const pView = views.push(append(positionBuffer, 34962)) - 1;
    const pAccessor = accessors.push({ bufferView: pView, componentType: 5126, count: 3, type: "VEC3" }) - 1;
    const indexBuffer = Buffer.alloc(6);
    [0, 1, 2].forEach((value, index) => indexBuffer.writeUInt16LE(value, index * 2));
    const iView = views.push(append(indexBuffer, 34963)) - 1;
    const iAccessor = accessors.push({ bufferView: iView, componentType: 5123, count: 3, type: "SCALAR" }) - 1;
    meshes.push({ name: `mesh-${meshIndex}`, primitives: [{ attributes: { POSITION: pAccessor }, indices: iAccessor, mode: 4 }] });
  }
  const declaredBin = Buffer.concat(chunks);
  const paddedBin = Buffer.concat([declaredBin, Buffer.alloc((4 - (declaredBin.length % 4)) % 4)]);
  const nodes = rebound
    ? [
        { name: "parent", mesh: 0, translation: [0.25, 0.25, 0], scale: nonUnitScale ? [2, 1, 1] : [1, 1, 1], children: [1] },
        { name: "child", mesh: 1, translation: [0.1, 0, 0], scale: [1, 1, 1] },
      ]
    : [
        { name: "parent", mesh: 0, translation: [0, 0, 0], scale: [1, 1, 1] },
        { name: "child", mesh: 1, translation: [0, 0, 0], scale: [1, 1, 1] },
      ];
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: rebound ? [0] : [0, 1] }],
    nodes,
    meshes,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: declaredBin.length }],
  };
  const json = Buffer.from(JSON.stringify(document), "utf8");
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + jsonPadded.length + 8 + paddedBin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBin.length, 0);
  binHeader.writeUInt32LE(BIN_CHUNK, 4);
  return { body: Buffer.concat([header, jsonHeader, jsonPadded, binHeader, paddedBin]), bin: paddedBin };
}

function bundle(source, rebound) {
  const manifestSha = sha256(Buffer.from("caller-authored-rigid-manifest\n"));
  return {
    contract: "AXM_UC_RIGID_SCENE_GRAPH_DONOR_BUNDLE",
    version: 1,
    donor: {
      repository: "mike-axiom-mir/axm-universal-creation",
      revision: "1b9b6ce1feae6fdc5b1c9ffd067f81d5c39fb8a8",
      capability: "rebind_rigid_scene_graph",
      graph_schema: "axm.rigid-scene-graph/v0.1",
    },
    source: {
      glb_sha256: sha256(source.body),
      specification_sha256: sha256(Buffer.from("source-specification\n")),
      unchanged_after_rebind: true,
    },
    rebound: {
      glb_sha256: sha256(rebound.body),
      manifest_sha256: manifestSha,
      receipt: {
        schema: "axm.rigid-scene-graph-receipt/v0.1",
        result: "PASS_RIGID_SCENE_GRAPH_REBIND",
        input_glb_sha256: sha256(source.body),
        output_glb_sha256: sha256(rebound.body),
        manifest_sha256: manifestSha,
        binary_chunk_sha256: sha256(source.bin),
        binary_geometry_payload_identical: true,
        triangles_before: 2,
        triangles_after: 2,
        parent_edges: 1,
        truth_boundary: {
          caller_authored_node_names_parents_and_transforms: true,
          uc_inferred_domain_ownership: false,
          mesh_or_material_bytes_reauthored: false,
          animation_clip_authored: false,
          runtime_controller_or_gameplay_proven: false,
          host_import_or_visual_quality_proven: false,
        },
      },
    },
  };
}

test("identical GLB geometry payload resolves through a different caller-authored rigid hierarchy", () => {
  const source = fixture();
  const rebound = fixture({ rebound: true });
  assert.deepEqual(source.bin, rebound.bin);
  const donorBundle = bundle(source, rebound);
  const built = buildUcRigidSceneGraphScenePair(Buffer.from(JSON.stringify(donorBundle)), source.body, rebound.body);
  assert.equal(built.observation.exact_binary_geometry_payload_preserved, true);
  assert.equal(built.observation.source_scene.output_triangle_count, 2);
  assert.equal(built.observation.rebound_scene.output_triangle_count, 2);
  assert.notEqual(built.observation.source_scene.graph_digest, built.observation.rebound_scene.graph_digest);
  assert.notEqual(built.observation.source_scene.output_sha256, built.observation.rebound_scene.output_sha256);
  const child = built.observation.rebound_scene.graph.nodes.find((row) => row.name === "child");
  assert.deepEqual(child.world_translation, [0.35, 0.25, 0]);
  assert.equal(child.parent, "parent");
  assert.deepEqual(built.observation.rebound_scene.graph.roots, ["parent"]);
});

test("binary payload drift fails closed even when bundle digests are updated around it", () => {
  const source = fixture();
  const rebound = fixture({ rebound: true });
  const mutated = Buffer.from(rebound.body);
  mutated[mutated.length - 1] ^= 1;
  const donorBundle = bundle(source, rebound);
  donorBundle.rebound.glb_sha256 = sha256(mutated);
  donorBundle.rebound.receipt.output_glb_sha256 = sha256(mutated);
  assert.throws(
    () => buildUcRigidSceneGraphScenePair(Buffer.from(JSON.stringify(donorBundle)), source.body, mutated),
    /do not preserve exact BIN chunk bytes/,
  );
});

test("non-rigid scale remains outside the bounded scene-graph render proof", () => {
  const source = fixture();
  const rebound = fixture({ rebound: true, nonUnitScale: true });
  const donorBundle = bundle(source, rebound);
  assert.throws(
    () => buildUcRigidSceneGraphScenePair(Buffer.from(JSON.stringify(donorBundle)), source.body, rebound.body),
    /non-unit scale is outside this rigid proof boundary/,
  );
});
