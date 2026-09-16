import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const MAX_GRID_CELLS = 4_096;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return number;
}

function scalar(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${label} must be finite and within 0..1`);
  }
  return number;
}

function validateGrid(field) {
  object(field, "domain-warp scalar grid");
  if (field.schema !== "axm.domain-warp-grid/v0.1") {
    throw new Error(`unexpected domain-warp grid schema: ${String(field.schema)}`);
  }
  if (field.derived !== true || field.rebuildable !== true) {
    throw new Error("domain-warp grid must remain explicitly derived and rebuildable");
  }
  const width = integer(field.width, "domain-warp grid width", 4, 128);
  const height = integer(field.height, "domain-warp grid height", 4, 128);
  const cells = width * height;
  if (cells > MAX_GRID_CELLS) throw new Error(`domain-warp grid exceeds ${MAX_GRID_CELLS}-cell scene-adapter ceiling`);
  if (!Array.isArray(field.values) || field.values.length !== cells) {
    throw new Error("domain-warp grid values must match width*height");
  }
  field.values.forEach((value, index) => scalar(value, `domain-warp grid value[${index}]`));
  for (const [key, label] of [
    ["warpSourceHash", "warp source hash"],
    ["baseSourceHash", "base source hash"],
    ["flowSourceHash", "flow source hash"],
    ["flowScalarSourceHash", "flow scalar source hash"],
    ["fieldHash", "field hash"],
  ]) {
    if (typeof field[key] !== "string" || !field[key]) throw new Error(`domain-warp grid requires ${label}`);
  }
  const maxDisplacement = Number(field.maxDisplacement);
  if (!Number.isFinite(maxDisplacement) || maxDisplacement < 0) {
    throw new Error("domain-warp grid maxDisplacement must be finite and non-negative");
  }
  return { width, height, cells, maxDisplacement };
}

function colorForScalar(value) {
  const v = scalar(value, "scalar albedo input");
  return [
    20 + Math.round(220 * v),
    32 + Math.round(188 * v),
    54 + Math.round(176 * v),
  ];
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export function domainWarpGridToAxmScene(field) {
  const { width, height, cells, maxDisplacement } = validateGrid(field);
  const triangles = [];
  for (let y = 0; y < height; y += 1) {
    const y0 = -1 + (2 * y) / height;
    const y1 = -1 + (2 * (y + 1)) / height;
    for (let x = 0; x < width; x += 1) {
      const x0 = -1 + (2 * x) / width;
      const x1 = -1 + (2 * (x + 1)) / width;
      const value = field.values[y * width + x];
      const albedo = colorForScalar(value);
      triangles.push(
        { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], albedo: [...albedo] },
        { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], albedo: [...albedo] },
      );
    }
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== cells * 2) throw new Error("domain-warp scene triangle count changed during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-domain-warp-grid-to-axm-scene/v1",
      source_grid_schema: field.schema,
      source_grid_hash: field.fieldHash,
      warp_source_hash: field.warpSourceHash,
      base_source_hash: field.baseSourceHash,
      flow_source_hash: field.flowSourceHash,
      flow_scalar_source_hash: field.flowScalarSourceHash,
      source_width: width,
      source_height: height,
      source_cells: cells,
      source_max_displacement: maxDisplacement,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: reparsed.triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_scalar_values: false,
      albedo_encodes_scalar_values: true,
      vector_displacement_encoded_as_geometry: false,
      consumer_semantics_preserved: false,
      adapter_policy: "each retained derived scalar-grid sample becomes one fixed XY tile made of two triangles; only the declared RGB albedo mapping encodes the sampled scalar value; vector displacement is retained as evidence but is not reinterpreted as scene geometry",
    },
  };
}

export async function observeVisualEffectDomainWarp(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    field: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
    flow: resolve(rootPath, "hand-lab/src/field-flow-operators.mjs"),
    warp: resolve(rootPath, "hand-lab/src/field-domain-warp-operators.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const modules = {};
  for (const [name, path] of Object.entries(paths)) {
    modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);
  }
  const { runtime, field, warp } = modules;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (typeof field.sampleFbmSource !== "function") throw new Error("VFX donor scalar sampler is unavailable");
  if (!Array.isArray(warp.DOMAIN_WARP_HANDS) || !warp.DOMAIN_WARP_GRAPH) {
    throw new Error("VFX donor domain-warp graph is unavailable");
  }
  if (typeof warp.makeDomainWarpState !== "function" || typeof warp.sampleDomainWarpSource !== "function") {
    throw new Error("VFX donor domain-warp state/sampler surface is unavailable");
  }
  if (warp.DOMAIN_WARP_GRAPH.id !== "fx.field.domain-warp2d" || warp.DOMAIN_WARP_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX domain-warp graph identity");
  }

  const stateOptions = {
    id: String(options.id ?? "creative-render-domain-warp"),
    amplitude: Number(options.amplitude ?? 0.18),
    field: options.field ?? {
      id: "creative-render-domain-base",
      seed: 90210,
      frequency: 4.5,
      octaves: 5,
      lacunarity: 2.15,
      gain: 0.57,
      offset: [0.2, -0.1],
    },
    flowField: options.flowField ?? {
      id: "creative-render-domain-flow-field",
      seed: 4404,
      frequency: 2.25,
      octaves: 4,
      lacunarity: 2.1,
      gain: 0.52,
      offset: [-0.35, 0.4],
    },
    flow: options.flow ?? {
      id: "creative-render-domain-flow",
      mode: "tangent",
      sampleStep: 0.01,
      strength: 1.4,
    },
  };

  const execute = (callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(warp.DOMAIN_WARP_HANDS),
    graph: warp.DOMAIN_WARP_GRAPH,
    initialState: warp.makeDomainWarpState(stateOptions),
    context: { callerKind },
  });
  const human = execute("human");
  const machine = execute("machine");
  if (human.finalStateHash !== machine.finalStateHash) {
    throw new Error("VFX domain-warp caller-neutral repeat verification failed");
  }

  const finalState = object(human.finalState, "VFX domain-warp final state");
  const baseSource = object(finalState.fieldSource, "VFX base scalar source");
  const flowScalarSource = object(finalState.flowFieldSource, "VFX flow scalar source");
  const flowSource = object(finalState.flowSource, "VFX flow source");
  const warpSource = object(finalState.warpSource, "VFX domain-warp source");
  if (baseSource.schema !== "axm.scalar-field-source/v0.1" || flowScalarSource.schema !== "axm.scalar-field-source/v0.1") {
    throw new Error("VFX domain-warp scalar source schema drifted");
  }
  if (flowSource.schema !== "axm.vector-flow-source/v0.1") throw new Error("VFX domain-warp flow source schema drifted");
  if (warpSource.schema !== "axm.domain-warp-source/v0.1") throw new Error("VFX domain-warp source schema drifted");
  if (runtime.hashValue(baseSource) !== finalState.fieldSourceHash) throw new Error("VFX base scalar source hash drifted");
  if (runtime.hashValue(flowScalarSource) !== finalState.flowFieldSourceHash) throw new Error("VFX flow scalar source hash drifted");
  if (runtime.hashValue(flowSource) !== finalState.flowSourceHash) throw new Error("VFX flow source hash drifted");
  if (runtime.hashValue(warpSource) !== finalState.warpSourceHash) throw new Error("VFX warp source hash drifted");
  if (warpSource.baseSource?.sourceHash !== finalState.fieldSourceHash) throw new Error("VFX warp source lost base-source lineage");
  if (warpSource.flowSource?.sourceHash !== finalState.flowSourceHash || warpSource.flowSource?.scalarSourceHash !== finalState.flowFieldSourceHash) {
    throw new Error("VFX warp source lost flow lineage");
  }
  if (Number(warpSource.amplitude) !== stateOptions.amplitude) throw new Error("VFX domain-warp amplitude drifted");

  const grid = object(finalState.domainWarpFields?.[warpSource.id], "VFX domain-warp grid");
  const shape = validateGrid(grid);
  if (grid.warpSourceHash !== finalState.warpSourceHash || grid.baseSourceHash !== finalState.fieldSourceHash) {
    throw new Error("VFX domain-warp grid lost warp/base lineage");
  }
  if (grid.flowSourceHash !== finalState.flowSourceHash || grid.flowScalarSourceHash !== finalState.flowFieldSourceHash) {
    throw new Error("VFX domain-warp grid lost flow lineage");
  }

  let zeroNoopVerified = false;
  if (stateOptions.amplitude === 0) {
    const probes = [[0.11, 0.19], [0.5, 0.5], [0.83, 0.27], [1, 1]];
    for (const [u, v] of probes) {
      const warped = warp.sampleDomainWarpSource(baseSource, flowScalarSource, flowSource, warpSource, u, v);
      const direct = field.sampleFbmSource(baseSource, u, v);
      if (warped.value !== direct || warped.displacementX !== 0 || warped.displacementY !== 0) {
        throw new Error("zero-amplitude domain warp is not an exact no-op against retained base scalar truth");
      }
    }
    zeroNoopVerified = true;
  }

  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  return {
    field: structuredClone(grid),
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-domain-warp-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      graph_id: warp.DOMAIN_WARP_GRAPH.id,
      graph_version: warp.DOMAIN_WARP_GRAPH.version,
      donor_hand_ids: warp.DOMAIN_WARP_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: human.finalStateHash,
      caller_neutral_repeat_verification: "PASS",
      amplitude: warpSource.amplitude,
      base_source: { id: baseSource.id, schema: baseSource.schema, source_hash: finalState.fieldSourceHash },
      flow_scalar_source: { id: flowScalarSource.id, schema: flowScalarSource.schema, source_hash: finalState.flowFieldSourceHash },
      flow_source: { id: flowSource.id, schema: flowSource.schema, source_hash: finalState.flowSourceHash },
      warp_source: { id: warpSource.id, schema: warpSource.schema, source_hash: finalState.warpSourceHash, amplitude: warpSource.amplitude },
      grid: {
        schema: grid.schema,
        field_hash: grid.fieldHash,
        width: shape.width,
        height: shape.height,
        cells: shape.cells,
        min: grid.min,
        max: grid.max,
        mean: grid.mean,
        max_displacement: shape.maxDisplacement,
        derived: grid.derived,
        rebuildable: grid.rebuildable,
      },
      zero_amplitude_exact_noop_verified: zeroNoopVerified,
      truth_boundary: {
        retained_sources_authority: "CANONICAL_VFX_SCALAR_AND_VECTOR_FIELD_SOURCES",
        warp_source_authority: "CANONICAL_NEUTRAL_VFX_DOMAIN_WARP_SOURCE",
        grid_authority: "DERIVED_REBUILDABLE_VFX_WORKING_SET",
        consumer_semantics_proven: false,
        aesthetic_quality_proven: false,
        physical_flow_behavior_proven: false,
      },
    },
  };
}
