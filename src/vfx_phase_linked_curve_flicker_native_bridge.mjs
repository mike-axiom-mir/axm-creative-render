import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PHASE_LINKED_CURVE_FLICKER_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_SIGNALS = 16;
const FIXED_SAMPLE_SEMANTICS = Object.freeze({
  mapping: "relationship-channel-phase-to-independent-donor-sample",
  combination: "none",
  schedulerAuthority: "none",
  phaseSelection: "derived-only",
});

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) {
    throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  }
  return text;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function boundedInteger(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer within [${min},${max}]`);
  }
  return number;
}

function boundedUnit(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${label} must remain within [0,1]`);
  }
  return number;
}

function boundedUnitHalfOpen(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number >= 1) {
    throw new Error(`${label} must remain within [0,1)`);
  }
  return number;
}

function geometryDigest(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

function assertRetainedSources(retained) {
  if (!retained || typeof retained !== "object") throw new Error("phase-linked observer requires retained donor sources");
  const curve = retained.parameterCurveSource;
  const flicker = retained.flickerCycleSource;
  const relationship = retained.phaseRelationshipSource;
  if (!curve || curve.schema !== "axm.parameter-curve-source/v0.1" || curve.wrapMode !== "loop") {
    throw new Error("phase-linked observer requires retained looping parameter curve source");
  }
  if (!flicker || flicker.schema !== "axm.flicker-cycle-source/v0.1" || flicker.wrapMode !== "loop") {
    throw new Error("phase-linked observer requires retained looping flicker source");
  }
  if (!relationship || relationship.schema !== "axm.phase-relationship-source/v0.1" || relationship.wrapMode !== "loop") {
    throw new Error("phase-linked observer requires retained looping phase-relationship source");
  }
  for (const [label, hash] of [
    ["parameter curve", retained.parameterCurveSourceHash],
    ["flicker cycle", retained.flickerCycleSourceHash],
    ["phase relationship", retained.phaseRelationshipSourceHash],
  ]) {
    if (!String(hash || "").trim()) throw new Error(`phase-linked observer requires ${label} source hash`);
  }
}

export function phaseLinkedCurveFlickerSampleToAxmScene(retained, sample, options = {}) {
  assertRetainedSources(retained);
  const maxSignals = boundedInteger(
    options.maxSignals ?? HARD_MAX_SIGNALS,
    1,
    HARD_MAX_SIGNALS,
    "phase-linked observer maxSignals",
  );
  const signalCount = 2;
  if (signalCount > maxSignals) {
    throw new Error(`phase-linked observer signal budget exceeded: ${signalCount} > ${maxSignals}`);
  }
  if (!sample || sample.schema !== "axm.phase-linked-curve-flicker-sample/v0.1" || sample.derived !== true || sample.rebuildable !== true) {
    throw new Error("phase-linked observer accepts only derived rebuildable v0.1 samples");
  }
  for (const [key, expected] of Object.entries(FIXED_SAMPLE_SEMANTICS)) {
    if (sample[key] !== expected) throw new Error(`phase-linked sample ${key} semantics drifted`);
  }
  if (Object.hasOwn(sample, "combinedValue")) {
    throw new Error("phase-linked observer refuses invented combinedValue authority");
  }
  if (sample.parameterCurveSourceHash !== retained.parameterCurveSourceHash) {
    throw new Error("phase-linked observer parameter-curve lineage mismatch");
  }
  if (sample.flickerCycleSourceHash !== retained.flickerCycleSourceHash) {
    throw new Error("phase-linked observer flicker lineage mismatch");
  }
  if (sample.phaseRelationshipSourceHash !== retained.phaseRelationshipSourceHash) {
    throw new Error("phase-linked observer relationship lineage mismatch");
  }
  if (!String(sample.phaseSetHash || "").trim() || !String(sample.sampleHash || "").trim()) {
    throw new Error("phase-linked observer requires derived phase-set and sample hashes");
  }
  boundedUnitHalfOpen(sample.groupPhase, "phase-linked sample groupPhase");
  if (!sample.curve || !sample.flicker || sample.curve.channelId === sample.flicker.channelId) {
    throw new Error("phase-linked observer requires distinct curve and flicker channels");
  }
  boundedUnitHalfOpen(sample.curve.phase, "phase-linked curve phase");
  boundedUnitHalfOpen(sample.flicker.phase, "phase-linked flicker phase");
  const curveValue = boundedUnit(sample.curve.value, "phase-linked curve value");
  const flickerValue = boundedUnit(sample.flicker.value, "phase-linked flicker value");

  const signals = [
    { id: "curve", value: curveValue, centerX: 0.32 },
    { id: "flicker", value: flickerValue, centerX: 0.68 },
  ];
  const triangles = [];
  for (const signal of signals) {
    const x0 = signal.centerX - 0.12;
    const x1 = signal.centerX + 0.12;
    const y0 = 0.26;
    const y1 = 0.74;
    const gray = Math.round(32 + (192 * signal.value));
    triangles.push(
      { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], albedo: [gray, gray, gray] },
      { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], albedo: [gray, gray, gray] },
    );
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-phase-linked-curve-flicker-to-axm-scene/v1",
      parameter_curve_source_hash: retained.parameterCurveSourceHash,
      flicker_cycle_source_hash: retained.flickerCycleSourceHash,
      phase_relationship_source_hash: retained.phaseRelationshipSourceHash,
      phase_set_hash: sample.phaseSetHash,
      sample_hash: sample.sampleHash,
      group_phase: sample.groupPhase,
      curve: { channel_id: sample.curve.channelId, phase: sample.curve.phase, value: curveValue },
      flicker: { channel_id: sample.flicker.channelId, phase: sample.flicker.phase, value: flickerValue },
      input_signal_count: signalCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_sha256: geometryDigest(scene),
      geometry_encodes_values: false,
      albedo_encodes_only_independent_donor_values: true,
      observer_value_domain: [0, 1],
      observer_gray_range_rgb8: [32, 224],
      values_combined: false,
      scheduler_authority_acquired: false,
      consumer_semantics_assigned: false,
      adapter_policy: "use fixed two-signal rectangle geometry and encode the independently donor-sampled curve and flicker values as separate neutral grayscale albedos; do not combine values or infer scheduler, animation, effect, light, material, audio, gameplay, UI, or world meaning",
    },
  };
}

