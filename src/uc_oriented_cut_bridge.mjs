import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const SURFACE_SCHEMA = "axm.surface-3d/v0.1";
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

function digestObject(value) {
  return sha256(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
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

export function validateUcSurface(surface, label = "UC surface") {
  object(surface, label);
  if (surface.schema !== SURFACE_SCHEMA) {
    throw new Error(`${label} must use ${SURFACE_SCHEMA}`);
  }
  if (!Array.isArray(surface.primitives) || surface.primitives.length !== 1) {
    throw new Error(`${label} must contain exactly one primitive`);
  }
  const primitive = object(surface.primitives[0], `${label} primitive`);
  if (!Array.isArray(primitive.positions) || primitive.positions.length < 3 || primitive.positions.length > MAX_VERTICES) {
    throw new Error(`${label} positions must contain 3..${MAX_VERTICES} vertices`);
  }
  const positions = primitive.positions.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 3) throw new Error(`${label} position ${index} must be XYZ`);
    return point.map((value, axis) => finite(value, `${label} position ${index}[${axis}]`));
  });
  if (!Array.isArray(primitive.indices) || primitive.indices.length < 3 || primitive.indices.length % 3 !== 0) {
    throw new Error(`${label} indices must contain packed triangles`);
  }
  const triangleCount = primitive.indices.length / 3;
  if (triangleCount > MAX_TRIANGLES) throw new Error(`${label} exceeds ${MAX_TRIANGLES} triangles`);
  const indices = primitive.indices.map((value, index) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number >= positions.length) {
      throw new Error(`${label} index ${index} is out of range`);
    }
    return number;
  });
  if (primitive.normals !== undefined) {
    if (!Array.isArray(primitive.normals) || primitive.normals.length !== positions.length) {
      throw new Error(`${label} normals must match positions when present`);
    }
    primitive.normals.forEach((normal, index) => {
      if (!Array.isArray(normal) || normal.length !== 3) throw new Error(`${label} normal ${index} must be XYZ`);
      normal.forEach((value, axis) => finite(value, `${label} normal ${index}[${axis}]`));
    });
  }
  return {
    surface,
    primitive,
    positions,
    indices,
    vertexCount: positions.length,
    triangleCount,
    surfaceDigest: digestObject(surface),
  };
}

export function ucSurfaceToAxmScene(surface, options = {}) {
  const checked = validateUcSurface(surface);
  const albedo = options.albedo ?? [82, 180, 210];
  if (!Array.isArray(albedo) || albedo.length !== 3) throw new Error("UC surface adapter albedo must be RGB");
  const rgb = albedo.map((value, index) => byte(value, `UC surface adapter albedo[${index}]`));
  const triangles = [];
  for (let triangle = 0; triangle < checked.triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const ia = checked.indices[offset], ib = checked.indices[offset + 1], ic = checked.indices[offset + 2];
    triangles.push({
      vertices: [checked.positions[ia], checked.positions[ib], checked.positions[ic]].map((point) => [...point]),
      albedo: [...rgb],
    });
  }
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== checked.triangleCount) {
    throw new Error("UC surface to AXM scene triangle count changed during serialization");
  }
  return {
    bytes,
    scene,
    observation: {
      schema: "axm.creative-render.uc-surface-to-axm-scene/v1",
      source_surface_schema: SURFACE_SCHEMA,
      source_surface_digest: checked.surfaceDigest,
      source_vertex_count: checked.vertexCount,
      source_triangle_count: checked.triangleCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: reparsed.triangles.length,
      output_sha256: sha256(bytes),
      constant_albedo_rgb: rgb,
      indexed_topology_expanded: true,
      normals_preserved: false,
      material_semantics_preserved: false,
      adapter_policy: "one indexed UC surface triangle becomes one AXM_SCENE 1 triangle; normals and rich material semantics are omitted and a declared constant albedo is assigned",
    },
  };
}

