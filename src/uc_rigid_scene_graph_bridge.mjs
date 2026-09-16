import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_NODES = 128;
const MAX_VERTICES = 200_000;
const MAX_TRIANGLES = 400_000;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function byte(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 255) {
    throw new Error(`${label} must be an integer in 0..255`);
  }
  return number;
}

function sha256Hex(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function gitRevisionHex(value, label) {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    throw new Error(`${label} must be a full lowercase Git object id`);
  }
  return value;
}

function digestObject(value) {
  return sha256(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
}

function vec3(value, label, fallback = null) {
  if (value === undefined && fallback) return [...fallback];
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain three numbers`);
  return value.map((entry, index) => finite(entry, `${label}[${index}]`));
}

function quaternion(value, label) {
  if (value === undefined) return [0, 0, 0, 1];
  if (!Array.isArray(value) || value.length !== 4) throw new Error(`${label} must contain four numbers`);
  const q = value.map((entry, index) => finite(entry, `${label}[${index}]`));
  const norm = Math.hypot(...q);
  if (Math.abs(norm - 1) > 1e-6) throw new Error(`${label} must be a unit quaternion`);
  return q;
}

function quaternionMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotateVector(q, point) {
  const [x, y, z] = point;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function round12(value) {
  return Number(Number(value).toFixed(12));
}

function roundedVector(value) {
  return value.map(round12);
}

function parseGlb(glbBytes, label) {
  const body = Buffer.isBuffer(glbBytes) ? glbBytes : Buffer.from(glbBytes);
  if (body.length < 28) throw new Error(`${label} GLB is truncated`);
  if (body.readUInt32LE(0) !== GLB_MAGIC || body.readUInt32LE(4) !== 2 || body.readUInt32LE(8) !== body.length) {
    throw new Error(`${label} GLB header is invalid`);
  }
  let offset = 12;
  const chunks = [];
  while (offset < body.length) {
    if (offset + 8 > body.length) throw new Error(`${label} GLB chunk header is truncated`);
    const length = body.readUInt32LE(offset);
    const type = body.readUInt32LE(offset + 4);
    offset += 8;
    if (length % 4 !== 0 || offset + length > body.length) throw new Error(`${label} GLB chunk range is invalid`);
    chunks.push({ type, bytes: body.subarray(offset, offset + length) });
    offset += length;
  }
  if (chunks.length !== 2 || chunks[0].type !== JSON_CHUNK || chunks[1].type !== BIN_CHUNK) {
    throw new Error(`${label} GLB must contain one JSON chunk followed by one BIN chunk`);
  }
  const jsonBody = chunks[0].bytes.subarray(0, chunks[0].bytes.length).toString("utf8").replace(/[\u0000 ]+$/u, "");
  let document;
  try {
    document = JSON.parse(jsonBody);
  } catch (error) {
    throw new Error(`${label} GLB JSON is invalid: ${error.message}`);
  }
  object(document, `${label} GLB document`);
  if (document.asset?.version !== "2.0") throw new Error(`${label} GLB must declare glTF 2.0`);
  if (!Array.isArray(document.buffers) || document.buffers.length !== 1) throw new Error(`${label} GLB must declare exactly one buffer`);
  const declaredBytes = Number(document.buffers[0]?.byteLength);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > chunks[1].bytes.length || chunks[1].bytes.length - declaredBytes > 3) {
    throw new Error(`${label} GLB buffer length is invalid`);
  }
  return {
    bytes: body,
    document,
    jsonBytes: Buffer.from(jsonBody, "utf8"),
    binBytes: chunks[1].bytes,
    declaredBinBytes: chunks[1].bytes.subarray(0, declaredBytes),
    sha256: sha256(body),
    jsonSha256: sha256(Buffer.from(jsonBody, "utf8")),
    binSha256: sha256(chunks[1].bytes),
    declaredBinSha256: sha256(chunks[1].bytes.subarray(0, declaredBytes)),
  };
}

function readAccessor(parsed, accessorIndex, label) {
  const { document, declaredBinBytes } = parsed;
  const accessors = document.accessors;
  const views = document.bufferViews;
  if (!Array.isArray(accessors) || !Array.isArray(views)) throw new Error(`${label} requires accessors and bufferViews`);
  if (!Number.isSafeInteger(accessorIndex) || accessorIndex < 0 || accessorIndex >= accessors.length) {
    throw new Error(`${label} accessor index is out of range`);
  }
  const accessor = object(accessors[accessorIndex], `${label} accessor`);
  if (accessor.sparse !== undefined) throw new Error(`${label} sparse accessors are outside this proof boundary`);
  const viewIndex = accessor.bufferView;
  if (!Number.isSafeInteger(viewIndex) || viewIndex < 0 || viewIndex >= views.length) throw new Error(`${label} bufferView is out of range`);
  const view = object(views[viewIndex], `${label} bufferView`);
  if ((view.buffer ?? 0) !== 0) throw new Error(`${label} must use the single embedded buffer`);
  const component = {
    5123: { bytes: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) },
    5125: { bytes: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) },
    5126: { bytes: 4, read: (buffer, offset) => buffer.readFloatLE(offset) },
  }[accessor.componentType];
  if (!component) throw new Error(`${label} component type is unsupported`);
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  if (!width) throw new Error(`${label} accessor type is unsupported`);
  const count = Number(accessor.count);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_VERTICES * 3) throw new Error(`${label} accessor count is invalid`);
  const itemBytes = component.bytes * width;
  const stride = view.byteStride === undefined ? itemBytes : Number(view.byteStride);
  if (!Number.isSafeInteger(stride) || stride < itemBytes || stride > 252 || stride % component.bytes !== 0) {
    throw new Error(`${label} accessor stride is unsupported`);
  }
  const viewStart = Number(view.byteOffset ?? 0);
  const viewLength = Number(view.byteLength);
  const accessorOffset = Number(accessor.byteOffset ?? 0);
  if (![viewStart, viewLength, accessorOffset].every(Number.isSafeInteger) || viewStart < 0 || viewLength < 0 || accessorOffset < 0) {
    throw new Error(`${label} accessor byte range is invalid`);
  }
  const start = viewStart + accessorOffset;
  const lastEnd = start + (count - 1) * stride + itemBytes;
  if (start < viewStart || lastEnd > viewStart + viewLength || lastEnd > declaredBinBytes.length) {
    throw new Error(`${label} accessor exceeds its bufferView`);
  }
  const rows = [];
  for (let row = 0; row < count; row += 1) {
    const base = start + row * stride;
    const values = [];
    for (let column = 0; column < width; column += 1) {
      const value = component.read(declaredBinBytes, base + column * component.bytes);
      if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite value`);
      values.push(value);
    }
    rows.push(width === 1 ? values[0] : values);
  }
  return { rows, accessor };
}