export async function observeVisualEffectPhaseLinkedCurveFlickerNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    phaseLinked: resolve(rootPath, "hand-lab/src/phase-linked-curve-flicker.mjs"),
    parameterCurve: resolve(rootPath, "hand-lab/src/parameter-curve.mjs"),
    flickerCycle: resolve(rootPath, "hand-lab/src/flicker-cycle1d.mjs"),
    phaseRelationship: resolve(rootPath, "hand-lab/src/phase-relationship1d.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const phaseLinked = await import(`${pathToFileURL(paths.phaseLinked).href}?sha=${sources.phaseLinked.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(phaseLinked.PHASE_LINKED_CURVE_FLICKER_HANDS) ||
      !phaseLinked.PHASE_LINKED_CURVE_FLICKER_GRAPH ||
      typeof phaseLinked.makePhaseLinkedCurveFlickerState !== "function" ||
      typeof phaseLinked.validatePhaseLinkedCurveFlickerSample !== "function") {
    throw new Error("VFX donor phase-linked curve/flicker boundary is unavailable");
  }
  if (phaseLinked.PHASE_LINKED_CURVE_FLICKER_GRAPH.id !== "fx.animation.phase-linked-curve-flicker" ||
      phaseLinked.PHASE_LINKED_CURVE_FLICKER_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX phase-linked curve/flicker graph identity");
  }

  const initial = phaseLinked.makePhaseLinkedCurveFlickerState({
    curve: {
      id: "creative-render-linked-curve",
      keyframes: [
        { t: 0, value: 0.15, interpolation: "linear" },
        { t: 0.25, value: 0.9, interpolation: "linear" },
        { t: 0.5, value: 0.35, interpolation: "linear" },
        { t: 0.75, value: 0.8, interpolation: "linear" },
        { t: 1, value: 0.15, interpolation: "linear" },
      ],
    },
    flicker: {
      id: "creative-render-linked-flicker",
      seed: 991,
      slotCount: 8,
      minValue: 0.1,
      maxValue: 0.9,
      responsePower: 1,
      phaseOffset: 0,
    },
    relationship: {
      id: "creative-render-curve-flicker-relationship",
      channels: [
        { id: "curve", cyclesPerGroup: 1, phaseOffset: 0 },
        { id: "flicker", cyclesPerGroup: 2, phaseOffset: 0.25 },
      ],
    },
  });
  initial.consumerMetadata = { owner: "creative-render-observer", untouched: true };
  const initialBytes = stableBytes(initial);
  const requestsBytes = stableBytes({
    parameterCurveRequest: initial.parameterCurveRequest,
    flickerCycleRequest: initial.flickerCycleRequest,
    phaseRelationshipRequest: initial.phaseRelationshipRequest,
  });
  const registry = runtime.createHandRegistry(phaseLinked.PHASE_LINKED_CURVE_FLICKER_HANDS);

  const graphAt = (phase) => ({
    ...phaseLinked.PHASE_LINKED_CURVE_FLICKER_GRAPH,
    stages: phaseLinked.PHASE_LINKED_CURVE_FLICKER_GRAPH.stages.map((stage) =>
      stage.id === "resolve-related-phases"
        ? { ...stage, params: { ...(stage.params || {}), groupPhase: phase } }
        : { ...stage, params: { ...(stage.params || {}) } }
    ),
  });
  const runGraph = (phase, callerKind) => runtime.executeHandGraph({
    registry,
    graph: graphAt(phase),
    initialState: initial,
    context: { callerKind },
  });

  const phaseA = Number(options.phaseA ?? 0.1);
  const phaseB = Number(options.phaseB ?? 0.35);
  const humanA = runGraph(phaseA, "human");
  const machineA = runGraph(phaseA, "machine");
  const humanB = runGraph(phaseB, "human");
  const machineB = runGraph(phaseB, "machine");
  if (humanA.finalStateHash !== machineA.finalStateHash || humanB.finalStateHash !== machineB.finalStateHash) {
    throw new Error("VFX phase-linked curve/flicker caller-neutral replay failed");
  }
  if (stableBytes(initial).compare(initialBytes) !== 0) {
    throw new Error("VFX phase-linked curve/flicker initial state mutated during replay");
  }
  for (const finalState of [humanA.finalState, humanB.finalState]) {
    const after = stableBytes({
      parameterCurveRequest: finalState.parameterCurveRequest,
      flickerCycleRequest: finalState.flickerCycleRequest,
      phaseRelationshipRequest: finalState.phaseRelationshipRequest,
    });
    if (after.compare(requestsBytes) !== 0) throw new Error("VFX phase-linked curve/flicker caller requests mutated");
  }

  const retained = {
    parameterCurveSource: humanA.finalState.parameterCurveSource,
    parameterCurveSourceHash: humanA.finalState.parameterCurveSourceHash,
    flickerCycleSource: humanA.finalState.flickerCycleSource,
    flickerCycleSourceHash: humanA.finalState.flickerCycleSourceHash,
    phaseRelationshipSource: humanA.finalState.phaseRelationshipSource,
    phaseRelationshipSourceHash: humanA.finalState.phaseRelationshipSourceHash,
  };
  assertRetainedSources(retained);
  for (const finalState of [humanB.finalState]) {
    for (const [sourceKey, hashKey] of [
      ["parameterCurveSource", "parameterCurveSourceHash"],
      ["flickerCycleSource", "flickerCycleSourceHash"],
      ["phaseRelationshipSource", "phaseRelationshipSourceHash"],
    ]) {
      if (finalState[hashKey] !== retained[hashKey] || stableBytes(finalState[sourceKey]).compare(stableBytes(retained[sourceKey])) !== 0) {
        throw new Error(`VFX phase-linked selected group phase rewrote retained ${sourceKey} truth`);
      }
    }
  }

  const relationshipId = retained.phaseRelationshipSource.id;
  const selectedA = humanA.finalState.phaseLinkedCurveFlickerSamples?.[relationshipId];
  const selectedB = humanB.finalState.phaseLinkedCurveFlickerSamples?.[relationshipId];
  if (phaseLinked.validatePhaseLinkedCurveFlickerSample(humanA.finalState, selectedA) !== true ||
      phaseLinked.validatePhaseLinkedCurveFlickerSample(humanB.finalState, selectedB) !== true) {
    throw new Error("VFX phase-linked donor validation failed");
  }
  if (selectedA.sampleHash === selectedB.sampleHash) {
    throw new Error("VFX phase-linked selected group phases did not create distinct derived samples");
  }

  const seamRun = runGraph(phaseA + 1, "machine");
  const seam = seamRun.finalState.phaseLinkedCurveFlickerSamples?.[relationshipId];
  if (!seam || seam.sampleHash !== selectedA.sampleHash || seam.groupPhase !== selectedA.groupPhase) {
    throw new Error("VFX phase-linked whole-group-cycle seam drifted");
  }

  const observedA = phaseLinkedCurveFlickerSampleToAxmScene(retained, selectedA, { maxSignals: 2 });
  const observedB = phaseLinkedCurveFlickerSampleToAxmScene(retained, selectedB, { maxSignals: HARD_MAX_SIGNALS });
  if (observedA.observation.geometry_sha256 !== observedB.observation.geometry_sha256) {
    throw new Error("VFX phase-linked values changed neutral observer geometry");
  }
  if (observedA.observation.output_sha256 === observedB.observation.output_sha256) {
    throw new Error("VFX phase-linked donor sample difference did not reach observation bytes");
  }

  const donorStateBytes = stableBytes(humanA.finalState);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: phaseLinked.PHASE_LINKED_CURVE_FLICKER_GRAPH.id,
      graph_version: phaseLinked.PHASE_LINKED_CURVE_FLICKER_GRAPH.version,
      hand_ids: phaseLinked.PHASE_LINKED_CURVE_FLICKER_HANDS.map((hand) => hand.id),
      donor_graph_reused: true,
      donor_source_files: sources,
      caller_neutral_replay: "PASS",
      caller_requests_unchanged: true,
      initial_state_unchanged: true,
      retained_sources: {
        parameter_curve: {
          schema: retained.parameterCurveSource.schema,
          source_hash: retained.parameterCurveSourceHash,
          wrap_mode: retained.parameterCurveSource.wrapMode,
          keyframe_count: retained.parameterCurveSource.keyframes.length,
        },
        flicker_cycle: {
          schema: retained.flickerCycleSource.schema,
          source_hash: retained.flickerCycleSourceHash,
          algorithm: retained.flickerCycleSource.algorithm,
          wrap_mode: retained.flickerCycleSource.wrapMode,
          interpolation: retained.flickerCycleSource.interpolation,
          slot_count: retained.flickerCycleSource.slotCount,
          min_value: retained.flickerCycleSource.minValue,
          max_value: retained.flickerCycleSource.maxValue,
        },
        phase_relationship: {
          schema: retained.phaseRelationshipSource.schema,
          source_hash: retained.phaseRelationshipSourceHash,
          algorithm: retained.phaseRelationshipSource.algorithm,
          wrap_mode: retained.phaseRelationshipSource.wrapMode,
          relationship_rule: retained.phaseRelationshipSource.relationshipRule,
          channels: retained.phaseRelationshipSource.channels,
        },
      },
      truth_boundary: {
        retained_parameter_curve_authority: "RETAINED_VFX_SOURCE",
        retained_flicker_cycle_authority: "RETAINED_VFX_SOURCE",
        retained_phase_relationship_authority: "RETAINED_VFX_SOURCE",
        selected_phase_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        linked_sample_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        native_scenes_and_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
        combined_value_created: false,
        scheduler_authority_acquired: false,
        continuous_animation_proven: false,
        synchronization_quality_proven: false,
        flicker_comfort_or_photosensitivity_safety_proven: false,
        effect_semantics_proven: false,
        aesthetic_quality_proven: false,
        accessibility_proven: false,
        realtime_performance_proven: false,
      },
    },
    selected: {
      phase_a: selectedA,
      phase_b: selectedB,
      whole_cycle_phase_a: {
        requested_group_phase: phaseA + 1,
        wrapped_group_phase: seam.groupPhase,
        sample_hash: seam.sampleHash,
        equals_phase_a: true,
      },
    },
    native_observer: {
      phase_a: observedA.observation,
      phase_b: observedB.observation,
      difference_channel: "SEPARATE_NEUTRAL_GRAYSCALE_FROM_INDEPENDENT_DONOR_CURVE_AND_FLICKER_VALUES",
    },
    invariants: {
      all_three_retained_sources_identical_across_group_phase: true,
      whole_group_cycle_closes_exactly: true,
      caller_neutral_replay: true,
      source_requests_and_initial_state_unchanged: true,
      geometry_fixed_across_group_phase: true,
      linked_samples_derived_and_rebuildable: true,
      values_remain_independent_and_uncombined: true,
      scheduler_authority_remains_none: true,
      consumer_semantics_not_assigned: true,
    },
    outputs: {
      phase_a_scene: { sha256: sha256(observedA.bytes), bytes: observedA.bytes.length },
      phase_b_scene: { sha256: sha256(observedB.bytes), bytes: observedB.bytes.length },
      donor_state: { sha256: sha256(donorStateBytes), bytes: donorStateBytes.length },
    },
  };
  const receiptBytes = stableBytes(receipt);

  return {
    phaseASceneBytes: observedA.bytes,
    phaseBSceneBytes: observedB.bytes,
    donorStateBytes,
    receipt,
    receiptBytes,
    retained,
    phaseASample: selectedA,
    phaseBSample: selectedB,
  };
}