export function verifyOrientedCutDonorBundle(bundle) {
  object(bundle, "oriented-cut donor bundle");
  if (bundle.contract !== "AXM_UC_ORIENTED_CUT_DONOR_BUNDLE" || bundle.version !== 1) {
    throw new Error("unexpected oriented-cut donor bundle contract");
  }
  const donor = object(bundle.donor, "donor identity");
  if (donor.repository !== "mike-axiom-mir/axm-universal-creation") throw new Error("unexpected oriented-cut donor repository");
  gitRevisionHex(donor.revision, "donor revision");
  if (donor.public_route !== "mesh-laser-oriented-hole") throw new Error("oriented-cut proof must exercise the public machine route");

  const source = object(bundle.source, "oriented-cut source");
  const cut = object(bundle.cut, "oriented-cut result");
  const sourceSha = sha256Hex(source.glb_sha256, "source GLB digest");
  const cutSha = sha256Hex(cut.glb_sha256, "cut GLB digest");
  if (sourceSha === cutSha) throw new Error("oriented cut did not change published GLB bytes");
  if (source.unchanged_after_cut !== true) throw new Error("oriented cut did not preserve source GLB bytes");
  if (cut.source_sha256 !== sourceSha) throw new Error("oriented-cut result lost exact source GLB identity");
  sha256Hex(cut.request_sha256, "oriented-cut request digest");
  sha256Hex(cut.source_frame_sha256, "oriented-cut source-frame digest");
  if (cut.operation !== "round-through-hole") throw new Error("this proof lane expects the bounded round-through-hole operation");

  const metrics = object(cut.metrics, "oriented-cut metrics");
  const sourceVolume = finite(metrics.source_volume, "source volume");
  const outputVolume = finite(metrics.output_volume, "output volume");
  const removedVolume = finite(metrics.removed_volume_by_closed_mesh, "removed volume");
  const alignment = finite(metrics.axis_alignment, "axis alignment");
  if (!(sourceVolume > outputVolume && outputVolume > 0 && removedVolume > 0)) {
    throw new Error("oriented-cut volume evidence does not prove bounded subtraction");
  }
  if (alignment < 0.999999 || alignment > 1.000001) throw new Error("oriented-cut axis was not bound to a proven source-frame axis");

  const topology = object(cut.output_topology, "oriented-cut output topology");
  if (topology.status !== "CLOSED_ORIENTED_EDGE_MANIFOLD_CANDIDATE" || topology.triangle_component_count !== 1) {
    throw new Error("oriented-cut output did not remain one closed oriented component");
  }
  const truth = object(cut.truth_boundary, "oriented-cut truth boundary");
  if (truth.source_file_mutated !== false || truth.axis_vector_bound_to_proven_source_frame !== true || truth.full_arbitrary_mesh_csg !== false) {
    throw new Error("oriented-cut truth boundary drifted");
  }
  if (truth.arbitrary_angle_relative_to_source_frame !== "NOT_SUPPORTED" || truth.output_to_next_arbitrary_cut_chaining !== "NOT_YET_SUPPORTED") {
    throw new Error("oriented-cut unsupported-boundary evidence drifted");
  }
  if (cut.glb_validation_passed !== true) throw new Error("published cut GLB did not pass donor validation");
  if (cut.repeat_surface_match !== true) throw new Error("oriented-cut surface did not repeat identically before publication");

  const sourceSurface = validateUcSurface(source.surface, "source UC surface");
  const cutSurface = validateUcSurface(cut.surface, "cut UC surface");
  if (cut.geometry?.triangles !== cutSurface.triangleCount || cut.geometry?.vertices !== cutSurface.vertexCount) {
    throw new Error("oriented-cut geometry counts do not match supplied cut surface");
  }
  if (sourceSurface.surfaceDigest === cutSurface.surfaceDigest) throw new Error("oriented cut did not change UC surface state");

  return {
    donor_revision: donor.revision,
    public_route: donor.public_route,
    source_glb_sha256: sourceSha,
    cut_glb_sha256: cutSha,
    request_sha256: cut.request_sha256,
    source_frame_sha256: cut.source_frame_sha256,
    source_volume: sourceVolume,
    output_volume: outputVolume,
    removed_volume: removedVolume,
    axis_alignment: alignment,
    source_surface_digest: sourceSurface.surfaceDigest,
    cut_surface_digest: cutSurface.surfaceDigest,
    source_triangles: sourceSurface.triangleCount,
    cut_triangles: cutSurface.triangleCount,
  };
}

export function buildUcOrientedCutScenePair(bundleBytes, options = {}) {
  const bytes = Buffer.isBuffer(bundleBytes) ? bundleBytes : Buffer.from(bundleBytes);
  let bundle;
  try {
    bundle = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid oriented-cut donor bundle JSON: ${error.message}`);
  }
  const donorObservation = verifyOrientedCutDonorBundle(bundle);
  const albedo = options.albedo ?? [82, 180, 210];
  const source = ucSurfaceToAxmScene(bundle.source.surface, { albedo });
  const cut = ucSurfaceToAxmScene(bundle.cut.surface, { albedo });
  if (source.observation.output_sha256 === cut.observation.output_sha256) {
    throw new Error("oriented-cut source and cut scenes are byte-identical");
  }
  return {
    sourceSceneBytes: source.bytes,
    cutSceneBytes: cut.bytes,
    observation: {
      schema: "axm.creative-render.uc-oriented-cut-render-bridge/v1",
      donor_bundle_sha256: sha256(bytes),
      donor: donorObservation,
      source_scene: source.observation,
      cut_scene: cut.observation,
      source_preserved: true,
      same_adapter_albedo: JSON.stringify(source.observation.constant_albedo_rgb) === JSON.stringify(cut.observation.constant_albedo_rgb),
      authority: {
        source_glb: "CALLER_SELECTED_READ_ONLY_DONOR_SOURCE",
        cut_glb_and_surface: "DERIVED_UC_CREATIVE_CANDIDATE",
        axm_scenes: "DERIVED_RENDERER_ADAPTER_STATE",
        pixels: "DERIVED_RENDER_FABRIC_OUTPUT",
      },
      truth_boundary: {
        proves: [
          "the current pinned Universal Creation public oriented-cut route can subtract a bounded round hole from a rotated and translated rectangular-prism GLB while preserving the exact source bytes",
          "the exact donor source and cut surface states can be adapted into distinct AXM_SCENE 1 triangle bodies with the same declared adapter albedo",
          "source-frame, request, topology, volume, publication-validation, and unsupported-operation evidence remain explicit across the handoff",
        ],
        does_not_prove: [
          "general arbitrary-mesh CSG or arbitrary-angle cutting relative to the source frame",
          "cut-output chaining as a general next-cut source",
          "UV, texture, tangent, vertex-color, rich material, skin, rig, or animation preservation through AXM_SCENE 1",
          "self-intersection freedom, structural strength, manufacturing correctness, host-engine import, or visual quality",
          "native Render Fabric pixels until an external renderer workflow consumes and receipt-verifies both scenes",
        ],
      },
    },
  };
}
