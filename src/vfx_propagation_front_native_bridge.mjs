import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const DONOR_SAMPLE_LIMIT = 4097;
const SCENE_TRIANGLE_LIMIT = DONOR_SAMPLE_LIMIT * 2;
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

function boundedInteger(value, min, max, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer within [${min},${max}]`);
  }
  return number;
}

function validateDerivedSampleSet(sampleSetValue, maxSamples = DONOR_SAMPLE_LIMIT) {
  const sampleSet = object(sampleSetValue, "propagation front sample set");
  if (sampleSet.schema !== "axm.propagation-front-samples/v0.1") {
    throw new Error(`unexpected propagation front sample schema: ${String(sampleSet.schema)}`);
  }
  if (sampleSet.derived !== true || sampleSet.rebuildable !== true) {
    throw new Error("propagation front samples must remain derived and rebuildable");
  }
  text(sampleSet.sourceHash, "propagation front sample source hash");
  text(sampleSet.sampleSetHash, "propagation front sample set hash");
  bounded(sampleSet.phase, 0, 1, "propagation front sample phase");
  const sampleCount = boundedInteger(sampleSet.sampleCount, 2, DONOR_SAMPLE_LIMIT, "propagation front sample count");
  const ceiling = boundedInteger(maxSamples, 1, DONOR_SAMPLE_LIMIT, "propagation front observer maxSamples");
  if (sampleCount > ceiling) throw new Error(`propagation front observer sample budget exceeded: ${sampleCount} > ${ceiling}`);
  if (!Array.isArray(sampleSet.samples) || sampleSet.samples.length !== sampleCount) {
    throw new Error("propagation front sample cardinality mismatch");
  }
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = object(sampleSet.samples[index], `propagation front sample ${index}`);
    if (sample.index !== index) throw new Error(`propagation front sample ${index} identity mismatch`);
    bounded(sample.position, 0, 1, `propagation front sample ${index} position`);
    bounded(sample.weight, 0, 1, `propagation front sample ${index} weight`);
    if (index > 0 && sample.position < sampleSet.samples[index - 1].position) {
      throw new Error("propagation front sample positions must be monotonic");
    }
  }
  return sampleSet;
}

function pushCell(triangles, x, halfWidth, halfHeight, albedo) {
  const p0 = [x - halfWidth, -halfHeight, 0];
  const p1 = [x + halfWidth, -halfHeight, 0];
  const p2 = [x + halfWidth, halfHeight, 0];
  const p3 = [x - halfWidth, halfHeight, 0];
  triangles.push(
    { vertices: [p0, p1, p2], albedo: [...albedo] },
    { vertices: [p0, p2, p3], albedo: [...albedo] },
  );
}

function neutralWeightAlbedo(weight) {
  const value = 34 + Math.round(196 * bounded(weight, 0, 1, "propagation front weight"));
  return [value, value, value];
}

function geometrySha256(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

export function propagationFrontSampleSetToAxmScene(sampleSetValue, options = {}) {
  const sampleSet = validateDerivedSampleSet(sampleSetValue, options.maxSamples ?? DONOR_SAMPLE_LIMIT);
  const count = sampleSet.sampleCount;
  const spacing = 1.64 / Math.max(1, count - 1);
  const halfWidth = Math.min(0.012, spacing * 0.38);
  const halfHeight = 0.19;
  const triangles = [];
  for (const sample of sampleSet.samples) {
    const x = -0.82 + sample.position * 1.64;
    pushCell(triangles, x, halfWidth, halfHeight, neutralWeightAlbedo(sample.weight));
  }
  if (triangles.length < 1 || triangles.length > SCENE_TRIANGLE_LIMIT) {
    throw new Error(`propagation front scene triangle count outside 1..${SCENE_TRIANGLE_LIMIT}`);
  }
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangles.length) throw new Error("propagation front scene triangle count changed during serialization");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-propagation-front-to-axm-scene/v1",
      source_hash: sampleSet.sourceHash,
      sample_set_hash: sampleSet.sampleSetHash,
      phase: sampleSet.phase,
      sample_count: sampleSet.sampleCount,
      geometry_sha256: geometrySha256(scene),
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_weight: false,
      albedo_encodes_derived_weight: true,
      semantic_reveal_preserved: false,
      adapter_policy: "derived normalized sample positions become fixed bounded XY cells; only donor-derived neutral [0,1] weights map to fixed grayscale albedo; reveal, growth, opacity, emission, gameplay, UI, material and world meaning remain outside this replaceable observer",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function sampleWeights(set) {
  return set.samples.map((sample) => sample.weight);
}

function samePositions(a, b) {
  return JSON.stringify(a.samples.map((sample) => sample.position)) === JSON.stringify(b.samples.map((sample) => sample.position));
}

function sameSceneGeometry(a, b) {
  return geometrySha256(a.scene) === geometrySha256(b.scene);
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function observeVisualEffectPropagationFront(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    propagation: resolve(rootPath, "hand-lab/src/propagation-front1d.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const propagation = await import(`${pathToFileURL(paths.propagation).href}?sha=${sources.propagation.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(propagation.PROPAGATION_FRONT_HANDS) || !propagation.PROPAGATION_FRONT_GRAPH || typeof propagation.makePropagationFrontState !== "function") {
    throw new Error("VFX donor propagation-front graph is unavailable");
  }
  if (typeof propagation.buildPropagationFrontSamplesHand?.execute !== "function" || typeof propagation.validatePropagationFrontSampleSet !== "function") {
    throw new Error("VFX donor propagation-front build/validation API is unavailable");
  }
  if (propagation.PROPAGATION_FRONT_GRAPH.id !== "fx.animation.propagation-front1d" || propagation.PROPAGATION_FRONT_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX propagation-front graph identity");
  }

  const request = {
    id: String(options.id ?? "creative-render-propagation-front"),
    direction: options.direction ?? "forward",
    frontSoftness: options.frontSoftness ?? 0.18,
  };
  const makeInitial = () => propagation.makePropagationFrontState(request);
  const humanInput = makeInitial();
  const humanInputBytes = JSON.stringify(humanInput);
  const execute = (callerKind, initialState) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(propagation.PROPAGATION_FRONT_HANDS),
    graph: propagation.PROPAGATION_FRONT_GRAPH,
    initialState,
    context: { callerKind },
  });
  const human = execute("human", humanInput);
  const machine = execute("machine", makeInitial());
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX propagation-front caller-neutral replay failed");
  if (JSON.stringify(humanInput) !== humanInputBytes) throw new Error("VFX propagation-front execution mutated caller request state");

  const donorState = object(human.finalState, "VFX propagation-front final state");
  const source = object(donorState.propagationFrontSource, "VFX propagation-front retained source");
  const sourceHash = text(donorState.propagationFrontSourceHash, "VFX propagation-front source hash");
  if (runtime.hashValue(source) !== sourceHash) throw new Error("VFX propagation-front retained source hash drifted");
  const defaultSet = object(donorState.propagationFrontSamples?.[source.id], "VFX propagation-front default sample set");
  if (!propagation.validatePropagationFrontSampleSet(donorState, defaultSet)) throw new Error("VFX propagation-front default sample validation failed");

  const sampleCount = boundedInteger(options.sampleCount ?? 65, 2, DONOR_SAMPLE_LIMIT, "propagation front proof sampleCount");
  const phaseA = finite(options.phaseA ?? 0.22, "propagation front phase A");
  const phaseB = finite(options.phaseB ?? 0.72, "propagation front phase B");
  const build = (phase, count = sampleCount) => {
    const result = propagation.buildPropagationFrontSamplesHand.execute(donorState, { phase, sampleCount: count });
    const set = object(result.state.propagationFrontSamples?.[source.id], "VFX propagation-front selected sample set");
    if (!propagation.validatePropagationFrontSampleSet(result.state, set)) throw new Error("VFX propagation-front selected sample validation failed");
    if (result.state.propagationFrontSourceHash !== sourceHash || runtime.hashValue(result.state.propagationFrontSource) !== sourceHash) {
      throw new Error("VFX propagation-front derived sampling rewrote retained source authority");
    }
    return { state: result.state, set };
  };

  const selectedA = build(phaseA);
  const selectedB = build(phaseB);
  if (selectedA.set.sampleSetHash === selectedB.set.sampleSetHash) throw new Error("selected propagation phases did not produce distinct derived sample identities");
  if (!samePositions(selectedA.set, selectedB.set)) throw new Error("selected propagation phases changed sample geometry positions");
  if (JSON.stringify(sampleWeights(selectedA.set)) === JSON.stringify(sampleWeights(selectedB.set))) {
    throw new Error("selected propagation phases did not change derived neutral weights");
  }

  const clampedLow = build(-0.5);
  const clampedHigh = build(1.5);
  if (clampedLow.set.phase !== 0 || clampedLow.set.samples.some((sample) => sample.weight !== 0)) {
    throw new Error("propagation phase below domain did not clamp to exact all-zero boundary");
  }
  if (clampedHigh.set.phase !== 1 || clampedHigh.set.samples.some((sample) => sample.weight !== 1)) {
    throw new Error("propagation phase above domain did not clamp to exact all-one boundary");
  }

  let alternateCount = sampleCount === 2 ? 3 : Math.max(2, Math.floor((sampleCount + 1) / 2));
  if (alternateCount === sampleCount) alternateCount = Math.min(DONOR_SAMPLE_LIMIT, sampleCount + 1);
  const alternate = build(phaseB, alternateCount);
  if (alternate.set.sourceHash !== sourceHash || alternate.set.sampleSetHash === selectedB.set.sampleSetHash) {
    throw new Error("propagation alternate-resolution rebuild boundary failed");
  }

  const sceneAExact = propagationFrontSampleSetToAxmScene(selectedA.set, { maxSamples: sampleCount });
  const sceneARoomy = propagationFrontSampleSetToAxmScene(selectedA.set, { maxSamples: DONOR_SAMPLE_LIMIT });
  const sceneB = propagationFrontSampleSetToAxmScene(selectedB.set, { maxSamples: DONOR_SAMPLE_LIMIT });
  if (sceneAExact.observation.output_sha256 !== sceneARoomy.observation.output_sha256) {
    throw new Error("propagation observer capacity changed derived scene bytes");
  }
  if (!sameSceneGeometry(sceneAExact, sceneB)) throw new Error("propagation phases changed observer geometry");
  if (sceneAExact.observation.output_sha256 === sceneB.observation.output_sha256) {
    throw new Error("propagation phase weight difference did not reach native observation bytes");
  }

  const donorStateBytes = canonicalJsonBytes(donorState);
  const receipt = {
    contract: "AXM_CREATIVE_VFX_PROPAGATION_FRONT_NATIVE_RECEIPT",
    version: 1,
    visual_effect_fabric: {
      revision: text(options.vfxRevision ?? "UNSPECIFIED", "VFX revision"),
      graph_id: propagation.PROPAGATION_FRONT_GRAPH.id,
      graph_version: propagation.PROPAGATION_FRONT_GRAPH.version,
      donor_graph_reused: true,
      caller_neutral_replay: "PASS",
      caller_request_unchanged: true,
      imported_source_files: sources,
      retained_source: {
        schema: source.schema,
        source_hash: sourceHash,
        algorithm: source.algorithm,
        direction: source.direction,
        front_softness: source.frontSoftness,
        space_domain: source.spaceDomain,
        phase_domain: source.phaseDomain,
        phase_mode: source.phaseMode,
        profile: source.profile,
        output_range: source.outputRange,
        provenance: source.provenance,
      },
      default_sample_set: {
        sample_set_hash: defaultSet.sampleSetHash,
        phase: defaultSet.phase,
        sample_count: defaultSet.sampleCount,
        derived: defaultSet.derived,
        rebuildable: defaultSet.rebuildable,
      },
      truth_boundary: {
        retained_source_authority: "RETAINED_VFX_PROPAGATION_FRONT_SOURCE",
        sample_sets_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        native_scenes_and_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
        reveal_or_growth_semantics_proven: false,
        animation_timing_proven: false,
        aesthetic_quality_proven: false,
        accessibility_proven: false,
        realtime_performance_proven: false,
      },
    },
    selected: {
      phase_a: selectedA.set,
      phase_b: selectedB.set,
      clamped_low: {
        sample_set_hash: clampedLow.set.sampleSetHash,
        phase: clampedLow.set.phase,
        all_zero: clampedLow.set.samples.every((sample) => sample.weight === 0),
      },
      clamped_high: {
        sample_set_hash: clampedHigh.set.sampleSetHash,
        phase: clampedHigh.set.phase,
        all_one: clampedHigh.set.samples.every((sample) => sample.weight === 1),
      },
      alternate_resolution: {
        sample_set_hash: alternate.set.sampleSetHash,
        source_hash: alternate.set.sourceHash,
        phase: alternate.set.phase,
        sample_count: alternate.set.sampleCount,
      },
    },
    invariants: {
      same_retained_source_across_all_rebuilds: true,
      phase_changes_only_derived_weights_at_fixed_resolution: true,
      phase_domain_clamps_exactly: true,
      sample_resolution_is_derived: true,
      exact_vs_roomy_observer_capacity_identity: true,
      same_native_geometry_between_selected_phases: true,
      selected_scene_bytes_differ: true,
    },
    native_observer: {
      difference_channel: "NEUTRAL_GRAYSCALE_FROM_DONOR_DERIVED_PROPAGATION_WEIGHT_ONLY",
      phase_a: sceneAExact.observation,
      phase_b: sceneB.observation,
    },
    outputs: {
      donor_state: { sha256: sha256(donorStateBytes) },
      phase_a_scene: { sha256: sceneAExact.observation.output_sha256 },
      phase_b_scene: { sha256: sceneB.observation.output_sha256 },
    },
  };

  return {
    donorState,
    donorStateBytes,
    source,
    sourceHash,
    phaseASampleSet: selectedA.set,
    phaseBSampleSet: selectedB.set,
    phaseASceneBytes: sceneAExact.bytes,
    phaseBSceneBytes: sceneB.bytes,
    receipt,
  };
}
