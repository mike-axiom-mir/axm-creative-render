import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";
import { electricPathLayoutSha256 } from "./vfx_electric_field_modulation_bridge.mjs";

const MAX_PATHS = 64;
const MAX_POINTS = 4_096;
const MAX_SCENE_TRIANGLES = 8_192;
const round6 = (value) => Number(Number(value).toFixed(6));

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
  let pointCount = 0;
  let segmentCount = 0;
  for (const [pathIndex, pathValue] of paths.entries()) {
    const path = object(pathValue, `${label}[${pathIndex}]`);
    const id = text(path.id, `${label}[${pathIndex}].id`);
    if (ids.has(id)) throw new Error(`${label} contains duplicate path id ${id}`);
    ids.add(id);
    if (path.role !== "trunk" && path.role !== "branch") throw new Error(`${label}[${pathIndex}].role must be trunk or branch`);
    if (!Array.isArray(path.points) || path.points.length < 2) throw new Error(`${label}[${pathIndex}].points must contain at least two points`);
    pointCount += path.points.length;
    if (pointCount > MAX_POINTS) throw new Error(`${label} point count exceeds ${MAX_POINTS}`);
    for (const [pointIndex, pointValue] of path.points.entries()) {
      const point = object(pointValue, `${label}[${pathIndex}].points[${pointIndex}]`);
      bounded(point.x, 0, 1, `${label}[${pathIndex}].points[${pointIndex}].x`);
      bounded(point.y, 0, 1, `${label}[${pathIndex}].points[${pointIndex}].y`);
    }
    bounded(path.energy, 0, 4, `${label}[${pathIndex}].energy`);
    bounded(path.width, 0.01, 4, `${label}[${pathIndex}].width`);
    finite(path.phase, `${label}[${pathIndex}].phase`);
    if (path.role === "branch") text(path.parent, `${label}[${pathIndex}].parent`);
    segmentCount += path.points.length - 1;
  }
  if (segmentCount * 2 > MAX_SCENE_TRIANGLES) throw new Error(`${label} exceeds native scene triangle ceiling`);
  return { pathCount: paths.length, pointCount, segmentCount };
}

function nonEnergyPathValue(path) {
  const copy = structuredClone(path);
  delete copy.energy;
  return copy;
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

function scenePoint(point) {
  return [(point.x - 0.5) * 1.65, (0.5 - point.y) * 0.92, 0];
}

function pushQuad(triangles, a, b, halfWidth, albedo) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return;
  const px = (-dy / length) * halfWidth;
  const py = (dx / length) * halfWidth;
  const p0 = [a[0] + px, a[1] + py, 0];
  const p1 = [b[0] + px, b[1] + py, 0];
  const p2 = [b[0] - px, b[1] - py, 0];
  const p3 = [a[0] - px, a[1] - py, 0];
  triangles.push({ vertices: [p0, p1, p2], albedo: [...albedo] });
  triangles.push({ vertices: [p0, p2, p3], albedo: [...albedo] });
}

function neutralEnergyAlbedo(energy) {
  const normalized = Math.min(1, bounded(energy, 0, 4, "direct electric flicker energy") / 1.15);
  const value = 42 + Math.round(188 * normalized);
  return [value, value, value];
}