function localTransform(node, label) {
  if (node.matrix !== undefined) throw new Error(`${label} matrix transforms are outside this rigid proof boundary`);
  const scale = vec3(node.scale, `${label}.scale`, [1, 1, 1]);
  if (scale.some((value) => Math.abs(value - 1) > 1e-9)) {
    throw new Error(`${label} non-unit scale is outside this rigid proof boundary`);
  }
  return {
    translation: vec3(node.translation, `${label}.translation`, [0, 0, 0]),
    rotation: quaternion(node.rotation, `${label}.rotation`),
  };
}

function sceneGraph(parsed, label) {
  const document = parsed.document;
  const nodes = document.nodes;
  const scenes = document.scenes;
  const sceneIndex = document.scene;
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > MAX_NODES) throw new Error(`${label} must contain 1..${MAX_NODES} nodes`);
  if (!Array.isArray(scenes) || !Number.isSafeInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) {
    throw new Error(`${label} selected scene is invalid`);
  }
  const roots = object(scenes[sceneIndex], `${label} selected scene`).nodes;
  if (!Array.isArray(roots) || roots.length < 1) throw new Error(`${label} selected scene must contain roots`);
  const parentByChild = new Map();
  const childrenByNode = new Map();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = object(nodes[index], `${label} node ${index}`);
    if (typeof node.name !== "string" || !node.name) throw new Error(`${label} node ${index} requires a stable name`);
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error(`${label} node ${node.name}.children must be an array`);
      const children = [];
      for (const child of node.children) {
        if (!Number.isSafeInteger(child) || child < 0 || child >= nodes.length || child === index) {
          throw new Error(`${label} node ${node.name} has an invalid child`);
        }
        if (parentByChild.has(child)) throw new Error(`${label} node ${child} has more than one parent`);
        parentByChild.set(child, index);
        children.push(child);
      }
      childrenByNode.set(index, children);
    }
  }
  const expectedRoots = [];
  for (let index = 0; index < nodes.length; index += 1) if (!parentByChild.has(index)) expectedRoots.push(index);
  const normalizedRoots = roots.map((root) => {
    if (!Number.isSafeInteger(root) || root < 0 || root >= nodes.length) throw new Error(`${label} has an invalid scene root`);
    return root;
  });
  if (new Set(normalizedRoots).size !== normalizedRoots.length || JSON.stringify([...normalizedRoots].sort((a, b) => a - b)) !== JSON.stringify(expectedRoots)) {
    throw new Error(`${label} selected roots do not exactly match the parent graph`);
  }

  const world = new Array(nodes.length);
  const visiting = new Set();
  const visited = new Set();
  function resolve(index) {
    if (world[index]) return world[index];
    if (visiting.has(index)) throw new Error(`${label} node graph contains a cycle`);
    visiting.add(index);
    const local = localTransform(nodes[index], `${label} node ${nodes[index].name}`);
    const parentIndex = parentByChild.get(index);
    let resolved;
    if (parentIndex === undefined) {
      resolved = { translation: local.translation, rotation: local.rotation };
    } else {
      const parent = resolve(parentIndex);
      resolved = {
        translation: add(parent.translation, rotateVector(parent.rotation, local.translation)),
        rotation: quaternionMultiply(parent.rotation, local.rotation),
      };
    }
    visiting.delete(index);
    visited.add(index);
    world[index] = { translation: roundedVector(resolved.translation), rotation: roundedVector(resolved.rotation) };
    return world[index];
  }
  for (const root of normalizedRoots) {
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      resolve(current);
      for (const child of childrenByNode.get(current) ?? []) stack.push(child);
    }
  }
  if (visited.size !== nodes.length) throw new Error(`${label} contains nodes unreachable from the selected scene`);
  return { nodes, roots: normalizedRoots, parentByChild, world };
}

