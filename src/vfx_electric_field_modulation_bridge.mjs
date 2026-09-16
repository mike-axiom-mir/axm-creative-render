import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const MAX_PATHS = 32;
const MAX_POINTS_PER_PATH = 65;
const MAX_SCENE_TRIANGLES = 4_096;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function bounded(value, min, max, label) {
  const number = finite(value, label);
  if (number < min || number > max) throw new Error(`${label} must be within [${min},${max}]`);
  return number;
}

function validatePaths(paths, label) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_PATHS) throw new Error(`${label} path count must be within 1..${MAX_PATHS}`);
  const ids = new Set();
  let segments = 0;
  for (const [pathIndex, pathValue] of paths.entries()) {
    const path = object(pathValue, `${label}[${pathIndex}]`);
    const id = text(path.id, `${label}[${pathIndex}].id`);
    if (ids.has(id)) throw new Error(`${label} contains duplicate path id ${id}`);
    ids.add(id);
    if (path.role !== "trunk" && path.role !== "branch") throw new Error(`${label}[${pathIndex}].role must be trunk or branch`);
    if (!Array.isArray(path.points) || path.points.length < 2 || path.points.length > MAX_POINTS_PER_PATH) throw new Error(`${label}[${pathIndex}].points must contain 2..${MAX_POINTS_PER_PATH} points`);
    for (const [pointIndex, pointValue] of path.points.entries()) {
      const point = object(pointValue, `${label}[${pathIndex}].points[${pointIndex}]`);
      bounded(point.x, 0, 1, `${label}[${pathIndex}].points[${pointIndex}].x`);
      bounded(point.y, 0, 1, `${label}[${pathIndex}].points[${pointIndex}].y`);
    }
    bounded(path.energy, 0, 4, `${label}[${pathIndex}].energy`);
    bounded(path.width, 0.01, 4, `${label}[${pathIndex}].width`);
    finite(path.phase, `${label}[${pathIndex}].phase`);
    if (path.role === "branch") text(path.parent, `${label}[${pathIndex}].parent`);
    segments += path.points.length - 1;
  }
  if (segments * 2 > MAX_SCENE_TRIANGLES) throw new Error(`${label} exceeds native scene triangle ceiling`);
  return { pathCount: paths.length, segmentCount: segments };
}

function retainedPathValue(path) {
  const copy = structuredClone(path);
  delete copy.energy;
  delete copy.scalarModulation;
  return copy;
}

function rendererLayoutValue(path) {
  const copy = retainedPathValue(path);
  delete copy.phase;
  return copy;
}

export function electricPathLayoutSha256(paths) {
  return sha256(Buffer.from(JSON.stringify(paths.map(rendererLayoutValue)), "utf8"));
}

function energyStats(paths) {
  const values = paths.map((path) => Number(path.energy));
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    samples: values.length,
  };
}

function colorForEnergy(energy, role) {
  const v = Math.min(1, bounded(energy, 0, 4, "electric path energy") / 1.15);
  if (role === "trunk") return [55 + Math.round(105 * v), 80 + Math.round(150 * v), 120 + Math.round(135 * v)];
  return [35 + Math.round(95 * v), 65 + Math.round(145 * v), 105 + Math.round(145 * v)];
}

function scenePoint(point) {
  return [(point.x - 0.5) * 1.65, (0.5 - point.y) * 0.92, 0];
}

function pushQuad(triangles, a, b, halfWidth, albedo) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  if (length <= 1e-12) return;
  const px = -dy / length * halfWidth, py = dx / length * halfWidth;
  const p0 = [a[0] + px, a[1] + py, 0], p1 = [b[0] + px, b[1] + py, 0];
  const p2 = [b[0] - px, b[1] - py, 0], p3 = [a[0] - px, a[1] - py, 0];
  triangles.push({ vertices: [p0, p1, p2], albedo: [...albedo] }, { vertices: [p0, p2, p3], albedo: [...albedo] });
}