export function directElectricFlickerSetToAxmScene(selectedValue) {
  const selected = object(selectedValue, "direct electric flicker path set");
  if (selected.schema !== "axm.electric-flicker-modulated-path-set/v0.1") throw new Error(`unexpected direct electric flicker schema: ${String(selected.schema)}`);
  if (selected.derived !== true || selected.rebuildable !== true) throw new Error("direct electric flicker set must remain derived and rebuildable");
  text(selected.basePathsHash, "direct electric flicker base path hash");
  text(selected.flickerCycleSourceHash, "direct electric flicker cycle source hash");
  text(selected.electricFlickerModulationSourceHash, "direct electric flicker modulation source hash");
  text(selected.pathSetHash, "direct electric flicker path-set hash");
  text(selected.modulatedSetHash, "direct electric flicker modulated-set hash");
  const counts = validatePaths(selected.paths, "direct electric flicker paths");
  if (selected.pathCount !== counts.pathCount) throw new Error("direct electric flicker path count drifted");
  if (selected.pointCount !== counts.pointCount) throw new Error("direct electric flicker point count drifted");
  bounded(selected.factor, 0, 1, "direct electric flicker factor");
  bounded(selected.normalizedSample, 0, 1, "direct electric flicker normalized sample");

  const triangles = [];
  for (const path of selected.paths) {
    const albedo = neutralEnergyAlbedo(path.energy);
    const halfWidth = Math.max(0.0022, 0.0035 * path.width);
    for (let index = 0; index < path.points.length - 1; index += 1) {
      pushQuad(triangles, scenePoint(path.points[index]), scenePoint(path.points[index + 1]), halfWidth, albedo);
    }
  }
  if (triangles.length < 1 || triangles.length > MAX_SCENE_TRIANGLES) throw new Error(`direct electric flicker scene triangle count outside 1..${MAX_SCENE_TRIANGLES}`);
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangles.length) throw new Error("direct electric flicker scene triangle count changed during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-direct-electric-flicker-to-axm-scene/v1",
      source_schema: selected.schema,
      source_hash: selected.modulatedSetHash,
      path_set_hash: selected.pathSetHash,
      retained_base_paths_hash: selected.basePathsHash,
      retained_flicker_source_hash: selected.flickerCycleSourceHash,
      retained_modulation_source_hash: selected.electricFlickerModulationSourceHash,
      phase: selected.phase,
      factor: selected.factor,
      normalized_sample: selected.normalizedSample,
      geometry_layout_sha256: electricPathLayoutSha256(selected.paths),
      path_count: counts.pathCount,
      point_count: counts.pointCount,
      segment_count: counts.segmentCount,
      energy: energyStats(selected.paths),
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_flicker: false,
      albedo_encodes_derived_energy: true,
      semantic_lighting_preserved: false,
      adapter_policy: "source-verified derived electric path points and retained width become bounded fixed XY quads; donor-derived flicker energy changes only neutral grayscale albedo, while emission, bloom, physical-electricity, perceptual acceptance and application meaning remain outside this adapter",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function graphAtPhase(graph, phase) {
  return {
    ...structuredClone(graph),
    stages: graph.stages.map((stage) => stage.id === "modulate-derived-electric-paths"
      ? { ...structuredClone(stage), params: { ...(stage.params ?? {}), phase } }
      : structuredClone(stage)),
  };
}

function selectedSet(finalState, id) {
  return object(finalState.flickerModulatedElectricPathSets?.[id], `VFX direct electric flicker set ${id}`);
}

function modulatedSetHashPayload(set) {
  return {
    schema: set.schema,
    basePathsHash: set.basePathsHash,
    flickerCycleSourceHash: set.flickerCycleSourceHash,
    electricFlickerModulationSourceHash: set.electricFlickerModulationSourceHash,
    phase: set.phase,
    sampleValue: set.sampleValue,
    normalizedSample: set.normalizedSample,
    factor: set.factor,
    paths: set.paths,
    pathSetHash: set.pathSetHash,
    pathCount: set.pathCount,
    pointCount: set.pointCount,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

export async function observeVisualEffectDirectElectricFlicker(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    electric: resolve(rootPath, "hand-lab/src/electric-hands.mjs"),
    flicker: resolve(rootPath, "hand-lab/src/flicker-cycle1d.mjs"),
    modulation: resolve(rootPath, "hand-lab/src/electric-flicker-modulation.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const modulation = await import(`${pathToFileURL(paths.modulation).href}?sha=${sources.modulation.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(modulation.ELECTRIC_FLICKER_MODULATION_HANDS) || !modulation.ELECTRIC_FLICKER_MODULATION_GRAPH) throw new Error("VFX donor direct electric flicker graph is unavailable");
  if (typeof modulation.makeElectricFlickerModulationState !== "function" || typeof modulation.validateElectricFlickerModulatedPathSet !== "function") throw new Error("VFX donor direct electric flicker validation API is unavailable");
  const graph = modulation.ELECTRIC_FLICKER_MODULATION_GRAPH;
  if (graph.id !== "fx.electric-storm.flicker-cycle-modulation" || graph.version !== "0.1.0") throw new Error("unexpected VFX direct electric flicker graph identity");

  const stateOptions = {
    id: String(options.id ?? "creative-render-direct-electric-flicker"),
    strength: options.strength ?? 0.8,
    floor: options.floor ?? 0.22,
    electric: options.electric ?? {
      seed: 20260918,
      source: { x: 0.08, y: 0.56 },
      target: { x: 0.92, y: 0.40 },
      controls: { branchEnergyScale: 0.68, glowScale: 1 },
    },
    flicker: options.flicker ?? {
      id: "creative-render-direct-electric-flicker-cycle",
      seed: 7331,
      slotCount: 12,
      minValue: 0,
      maxValue: 1,
      responsePower: 1,
      phaseOffset: 0,
    },
  };
  const phaseA = options.phaseA ?? 0.11;
  const phaseB = options.phaseB ?? 0.43;

  const execute = (phase, callerKind, override = stateOptions) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(modulation.ELECTRIC_FLICKER_MODULATION_HANDS),
    graph: graphAtPhase(graph, phase),
    initialState: modulation.makeElectricFlickerModulationState(override),
    context: { callerKind },
  });

  const humanA = execute(phaseA, "human");
  const machineA = execute(phaseA, "machine");
  const humanB = execute(phaseB, "human");
  const machineB = execute(phaseB, "machine");
  if (humanA.finalStateHash !== machineA.finalStateHash || humanB.finalStateHash !== machineB.finalStateHash) throw new Error("VFX direct electric flicker caller-neutral replay failed");

  const stateA = object(humanA.finalState, "VFX direct electric flicker phase A state");
  const stateB = object(humanB.finalState, "VFX direct electric flicker phase B state");
  const setA = selectedSet(stateA, stateOptions.id);
  const setB = selectedSet(stateB, stateOptions.id);
  if (!modulation.validateElectricFlickerModulatedPathSet(stateA, setA) || !modulation.validateElectricFlickerModulatedPathSet(stateB, setB)) throw new Error("VFX direct electric flicker donor validation failed");
  if (stateA.electricBasePathsHash !== stateB.electricBasePathsHash) throw new Error("direct electric flicker phases changed retained electric base identity");
  if (stateA.flickerCycleSourceHash !== stateB.flickerCycleSourceHash) throw new Error("direct electric flicker phases changed retained flicker identity");
  if (stateA.electricFlickerModulationSourceHash !== stateB.electricFlickerModulationSourceHash) throw new Error("direct electric flicker phases changed retained modulation identity");
  if (electricPathLayoutSha256(setA.paths) !== electricPathLayoutSha256(setB.paths)) throw new Error("direct electric flicker phases changed renderer geometry layout");
  if (JSON.stringify(setA.paths.map(nonEnergyPathValue)) !== JSON.stringify(setB.paths.map(nonEnergyPathValue))) throw new Error("direct electric flicker phases changed non-energy path state");
  if (setA.factor === setB.factor) throw new Error("selected direct electric flicker phases did not produce distinct factors");

  const loopRun = execute(Number(phaseA) + 1, "human");
  const loopState = object(loopRun.finalState, "VFX direct electric flicker loop state");
  const loopSet = selectedSet(loopState, stateOptions.id);
  if (!modulation.validateElectricFlickerModulatedPathSet(loopState, loopSet)) throw new Error("VFX direct electric flicker loop validation failed");
  if (loopSet.modulatedSetHash !== setA.modulatedSetHash) throw new Error("direct electric flicker whole-cycle identity replay failed");

  const constantOptions = {
    ...structuredClone(stateOptions),
    id: `${stateOptions.id}-constant-range`,
    flicker: { ...structuredClone(stateOptions.flicker), id: `${stateOptions.flicker.id}-constant-range`, minValue: 0.55, maxValue: 0.55 },
  };
  const constantRun = execute(phaseA, "human", constantOptions);
  const constantState = object(constantRun.finalState, "VFX direct electric flicker constant-range state");
  const constantSet = selectedSet(constantState, constantOptions.id);
  if (!modulation.validateElectricFlickerModulatedPathSet(constantState, constantSet)) throw new Error("VFX direct electric flicker constant-range validation failed");
  if (constantSet.factor !== 1 || constantSet.pathSetHash !== constantState.electricBasePathsHash) throw new Error("constant flicker range did not remain an exact donor no-op");

  const zeroStrengthOptions = { ...structuredClone(stateOptions), id: `${stateOptions.id}-zero-strength`, strength: 0 };
  const zeroStrengthRun = execute(phaseB, "human", zeroStrengthOptions);
  const zeroStrengthState = object(zeroStrengthRun.finalState, "VFX direct electric flicker zero-strength state");
  const zeroStrengthSet = selectedSet(zeroStrengthState, zeroStrengthOptions.id);
  if (!modulation.validateElectricFlickerModulatedPathSet(zeroStrengthState, zeroStrengthSet)) throw new Error("VFX direct electric flicker zero-strength validation failed");
  if (zeroStrengthSet.factor !== 1 || zeroStrengthSet.pathSetHash !== zeroStrengthState.electricBasePathsHash) throw new Error("zero-strength modulation did not remain an exact donor no-op");

  const tampered = structuredClone(setA);
  tampered.paths[0].energy = round6(tampered.paths[0].energy + 0.01);
  tampered.pathSetHash = runtime.hashValue(tampered.paths);
  tampered.modulatedSetHash = runtime.hashValue(modulatedSetHashPayload(tampered));
  let selfConsistentTamperRejected = false;
  try {
    modulation.validateElectricFlickerModulatedPathSet(stateA, tampered);
  } catch (error) {
    selfConsistentTamperRejected = /does not rebuild from retained source truth/.test(String(error));
  }
  if (!selfConsistentTamperRejected) throw new Error("self-consistent direct electric flicker derived tamper was accepted");

  return {
    stateA: structuredClone(stateA),
    stateB: structuredClone(stateB),
    setA: structuredClone(setA),
    setB: structuredClone(setB),
    observation: {
      schema: "axm.creative-render.vfx-direct-electric-flicker-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      graph_id: graph.id,
      graph_version: graph.version,
      donor_hand_ids: modulation.ELECTRIC_FLICKER_MODULATION_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      caller_neutral_replay: "PASS",
      retained: {
        electric_base_paths_hash: stateA.electricBasePathsHash,
        flicker_cycle_source_hash: stateA.flickerCycleSourceHash,
        electric_flicker_modulation_source_hash: stateA.electricFlickerModulationSourceHash,
        flicker_source_schema: stateA.flickerCycleSource?.schema,
        flicker_algorithm: stateA.flickerCycleSource?.algorithm,
        modulation_source_schema: stateA.electricFlickerModulationSource?.schema,
        modulation_mode: stateA.electricFlickerModulationSource?.mode,
        modulation_mapping: stateA.electricFlickerModulationSource?.mapping,
        strength: stateA.electricFlickerModulationSource?.strength,
        floor: stateA.electricFlickerModulationSource?.floor,
      },
      derived: {
        phase_a: { modulated_set_hash: setA.modulatedSetHash, path_set_hash: setA.pathSetHash, phase: setA.phase, sample_value: setA.sampleValue, normalized_sample: setA.normalizedSample, factor: setA.factor, path_count: setA.pathCount, point_count: setA.pointCount },
        phase_b: { modulated_set_hash: setB.modulatedSetHash, path_set_hash: setB.pathSetHash, phase: setB.phase, sample_value: setB.sampleValue, normalized_sample: setB.normalizedSample, factor: setB.factor, path_count: setB.pathCount, point_count: setB.pointCount },
      },
      invariants: {
        donor_rebuild_validation: true,
        whole_cycle_identity_replay: true,
        same_retained_sources_between_phases: true,
        same_renderer_layout_between_phases: true,
        same_non_energy_path_state_between_phases: true,
        factor_changes_between_phases: true,
        constant_range_exact_no_op: true,
        zero_strength_exact_no_op: true,
        self_consistent_derived_tamper_rejected: true,
      },
      truth_boundary: {
        electric_base_paths_authority: "RETAINED_VFX_ELECTRIC_PATH_STATE",
        flicker_source_authority: "RETAINED_VFX_FLICKER_CYCLE_SOURCE",
        modulation_source_authority: "RETAINED_VFX_ELECTRIC_FLICKER_BINDING_SOURCE",
        modulated_path_sets_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        native_scenes_and_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
        physical_electricity_proven: false,
        emitted_light_proven: false,
        perceptual_flicker_quality_proven: false,
        photosensitivity_or_comfort_proven: false,
        aesthetic_quality_proven: false,
      },
    },
  };
}