export function glbRigidWorldToAxmScene(glbBytes, options = {}) {
  const label = options.label ?? "UC rigid GLB";
  const parsed = parseGlb(glbBytes, label);
  const graph = sceneGraph(parsed, label);
  const document = parsed.document;
  if (!Array.isArray(document.meshes)) throw new Error(`${label} requires meshes`);
  const albedo = options.albedo ?? [92, 188, 214];
  if (!Array.isArray(albedo) || albedo.length !== 3) throw new Error(`${label} adapter albedo must be RGB`);
  const rgb = albedo.map((value, index) => byte(value, `${label} adapter albedo[${index}]`));
  const triangles = [];
  const nodeEvidence = [];
  let vertexCount = 0;
  for (let nodeIndex = 0; nodeIndex < graph.nodes.length; nodeIndex += 1) {
    const node = graph.nodes[nodeIndex];
    const parentIndex = graph.parentByChild.get(nodeIndex);
    const world = graph.world[nodeIndex];
    let nodeTriangles = 0;
    if (node.mesh !== undefined) {
      if (!Number.isSafeInteger(node.mesh) || node.mesh < 0 || node.mesh >= document.meshes.length) throw new Error(`${label} node ${node.name} mesh is invalid`);
      const mesh = object(document.meshes[node.mesh], `${label} mesh ${node.mesh}`);
      if (!Array.isArray(mesh.primitives) || mesh.primitives.length < 1) throw new Error(`${label} mesh ${node.mesh} requires primitives`);
      for (let primitiveIndex = 0; primitiveIndex < mesh.primitives.length; primitiveIndex += 1) {
        const primitive = object(mesh.primitives[primitiveIndex], `${label} mesh ${node.mesh} primitive ${primitiveIndex}`);
        if ((primitive.mode ?? 4) !== 4) throw new Error(`${label} only supports triangle-list primitives`);
        const attributes = object(primitive.attributes, `${label} primitive attributes`);
        const positions = readAccessor(parsed, attributes.POSITION, `${label} POSITION`).rows;
        if (positions.some((row) => !Array.isArray(row) || row.length !== 3)) throw new Error(`${label} POSITION must be VEC3`);
        vertexCount += positions.length;
        if (vertexCount > MAX_VERTICES) throw new Error(`${label} exceeds ${MAX_VERTICES} decoded vertices`);
        if (primitive.indices === undefined) throw new Error(`${label} proof lane requires indexed triangle primitives`);
        const indices = readAccessor(parsed, primitive.indices, `${label} indices`).rows;
        if (indices.length % 3 !== 0) throw new Error(`${label} indices must contain complete triangles`);
        const transformed = positions.map((point) => roundedVector(add(world.translation, rotateVector(world.rotation, point))));
        for (let offset = 0; offset < indices.length; offset += 3) {
          const ids = [indices[offset], indices[offset + 1], indices[offset + 2]];
          if (ids.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= transformed.length)) {
            throw new Error(`${label} triangle index is out of range`);
          }
          triangles.push({ vertices: ids.map((index) => [...transformed[index]]), albedo: [...rgb] });
          nodeTriangles += 1;
          if (triangles.length > MAX_TRIANGLES) throw new Error(`${label} exceeds ${MAX_TRIANGLES} triangles`);
        }
      }
    }
    const local = localTransform(node, `${label} node ${node.name}`);
    nodeEvidence.push({
      index: nodeIndex,
      name: node.name,
      parent: parentIndex === undefined ? null : graph.nodes[parentIndex].name,
      local_translation: roundedVector(local.translation),
      local_rotation: roundedVector(local.rotation),
      world_translation: [...world.translation],
      world_rotation: [...world.rotation],
      mesh: node.mesh ?? null,
      triangles: nodeTriangles,
    });
  }
  if (triangles.length < 1) throw new Error(`${label} produced no renderable triangles`);
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangles.length) throw new Error(`${label} triangle count changed during AXM scene serialization`);
  const graphRecord = {
    roots: graph.roots.map((index) => graph.nodes[index].name),
    nodes: nodeEvidence.map(({ name, parent, local_translation, local_rotation, world_translation, world_rotation }) => ({
      name, parent, local_translation, local_rotation, world_translation, world_rotation,
    })),
  };
  return {
    bytes,
    scene,
    observation: {
      schema: "axm.creative-render.uc-rigid-world-scene/v1",
      source_glb_sha256: parsed.sha256,
      source_json_sha256: parsed.jsonSha256,
      source_bin_sha256: parsed.binSha256,
      source_declared_bin_sha256: parsed.declaredBinSha256,
      graph_digest: digestObject(graphRecord),
      graph: graphRecord,
      node_count: graph.nodes.length,
      root_count: graph.roots.length,
      decoded_vertex_count: vertexCount,
      output_triangle_count: triangles.length,
      output_contract: "AXM_SCENE 1",
      output_sha256: sha256(bytes),
      constant_albedo_rgb: rgb,
      transform_policy: "resolve caller-authored rigid glTF node translation/quaternion hierarchy into world-space triangle positions; require unit scale and reject matrix transforms",
      normals_preserved: false,
      rich_material_semantics_preserved: false,
    },
  };
}