export function electricPathsToAxmScene(paths, kind, identity) {
  const counts = validatePaths(paths, `${kind} electric paths`);
  const source = object(identity, `${kind} source identity`);
  text(source.source_hash, `${kind} source identity hash`);
  if (kind !== "base" && kind !== "modulated") throw new Error("electric path scene kind must be base or modulated");
  if (kind === "modulated") {
    if (source.source_schema !== "axm.electric-modulated-path-set/v0.1") throw new Error(`unexpected modulated source schema: ${String(source.source_schema)}`);
    if (source.derived !== true || source.rebuildable !== true) throw new Error("modulated electric path set must remain derived and rebuildable");
    text(source.base_paths_hash, "modulated base paths hash");
  }

  const triangles = [];
  for (const path of paths) {
    const albedo = colorForEnergy(path.energy, path.role);
    const halfWidth = Math.max(0.0022, 0.0035 * path.width);
    for (let i = 0; i < path.points.length - 1; i += 1) {
      pushQuad(triangles, scenePoint(path.points[i]), scenePoint(path.points[i + 1]), halfWidth, albedo);
    }
  }
  if (triangles.length < 1 || triangles.length > MAX_SCENE_TRIANGLES) throw new Error(`derived electric scene triangle count outside 1..${MAX_SCENE_TRIANGLES}`);
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangles.length) throw new Error("electric scene triangle count changed during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-electric-paths-to-axm-scene/v1",
      path_kind: kind,
      source_schema: source.source_schema ?? "VFX_RETAINED_ELECTRIC_PATHS_ARRAY",
      source_hash: source.source_hash,
      base_paths_hash: source.base_paths_hash ?? source.source_hash,
      geometry_layout_sha256: electricPathLayoutSha256(paths),
      path_count: counts.pathCount,
      segment_count: counts.segmentCount,
      energy: energyStats(paths),
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_energy: false,
      albedo_encodes_energy: true,
      semantic_lighting_preserved: false,
      adapter_policy: "retained electric path points and width become bounded fixed XY quads; path energy changes only declared RGB albedo, while bloom, atmosphere, pulse and physical-electricity meaning remain outside this adapter",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

export async function observeVisualEffectElectricFieldModulation(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    electric: resolve(rootPath, "hand-lab/src/electric-hands.mjs"),
    field: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
    composition: resolve(rootPath, "hand-lab/src/field-composition-operators.mjs"),
    modulation: resolve(rootPath, "hand-lab/src/electric-field-modulation.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const modulation = await import(`${pathToFileURL(paths.modulation).href}?sha=${sources.modulation.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(modulation.ELECTRIC_FIELD_MODULATION_HANDS) || !modulation.ELECTRIC_FIELD_MODULATION_GRAPH) throw new Error("VFX donor electric field-modulation graph is unavailable");
  if (typeof modulation.makeElectricFieldModulationState !== "function") throw new Error("VFX donor electric field-modulation state factory is unavailable");
  const graph = modulation.ELECTRIC_FIELD_MODULATION_GRAPH;
  if (graph.id !== "fx.electric-storm.composed-field-modulation" || graph.version !== "0.1.0") throw new Error("unexpected VFX electric field-modulation graph identity");

  const stateOptions = {
    id: String(options.id ?? "creative-render-electric-modulation"),
    strength: options.strength ?? 1,
    floor: options.floor ?? 0.08,
    electric: options.electric ?? {
      seed: 20260916,
      source: { x: 0.08, y: 0.56 },
      target: { x: 0.92, y: 0.40 },
      controls: { branchEnergyScale: 0.68, glowScale: 1 },
    },
    composition: options.composition ?? {
      id: "creative-render-electric-composition",
      operation: "multiply",
      a: { id: "creative-render-electric-broad", seed: 771, frequency: 2.2, octaves: 4, lacunarity: 2, gain: 0.56, offset: [0.11, -0.19] },
      b: { id: "creative-render-electric-detail", seed: 9021, frequency: 7.1, octaves: 3, lacunarity: 1.9, gain: 0.43, offset: [-0.27, 0.21] },
    },
  };

  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(modulation.ELECTRIC_FIELD_MODULATION_HANDS),
    graph,
    initialState: modulation.makeElectricFieldModulationState(stateOptions),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute(), second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("VFX electric field-modulation repeat verification failed");

  const finalState = object(first.finalState, "VFX electric field-modulation final state");
  const basePaths = finalState.paths;
  const baseCounts = validatePaths(basePaths, "VFX retained electric paths");
  text(finalState.electricBasePathsHash, "VFX retained electric path hash");
  if (runtime.hashValue(basePaths) !== finalState.electricBasePathsHash) throw new Error("VFX retained electric paths drifted after lineage capture");
  const modulated = object(finalState.modulatedElectricPathSets?.[stateOptions.id], "VFX modulated electric path set");
  if (modulated.schema !== "axm.electric-modulated-path-set/v0.1") throw new Error(`unexpected VFX modulated electric path schema: ${String(modulated.schema)}`);
  if (modulated.derived !== true || modulated.rebuildable !== true) throw new Error("VFX modulated electric path set must remain derived and rebuildable");
  const modCounts = validatePaths(modulated.paths, "VFX modulated electric paths");
  if (modulated.basePathsHash !== finalState.electricBasePathsHash) throw new Error("VFX modulated electric paths lost retained base identity");
  if (runtime.hashValue(modulated.paths) !== modulated.pathSetHash) throw new Error("VFX modulated electric path hash drifted");
  if (modulated.fieldCompositionSourceHash !== finalState.fieldCompositionSourceHash) throw new Error("VFX modulated electric paths lost composition-source identity");
  if (modulated.electricFieldModulationSourceHash !== finalState.electricFieldModulationSourceHash) throw new Error("VFX modulated electric paths lost modulation-source identity");
  if (modulated.inputAHash !== finalState.fieldSourceHashes?.a || modulated.inputBHash !== finalState.fieldSourceHashes?.b) throw new Error("VFX modulated electric paths lost scalar source identity");
  if (baseCounts.pathCount !== modCounts.pathCount || baseCounts.segmentCount !== modCounts.segmentCount) throw new Error("VFX electric modulation changed path topology counts");
  if (electricPathLayoutSha256(basePaths) !== electricPathLayoutSha256(modulated.paths)) throw new Error("VFX electric modulation changed renderer path layout");
  if (JSON.stringify(basePaths.map(retainedPathValue)) !== JSON.stringify(modulated.paths.map(retainedPathValue))) throw new Error("VFX electric modulation changed retained non-energy path state");
  if (modulated.factorStats?.samples !== basePaths.length) throw new Error("VFX electric modulation factor sample count drifted");
  const energyChanged = modulated.paths.some((path, index) => path.energy !== basePaths[index].energy);
  if (stateOptions.strength > 0 && !energyChanged) throw new Error("VFX electric modulation did not change derived path energy");

  return {
    basePaths: structuredClone(basePaths),
    modulated: structuredClone(modulated),
    stateBytes: Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8"),
    observation: {
      schema: "axm.creative-render.vfx-electric-field-modulation-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      graph_id: graph.id,
      graph_version: graph.version,
      donor_hand_ids: modulation.ELECTRIC_FIELD_MODULATION_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: first.finalStateHash,
      repeat_verification: "PASS",
      base_paths: {
        source_hash: finalState.electricBasePathsHash,
        layout_sha256: electricPathLayoutSha256(basePaths),
        path_count: baseCounts.pathCount,
        segment_count: baseCounts.segmentCount,
        energy: energyStats(basePaths),
      },
      composition_source: {
        schema: finalState.fieldCompositionSource?.schema,
        source_hash: finalState.fieldCompositionSourceHash,
        operation: finalState.fieldCompositionSource?.operation,
        input_a_hash: finalState.fieldSourceHashes?.a,
        input_b_hash: finalState.fieldSourceHashes?.b,
      },
      modulation_source: {
        schema: finalState.electricFieldModulationSource?.schema,
        source_hash: finalState.electricFieldModulationSourceHash,
        mode: finalState.electricFieldModulationSource?.mode,
        strength: finalState.electricFieldModulationSource?.strength,
        floor: finalState.electricFieldModulationSource?.floor,
      },
      modulated_paths: {
        schema: modulated.schema,
        path_set_hash: modulated.pathSetHash,
        base_paths_hash: modulated.basePathsHash,
        layout_sha256: electricPathLayoutSha256(modulated.paths),
        path_count: modCounts.pathCount,
        segment_count: modCounts.segmentCount,
        factor_stats: structuredClone(modulated.factorStats),
        energy: energyStats(modulated.paths),
        derived: modulated.derived,
        rebuildable: modulated.rebuildable,
      },
      invariants: {
        retained_base_hash_still_valid: true,
        non_energy_path_state_preserved: true,
        path_count_preserved: true,
        segment_count_preserved: true,
        renderer_layout_preserved: true,
        derived_energy_changed: energyChanged,
      },
      truth_boundary: {
        base_paths_authority: "RETAINED_VFX_ELECTRIC_PATH_STATE",
        scalar_sources_authority: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
        composition_authority: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
        modulation_control_authority: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE",
        modulated_paths_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        physical_electricity_proven: false,
        aesthetic_quality_proven: false,
      },
    },
  };
}
