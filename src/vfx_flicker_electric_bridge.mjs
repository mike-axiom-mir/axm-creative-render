import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";
import {
  electricPathLayoutSha256,
  observeVisualEffectElectricFieldModulation,
} from "./vfx_electric_field_modulation_bridge.mjs";

const MAX_PATHS = 32;
const MAX_POINTS_PER_PATH = 65;
const MAX_SCENE_TRIANGLES = 4_096;
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

function positiveInteger(value, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function wrapPhase(value) {
  const wrapped = ((finite(value, "flicker phase") % 1) + 1) % 1;
  const rounded = round6(wrapped);
  return rounded >= 1 ? 0 : rounded;
}

function validatePaths(paths, label, maxPaths = MAX_PATHS) {
  const ceiling = positiveInteger(maxPaths, `${label} maxPaths`);
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_PATHS) throw new Error(`${label} path count must be within 1..${MAX_PATHS}`);
  if (paths.length > ceiling) throw new Error(`${label} path budget exceeded: ${paths.length} > ${ceiling}`);
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

function derivedViewHashPayload(view) {
  return {
    schema: view.schema,
    electricPathSetHash: view.electricPathSetHash,
    retainedBasePathsHash: view.retainedBasePathsHash,
    flickerSourceHash: view.flickerSourceHash,
    phase: view.phase,
    factor: view.factor,
    mapping: view.mapping,
    paths: view.paths,
    derived: view.derived,
    rebuildable: view.rebuildable,
  };
}

export function deriveFlickerElectricEnergyView(selectedPathSet, flickerSourceHash, phase, factor, options = {}) {
  const selected = object(selectedPathSet, "selected electric path set");
  if (selected.schema !== "axm.electric-modulated-path-set/v0.1") throw new Error(`unexpected selected electric path schema: ${String(selected.schema)}`);
  if (selected.derived !== true || selected.rebuildable !== true) throw new Error("selected electric path set must remain derived and rebuildable");
  text(selected.pathSetHash, "selected electric path set hash");
  text(selected.basePathsHash, "selected electric base path hash");
  text(flickerSourceHash, "flicker source hash");
  const maxPaths = options.maxPaths ?? selected.paths?.length;
  const counts = validatePaths(selected.paths, "selected electric paths", maxPaths);
  const scalar = bounded(factor, 0, 1, "flicker energy factor");
  const wrappedPhase = wrapPhase(phase);
  const paths = selected.paths.map((path) => ({ ...structuredClone(path), energy: round6(path.energy * scalar) }));
  validatePaths(paths, "flicker-modulated electric paths", maxPaths);
  if (electricPathLayoutSha256(paths) !== electricPathLayoutSha256(selected.paths)) throw new Error("flicker modulation changed electric renderer layout");
  if (JSON.stringify(paths.map(nonEnergyPathValue)) !== JSON.stringify(selected.paths.map(nonEnergyPathValue))) throw new Error("flicker modulation changed non-energy electric path state");

  const view = {
    schema: "axm.creative-render.flicker-electric-energy-view/v0.1",
    electricPathSetHash: selected.pathSetHash,
    retainedBasePathsHash: selected.basePathsHash,
    flickerSourceHash,
    phase: wrappedPhase,
    factor: round6(scalar),
    mapping: "multiply-electric-path-energy-by-flicker-scalar/v0.1",
    paths,
    derived: true,
    rebuildable: true,
  };
  view.viewHash = sha256(Buffer.from(JSON.stringify(derivedViewHashPayload(view)), "utf8"));
  return { view, counts };
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

function neutralEnergyAlbedo(energy) {
  const normalized = Math.min(1, bounded(energy, 0, 4, "flicker electric energy") / 1.15);
  const value = 42 + Math.round(188 * normalized);
  return [value, value, value];
}

export function flickerElectricViewToAxmScene(viewValue) {
  const view = object(viewValue, "flicker electric view");
  if (view.schema !== "axm.creative-render.flicker-electric-energy-view/v0.1") throw new Error(`unexpected flicker electric view schema: ${String(view.schema)}`);
  if (view.derived !== true || view.rebuildable !== true) throw new Error("flicker electric view must remain derived and rebuildable");
  text(view.viewHash, "flicker electric view hash");
  text(view.electricPathSetHash, "flicker electric selected path hash");
  text(view.retainedBasePathsHash, "flicker electric retained base path hash");
  text(view.flickerSourceHash, "flicker electric source hash");
  if (view.mapping !== "multiply-electric-path-energy-by-flicker-scalar/v0.1") throw new Error("flicker electric mapping contract drifted");
  const counts = validatePaths(view.paths, "flicker electric view paths");
  const expectedViewHash = sha256(Buffer.from(JSON.stringify(derivedViewHashPayload(view)), "utf8"));
  if (expectedViewHash !== view.viewHash) throw new Error("flicker electric view hash mismatch");

  const triangles = [];
  for (const path of view.paths) {
    const albedo = neutralEnergyAlbedo(path.energy);
    const halfWidth = Math.max(0.0022, 0.0035 * path.width);
    for (let index = 0; index < path.points.length - 1; index += 1) {
      pushQuad(triangles, scenePoint(path.points[index]), scenePoint(path.points[index + 1]), halfWidth, albedo);
    }
  }
  if (triangles.length < 1 || triangles.length > MAX_SCENE_TRIANGLES) throw new Error(`flicker electric scene triangle count outside 1..${MAX_SCENE_TRIANGLES}`);
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangles.length) throw new Error("flicker electric scene triangle count changed during serialization");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-flicker-electric-to-axm-scene/v1",
      view_hash: view.viewHash,
      electric_path_set_hash: view.electricPathSetHash,
      retained_base_paths_hash: view.retainedBasePathsHash,
      flicker_source_hash: view.flickerSourceHash,
      phase: view.phase,
      factor: view.factor,
      geometry_layout_sha256: electricPathLayoutSha256(view.paths),
      path_count: counts.pathCount,
      segment_count: counts.segmentCount,
      energy: energyStats(view.paths),
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_flicker: false,
      albedo_encodes_derived_energy: true,
      semantic_lighting_preserved: false,
      adapter_policy: "derived electric path points and retained width become bounded fixed XY quads; flicker-scaled derived energy changes only neutral grayscale albedo, while emission, bloom, physical-electricity and application meaning remain outside this adapter",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

export async function observeVisualEffectFlickerElectric(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    flicker: resolve(rootPath, "hand-lab/src/flicker-cycle1d.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const flicker = await import(`${pathToFileURL(paths.flicker).href}?sha=${sources.flicker.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(flicker.FLICKER_CYCLE_HANDS) || !flicker.FLICKER_CYCLE_GRAPH || typeof flicker.makeFlickerCycleState !== "function") throw new Error("VFX donor flicker-cycle graph is unavailable");
  if (typeof flicker.sampleFlickerCycleSource !== "function" || typeof flicker.validateFlickerCycleSampleSet !== "function") throw new Error("VFX donor flicker-cycle validation API is unavailable");
  if (flicker.FLICKER_CYCLE_GRAPH.id !== "fx.animation.flicker-cycle1d" || flicker.FLICKER_CYCLE_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX flicker-cycle graph identity");

  const electric = await observeVisualEffectElectricFieldModulation(rootPath, {
    id: "creative-render-flicker-electric-source",
    strength: options.electricStrength ?? 0.65,
    floor: options.electricFloor ?? 0.12,
  });
  const selected = electric.modulated;
  const maxPaths = options.maxPaths ?? selected.paths.length;
  validatePaths(selected.paths, "selected derived electric paths", maxPaths);

  const flickerOptions = {
    id: String(options.id ?? "creative-render-electric-flicker"),
    seed: options.seed ?? 91573,
    slotCount: options.slotCount ?? 16,
    minValue: options.minValue ?? 0.35,
    maxValue: options.maxValue ?? 1,
    responsePower: options.responsePower ?? 1.15,
    phaseOffset: options.phaseOffset ?? 0.07,
  };
  bounded(flickerOptions.minValue, 0, 1, "electric flicker minValue");
  bounded(flickerOptions.maxValue, 0, 1, "electric flicker maxValue");
  if (flickerOptions.maxValue < flickerOptions.minValue) throw new Error("electric flicker maxValue must be >= minValue");

  const execute = (callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(flicker.FLICKER_CYCLE_HANDS),
    graph: flicker.FLICKER_CYCLE_GRAPH,
    initialState: flicker.makeFlickerCycleState(flickerOptions),
    context: { callerKind },
  });
  const human = execute("human"), machine = execute("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX flicker-cycle caller-neutral replay failed");
  const finalState = object(human.finalState, "VFX flicker-cycle final state");
  const source = object(finalState.flickerCycleSource, "VFX flicker-cycle source");
  text(finalState.flickerCycleSourceHash, "VFX flicker-cycle source hash");
  if (runtime.hashValue(source) !== finalState.flickerCycleSourceHash) throw new Error("VFX flicker-cycle source hash drifted");
  const sampleSet = object(finalState.flickerCycleSamples?.[source.id], "VFX flicker-cycle sample set");
  if (!flicker.validateFlickerCycleSampleSet(finalState, sampleSet)) throw new Error("VFX flicker-cycle sample-set validation failed");

  const phaseA = options.phaseA ?? 0.11;
  const phaseB = options.phaseB ?? 0.43;
  const factorA = flicker.sampleFlickerCycleSource(source, phaseA);
  const factorB = flicker.sampleFlickerCycleSource(source, phaseB);
  if (factorA === factorB) throw new Error("selected flicker observation phases did not produce distinct scalar factors");
  const a = deriveFlickerElectricEnergyView(selected, finalState.flickerCycleSourceHash, phaseA, factorA, { maxPaths });
  const b = deriveFlickerElectricEnergyView(selected, finalState.flickerCycleSourceHash, phaseB, factorB, { maxPaths });
  const loop = deriveFlickerElectricEnergyView(selected, finalState.flickerCycleSourceHash, Number(phaseA) + 1, flicker.sampleFlickerCycleSource(source, Number(phaseA) + 1), { maxPaths });
  if (loop.view.viewHash !== a.view.viewHash) throw new Error("flicker whole-cycle replay changed derived electric view identity");
  const roomy = deriveFlickerElectricEnergyView(selected, finalState.flickerCycleSourceHash, phaseA, factorA, { maxPaths: MAX_PATHS });
  if (roomy.view.viewHash !== a.view.viewHash) throw new Error("flicker electric path capacity changed derived creative output");
  if (electricPathLayoutSha256(a.view.paths) !== electricPathLayoutSha256(b.view.paths)) throw new Error("flicker observation phase changed electric geometry layout");
  if (JSON.stringify(a.view.paths.map(nonEnergyPathValue)) !== JSON.stringify(b.view.paths.map(nonEnergyPathValue))) throw new Error("flicker observation phase changed non-energy electric path state");

  return {
    electric,
    flickerState: structuredClone(finalState),
    flickerSource: structuredClone(source),
    flickerSampleSet: structuredClone(sampleSet),
    phaseA: a.view,
    phaseB: b.view,
    observation: {
      schema: "axm.creative-render.vfx-flicker-electric-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      flicker_graph_id: flicker.FLICKER_CYCLE_GRAPH.id,
      flicker_graph_version: flicker.FLICKER_CYCLE_GRAPH.version,
      flicker_hand_ids: flicker.FLICKER_CYCLE_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, sourceValue]) => [name, sourceValue.sha256])),
      caller_neutral_replay: "PASS",
      flicker_source: {
        schema: source.schema,
        source_hash: finalState.flickerCycleSourceHash,
        algorithm: source.algorithm,
        seed: source.seed,
        slot_count: source.slotCount,
        min_value: source.minValue,
        max_value: source.maxValue,
        response_power: source.responsePower,
        phase_offset: source.phaseOffset,
      },
      sample_set: {
        schema: sampleSet.schema,
        sample_set_hash: sampleSet.sampleSetHash,
        sample_count: sampleSet.sampleCount,
        derived: sampleSet.derived,
        rebuildable: sampleSet.rebuildable,
      },
      electric_source: {
        retained_base_paths_hash: electric.observation.base_paths.source_hash,
        selected_path_set_hash: selected.pathSetHash,
        selected_schema: selected.schema,
        selected_derived: selected.derived,
        selected_rebuildable: selected.rebuildable,
      },
      phases: {
        a: { phase: a.view.phase, factor: a.view.factor, view_hash: a.view.viewHash, energy: energyStats(a.view.paths) },
        b: { phase: b.view.phase, factor: b.view.factor, view_hash: b.view.viewHash, energy: energyStats(b.view.paths) },
      },
      invariants: {
        whole_cycle_identity_replay: true,
        exact_vs_roomy_path_capacity_identity: true,
        same_renderer_layout_between_phases: true,
        same_non_energy_path_state_between_phases: true,
        factor_changes_between_phases: true,
      },
      truth_boundary: {
        electric_retained_paths_authority: "RETAINED_VFX_ELECTRIC_PATH_STATE",
        electric_selected_path_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        flicker_source_authority: "RETAINED_VFX_FLICKER_CYCLE_SOURCE",
        flicker_sample_table_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        phase_views_authority: "DERIVED_REBUILDABLE_CREATIVE_RENDER_BODY",
        native_scenes_and_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
        physical_electricity_proven: false,
        perceptual_flicker_quality_proven: false,
        photosensitivity_or_comfort_proven: false,
        aesthetic_quality_proven: false,
      },
    },
  };
}