export function verifyUcRigidSceneGraphDonorBundle(bundle, sourceGlbBytes, reboundGlbBytes) {
  object(bundle, "rigid scene-graph donor bundle");
  if (bundle.contract !== "AXM_UC_RIGID_SCENE_GRAPH_DONOR_BUNDLE" || bundle.version !== 1) {
    throw new Error("unexpected rigid scene-graph donor bundle contract");
  }
  const donor = object(bundle.donor, "rigid scene-graph donor identity");
  if (donor.repository !== "mike-axiom-mir/axm-universal-creation") throw new Error("unexpected rigid scene-graph donor repository");
  gitRevisionHex(donor.revision, "rigid scene-graph donor revision");
  if (donor.capability !== "rebind_rigid_scene_graph" || donor.graph_schema !== "axm.rigid-scene-graph/v0.1") {
    throw new Error("unexpected rigid scene-graph donor capability contract");
  }
  const source = object(bundle.source, "rigid scene-graph source evidence");
  const rebound = object(bundle.rebound, "rigid scene-graph rebound evidence");
  const sourceDigest = sha256Hex(source.glb_sha256, "source GLB digest");
  const reboundDigest = sha256Hex(rebound.glb_sha256, "rebound GLB digest");
  if (sourceDigest !== sha256(sourceGlbBytes) || reboundDigest !== sha256(reboundGlbBytes)) {
    throw new Error("rigid scene-graph bundle does not bind supplied GLB bytes");
  }
  if (sourceDigest === reboundDigest) throw new Error("rigid scene-graph rebind did not change GLB container bytes");
  if (source.unchanged_after_rebind !== true) throw new Error("rigid scene-graph donor did not preserve source GLB bytes");
  sha256Hex(source.specification_sha256, "source specification digest");
  sha256Hex(rebound.manifest_sha256, "rigid scene-graph manifest digest");
  const receipt = object(rebound.receipt, "rigid scene-graph donor receipt");
  if (receipt.schema !== "axm.rigid-scene-graph-receipt/v0.1" || receipt.result !== "PASS_RIGID_SCENE_GRAPH_REBIND") {
    throw new Error("rigid scene-graph donor receipt contract drifted");
  }
  if (receipt.input_glb_sha256 !== sourceDigest || receipt.output_glb_sha256 !== reboundDigest || receipt.manifest_sha256 !== rebound.manifest_sha256) {
    throw new Error("rigid scene-graph donor receipt lost exact input/output/manifest identity");
  }
  if (receipt.binary_geometry_payload_identical !== true) throw new Error("rigid scene-graph donor did not preserve binary geometry payload");
  if (!Number.isSafeInteger(receipt.triangles_before) || receipt.triangles_before < 1 || receipt.triangles_after !== receipt.triangles_before) {
    throw new Error("rigid scene-graph donor triangle-count continuity drifted");
  }
  if (!Number.isSafeInteger(receipt.parent_edges) || receipt.parent_edges < 1) throw new Error("rigid scene-graph proof requires at least one parent edge");
  const truth = object(receipt.truth_boundary, "rigid scene-graph donor truth boundary");
  if (truth.caller_authored_node_names_parents_and_transforms !== true || truth.uc_inferred_domain_ownership !== false || truth.mesh_or_material_bytes_reauthored !== false || truth.animation_clip_authored !== false || truth.runtime_controller_or_gameplay_proven !== false || truth.host_import_or_visual_quality_proven !== false) {
    throw new Error("rigid scene-graph donor truth boundary drifted");
  }
  const sourceParsed = parseGlb(sourceGlbBytes, "source rigid GLB");
  const reboundParsed = parseGlb(reboundGlbBytes, "rebound rigid GLB");
  if (sourceParsed.binSha256 !== reboundParsed.binSha256 || !sourceParsed.binBytes.equals(reboundParsed.binBytes)) {
    throw new Error("supplied source/rebound GLBs do not preserve exact BIN chunk bytes");
  }
  if (receipt.binary_chunk_sha256 !== sourceParsed.binSha256) throw new Error("donor binary chunk digest does not match supplied GLB bytes");
  return {
    donor_revision: donor.revision,
    source_glb_sha256: sourceDigest,
    rebound_glb_sha256: reboundDigest,
    manifest_sha256: rebound.manifest_sha256,
    binary_chunk_sha256: sourceParsed.binSha256,
    triangles: receipt.triangles_before,
    parent_edges: receipt.parent_edges,
  };
}

export function buildUcRigidSceneGraphScenePair(bundleBytes, sourceGlbBytes, reboundGlbBytes, options = {}) {
  const rawBundle = Buffer.isBuffer(bundleBytes) ? bundleBytes : Buffer.from(bundleBytes);
  let bundle;
  try {
    bundle = JSON.parse(rawBundle.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid rigid scene-graph donor bundle JSON: ${error.message}`);
  }
  const donor = verifyUcRigidSceneGraphDonorBundle(bundle, sourceGlbBytes, reboundGlbBytes);
  const albedo = options.albedo ?? [92, 188, 214];
  const source = glbRigidWorldToAxmScene(sourceGlbBytes, { albedo, label: "source rigid GLB" });
  const rebound = glbRigidWorldToAxmScene(reboundGlbBytes, { albedo, label: "rebound rigid GLB" });
  if (source.observation.source_bin_sha256 !== rebound.observation.source_bin_sha256) {
    throw new Error("rigid scene-graph pair lost binary geometry identity");
  }
  if (source.observation.output_triangle_count !== rebound.observation.output_triangle_count || source.observation.output_triangle_count !== donor.triangles) {
    throw new Error("rigid scene-graph pair changed triangle count across adapter boundary");
  }
  if (source.observation.graph_digest === rebound.observation.graph_digest) throw new Error("rigid scene-graph rebind did not change graph state");
  if (source.observation.output_sha256 === rebound.observation.output_sha256) {
    throw new Error("rigid scene-graph rebind did not change resolved world-space scene bytes");
  }
  return {
    sourceSceneBytes: source.bytes,
    reboundSceneBytes: rebound.bytes,
    observation: {
      schema: "axm.creative-render.uc-rigid-scene-graph-native-bridge/v1",
      donor_bundle_sha256: sha256(rawBundle),
      donor,
      source_scene: source.observation,
      rebound_scene: rebound.observation,
      exact_binary_geometry_payload_preserved: true,
      source_preserved: true,
      same_adapter_albedo: JSON.stringify(source.observation.constant_albedo_rgb) === JSON.stringify(rebound.observation.constant_albedo_rgb),
      authority: {
        source_glb: "CALLER_SELECTED_READ_ONLY_SOURCE",
        caller_manifest: "CALLER_AUTHORED_RIGID_GRAPH_INTENT",
        rebound_glb: "DERIVED_UC_SCENE_GRAPH_CANDIDATE",
        axm_scenes: "DERIVED_RENDERER_ADAPTER_STATE",
        pixels: "DERIVED_RENDER_FABRIC_OUTPUT",
      },
      truth_boundary: {
        proves: [
          "the pinned Universal Creation rigid scene-graph capability can transport caller-authored parentage and rigid transforms while preserving the exact GLB BIN geometry payload",
          "Creative Render can explicitly resolve the source and rebound rigid node graphs into distinct world-space AXM_SCENE 1 triangle bodies without promoting either derived body into canonical source truth",
          "the same declared adapter albedo and the same triangle count are retained across source and rebound renderer inputs",
        ],
        does_not_prove: [
          "host-engine or general glTF import correctness beyond the bounded parsed subset",
          "animation, skinning, physics, collision, gameplay, semantic part ownership, or runtime controller behavior",
          "non-rigid scale or matrix-transform support, rich material/texture preservation, or normal preservation through AXM_SCENE 1",
          "native Render Fabric pixel difference until an external workflow renders and receipt-verifies both derived scenes",
          "visual quality, aesthetic improvement, real-time performance, or cross-machine bitwise determinism",
        ],
      },
    },
  };
}
