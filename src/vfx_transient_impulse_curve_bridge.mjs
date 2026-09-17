import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_TRANSIENT_IMPULSE_CURVE_NATIVE_RECEIPT";
const VERSION = 1;
const FIXED_VERTICES = [
  [-0.42, -0.32, 0],
  [0.42, -0.32, 0],
  [0.42, 0.32, 0],
  [-0.42, 0.32, 0],
];

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function unit(value, label) {
  const number = finite(value, label);
  if (number < 0 || number > 1) throw new Error(`${label} must be within 0..1`);
  return number;
}

function boundedIntensity(value) {
  const number = finite(value, "transient impulse intensity");
  if (number < 0 || number > 2) throw new Error("transient impulse intensity must be within 0..2 for this observation adapter");
  return number;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function albedoForIntensity(intensity) {
  const normalized = boundedIntensity(intensity) / 2;
  return [
    40 + Math.round(normalized * 200),
    64 + Math.round(normalized * 160),
    112 + Math.round(normalized * 120),
  ];
}

export function transientImpulseIntensityToAxmScene(sample) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw new Error("transient impulse scene adapter requires a sample object");
  const eventHash = String(sample.eventHash || "").trim();
  const lineageHash = String(sample.lineageHash || "").trim();
  if (!eventHash) throw new Error("transient impulse scene adapter requires eventHash");
  if (!lineageHash) throw new Error("transient impulse scene adapter requires lineageHash");
  const t = unit(sample.t, "transient impulse sample t");
  const intensity = boundedIntensity(sample.intensity);
  const albedo = albedoForIntensity(intensity);
  const [a, b, c, d] = FIXED_VERTICES.map((vertex) => [...vertex]);
  const scene = {
    version: 1,
    triangles: [
      { vertices: [a, b, c], albedo: [...albedo] },
      { vertices: [a, c, d], albedo: [...albedo] },
    ],
  };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== 2) throw new Error("transient impulse scene adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-transient-impulse-intensity-to-axm-scene/v1",
      canonical_event_hash: eventHash,
      consumed_lineage_hash: lineageHash,
      t,
      intensity,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: 2,
      output_sha256: sha256(bytes),
      geometry_is_fixed: true,
      albedo_encodes_only_intensity: true,
      intensity_observation_domain: [0, 2],
      consumer_semantics_assigned: false,
      adapter_policy: "one retained transient-envelope intensity in 0..2 changes only RGB albedo on a fixed two-triangle observation body; canonical event, field, envelopes and parameter curves are not rewritten",
    },
  };
}

function sceneGeometry(bytes) {
  return JSON.stringify(parseScene(bytes.toString("utf8")).triangles.map((triangle) => triangle.vertices));
}

function sameSampleShape(base, derived) {
  return base.t === derived.t && base.expansion === derived.expansion;
}

export async function observeVisualEffectTransientImpulseCurve(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    modulation: resolve(rootPath, "hand-lab/src/transient-impulse-curve-modulation.mjs"),
    impulseHands: resolve(rootPath, "hand-lab/src/transient-impulse-hands.mjs"),
    parameterCurve: resolve(rootPath, "hand-lab/src/parameter-curve.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const modulation = await import(`${pathToFileURL(paths.modulation).href}?sha=${sources.modulation.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(modulation.TRANSIENT_IMPULSE_CURVE_MODULATION_HANDS) || !modulation.TRANSIENT_IMPULSE_CURVE_MODULATION_GRAPH || typeof modulation.makeTransientImpulseCurveModulationState !== "function") {
    throw new Error("VFX donor transient-impulse curve-modulation graph is unavailable");
  }
  const graph = modulation.TRANSIENT_IMPULSE_CURVE_MODULATION_GRAPH;
  if (graph.id !== "fx.transient-impulse.parameter-curve-modulation" || graph.version !== "0.1.0") {
    throw new Error("unexpected VFX transient-impulse curve-modulation graph identity");
  }
  const expectedHands = [
    "fx.impulse.event-normalize",
    "fx.impulse.field-build",
    "fx.impulse.temporal-envelope",
    "fx.animation.parameter-curve-source-normalize",
    "fx.impulse.parameter-curve-modulate-envelope",
  ];
  if (JSON.stringify(modulation.TRANSIENT_IMPULSE_CURVE_MODULATION_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX transient-impulse curve-modulation Hand boundary");
  }

  const impulseRequest = {
    id: "creative-render-shared-impulse",
    seed: 20260917,
    origin: [0.5, 0.5],
    direction: [1, -0.15],
    energy: 1.18,
    radius: 0.31,
    duration: 0.72,
    controls: {
      symmetry: 0.2,
      directionality: 0.94,
      fragmentation: 0.78,
      ringWeight: 0.72,
      spokeWeight: 1.12,
    },
  };
  const noopCurveRequest = {
    id: "creative-render-impulse-noop",
    wrapMode: "clamp",
    keyframes: [
      { t: 0, value: 1, interpolation: "linear" },
      { t: 1, value: 1, interpolation: "linear" },
    ],
  };
  const shapedCurveRequest = {
    id: "creative-render-impulse-shaped",
    wrapMode: "clamp",
    keyframes: [
      { t: 0, value: 0.25, interpolation: "smoothstep" },
      { t: 0.25, value: 1.4, interpolation: "smoothstep" },
      { t: 1, value: 0.35, interpolation: "linear" },
    ],
  };
  const callerBytesBefore = {
    impulse: stableBytes(impulseRequest),
    noopCurve: stableBytes(noopCurveRequest),
    shapedCurve: stableBytes(shapedCurveRequest),
  };

  const makeState = (curve) => modulation.makeTransientImpulseCurveModulationState({ impulse: impulseRequest, curve });
  const executeGraph = (curve, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(modulation.TRANSIENT_IMPULSE_CURVE_MODULATION_HANDS),
    graph,
    initialState: makeState(curve),
    context: { callerKind },
  });

  const noopHuman = executeGraph(noopCurveRequest, "human");
  const noopMachine = executeGraph(noopCurveRequest, "machine");
  const shapedHuman = executeGraph(shapedCurveRequest, "human");
  const shapedMachine = executeGraph(shapedCurveRequest, "machine");
  if (noopHuman.finalStateHash !== noopMachine.finalStateHash || shapedHuman.finalStateHash !== shapedMachine.finalStateHash) {
    throw new Error("VFX transient-impulse curve-modulation caller-neutral repeat verification failed");
  }
  if (
    stableBytes(impulseRequest).compare(callerBytesBefore.impulse) !== 0 ||
    stableBytes(noopCurveRequest).compare(callerBytesBefore.noopCurve) !== 0 ||
    stableBytes(shapedCurveRequest).compare(callerBytesBefore.shapedCurve) !== 0
  ) {
    throw new Error("caller-owned transient impulse or parameter-curve request mutated");
  }

  const noop = noopHuman.finalState;
  const shaped = shapedHuman.finalState;
  if (noop.eventCanonicalHash !== shaped.eventCanonicalHash || runtime.hashValue(noop.event) !== noop.eventCanonicalHash || runtime.hashValue(shaped.event) !== shaped.eventCanonicalHash) {
    throw new Error("canonical transient event identity drifted across curve choice");
  }
  if (noop.impulseField.geometryHash !== shaped.impulseField.geometryHash || runtime.hashValue(noop.impulseField.geometry) !== noop.impulseField.geometryHash || runtime.hashValue(shaped.impulseField.geometry) !== shaped.impulseField.geometryHash) {
    throw new Error("derived impulse field geometry drifted across curve choice");
  }
  const noopBaseEnvelopeHash = runtime.hashValue(noop.impulseEnvelope);
  const shapedBaseEnvelopeHash = runtime.hashValue(shaped.impulseEnvelope);
  if (noopBaseEnvelopeHash !== shapedBaseEnvelopeHash) throw new Error("base transient envelope drifted across curve choice");
  if (runtime.hashValue(noop.parameterCurveSource) !== noop.parameterCurveSourceHash || runtime.hashValue(shaped.parameterCurveSource) !== shaped.parameterCurveSourceHash) {
    throw new Error("parameter-curve source identity drifted");
  }
  if (noop.parameterCurveSourceHash === shaped.parameterCurveSourceHash) throw new Error("distinct caller curve choices unexpectedly share canonical source identity");

  const noopEnvelope = noop.curveModulatedImpulseEnvelopes[noopCurveRequest.id];
  const shapedEnvelope = shaped.curveModulatedImpulseEnvelopes[shapedCurveRequest.id];
  if (!noopEnvelope || !shapedEnvelope) throw new Error("derived curve-modulated transient envelopes are unavailable");
  for (const [label, state, envelope] of [["noop", noop, noopEnvelope], ["shaped", shaped, shapedEnvelope]]) {
    if (envelope.schema !== "axm.transient-impulse-curve-envelope/v0.1" || envelope.derived !== true || envelope.rebuildable !== true) {
      throw new Error(`${label} curve-modulated envelope truth boundary drifted`);
    }
    if (envelope.canonicalEventHash !== state.eventCanonicalHash || envelope.fieldGeometryHash !== state.impulseField.geometryHash || envelope.baseEnvelopeHash !== runtime.hashValue(state.impulseEnvelope) || envelope.parameterCurveSourceHash !== state.parameterCurveSourceHash) {
      throw new Error(`${label} curve-modulated envelope lineage drifted`);
    }
  }
  for (let index = 0; index < noop.impulseEnvelope.samples.length; index += 1) {
    const base = noop.impulseEnvelope.samples[index];
    const derived = noopEnvelope.samples[index];
    if (!sameSampleShape(base, derived) || derived.intensity !== base.intensity || derived.curveMultiplier !== 1) {
      throw new Error("constant-one curve stopped being an exact derived intensity no-op");
    }
  }
  let shapedChanges = 0;
  for (let index = 0; index < shaped.impulseEnvelope.samples.length; index += 1) {
    const base = shaped.impulseEnvelope.samples[index];
    const derived = shapedEnvelope.samples[index];
    if (!sameSampleShape(base, derived)) throw new Error("shaped curve rewrote base sample time or expansion");
    if (derived.intensity !== base.intensity) shapedChanges += 1;
  }
  if (shapedChanges === 0) throw new Error("shaped parameter curve did not change derived impulse intensity");

  const sampleIndex = noop.impulseEnvelope.samples.findIndex((sample) => Math.abs(sample.t - 0.25) < 1e-9);
  if (sampleIndex < 0) throw new Error("expected retained t=0.25 transient-envelope sample is unavailable");
  const baseSample = noop.impulseEnvelope.samples[sampleIndex];
  const noopSample = noopEnvelope.samples[sampleIndex];
  const shapedSample = shapedEnvelope.samples[sampleIndex];
  if (baseSample.intensity !== noopSample.intensity) throw new Error("selected constant-one observation is not an exact no-op");
  if (baseSample.intensity === shapedSample.intensity) throw new Error("selected shaped observation did not change derived intensity");
  if (shapedSample.curveMultiplier !== 1.4) throw new Error("selected shaped observation did not retain the caller-selected curve key value");

  const baseAdapted = transientImpulseIntensityToAxmScene({
    eventHash: noop.eventCanonicalHash,
    lineageHash: noopBaseEnvelopeHash,
    t: baseSample.t,
    intensity: baseSample.intensity,
  });
  const noopEnvelopeHash = runtime.hashValue(noopEnvelope);
  const shapedEnvelopeHash = runtime.hashValue(shapedEnvelope);
  const noopAdapted = transientImpulseIntensityToAxmScene({
    eventHash: noop.eventCanonicalHash,
    lineageHash: noopEnvelopeHash,
    t: noopSample.t,
    intensity: noopSample.intensity,
  });
  const shapedAdapted = transientImpulseIntensityToAxmScene({
    eventHash: shaped.eventCanonicalHash,
    lineageHash: shapedEnvelopeHash,
    t: shapedSample.t,
    intensity: shapedSample.intensity,
  });
  if (baseAdapted.bytes.compare(noopAdapted.bytes) !== 0) throw new Error("constant-one curve invented a scene difference for an intensity no-op");
  if (baseAdapted.bytes.compare(shapedAdapted.bytes) === 0) throw new Error("shaped derived intensity did not reach a distinct observation scene");
  if (new Set([baseAdapted, noopAdapted, shapedAdapted].map((item) => sceneGeometry(item.bytes))).size !== 1) {
    throw new Error("transient impulse observation adapter changed geometry across intensity states");
  }

  const eventBytes = stableBytes(noop.event);
  const fieldBytes = stableBytes(noop.impulseField);
  const baseEnvelopeBytes = stableBytes(noop.impulseEnvelope);
  const noopCurveBytes = stableBytes(noop.parameterCurveSource);
  const shapedCurveBytes = stableBytes(shaped.parameterCurveSource);
  const noopEnvelopeBytes = stableBytes(noopEnvelope);
  const shapedEnvelopeBytes = stableBytes(shapedEnvelope);
  const noopStateBytes = stableBytes(noop);
  const shapedStateBytes = stableBytes(shaped);

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: graph.id,
      graph_version: graph.version,
      hand_ids: expectedHands,
      files: {
        "hand-lab/src/hand-runtime.mjs": sources.runtime.sha256,
        "hand-lab/src/transient-impulse-curve-modulation.mjs": sources.modulation.sha256,
        "hand-lab/src/transient-impulse-hands.mjs": sources.impulseHands.sha256,
        "hand-lab/src/parameter-curve.mjs": sources.parameterCurve.sha256,
      },
    },
    caller_authority: {
      request_mutated: false,
      caller_neutral_repeat_verification: "PASS",
      canonical_event_remains_authoritative: true,
      parameter_curve_sources_remain_authoritative: true,
      base_field_and_envelope_rebuildable: true,
      curve_modulated_envelopes_rebuildable: true,
      observation_scenes_are_canonical: false,
      consumer_semantics_assigned: false,
    },
    canonical_event: {
      hash: noop.eventCanonicalHash,
      bytes_sha256: sha256(eventBytes),
      id: noop.event.id,
      duration: noop.event.duration,
    },
    base_derived_state: {
      field_geometry_hash: noop.impulseField.geometryHash,
      field_bytes_sha256: sha256(fieldBytes),
      envelope_hash: noopBaseEnvelopeHash,
      envelope_bytes_sha256: sha256(baseEnvelopeBytes),
      sample_count: noop.impulseEnvelope.samples.length,
      same_across_curve_choices: true,
    },
    curve_sources: {
      noop: { id: noop.parameterCurveSource.id, hash: noop.parameterCurveSourceHash, bytes_sha256: sha256(noopCurveBytes) },
      shaped: { id: shaped.parameterCurveSource.id, hash: shaped.parameterCurveSourceHash, bytes_sha256: sha256(shapedCurveBytes) },
    },
    derived_curve_envelopes: {
      noop: {
        hash: noopEnvelopeHash,
        bytes_sha256: sha256(noopEnvelopeBytes),
        base_envelope_hash: noopEnvelope.baseEnvelopeHash,
        parameter_curve_source_hash: noopEnvelope.parameterCurveSourceHash,
        multiplier_stats: noopEnvelope.multiplierStats,
        exact_intensity_noop: true,
      },
      shaped: {
        hash: shapedEnvelopeHash,
        bytes_sha256: sha256(shapedEnvelopeBytes),
        base_envelope_hash: shapedEnvelope.baseEnvelopeHash,
        parameter_curve_source_hash: shapedEnvelope.parameterCurveSourceHash,
        multiplier_stats: shapedEnvelope.multiplierStats,
        changed_intensity_sample_count: shapedChanges,
        expansion_preserved: true,
      },
    },
    observation: {
      sample_index: sampleIndex,
      t: baseSample.t,
      base: { intensity: baseSample.intensity, expansion: baseSample.expansion, scene_sha256: sha256(baseAdapted.bytes), adapter: baseAdapted.observation },
      noop: { intensity: noopSample.intensity, expansion: noopSample.expansion, curve_multiplier: noopSample.curveMultiplier, scene_sha256: sha256(noopAdapted.bytes), adapter: noopAdapted.observation },
      shaped: { intensity: shapedSample.intensity, expansion: shapedSample.expansion, curve_multiplier: shapedSample.curveMultiplier, scene_sha256: sha256(shapedAdapted.bytes), adapter: shapedAdapted.observation },
      base_noop_scene_identical: true,
      shaped_scene_distinct: true,
      fixed_geometry: true,
    },
    states: {
      noop_sha256: sha256(noopStateBytes),
      shaped_sha256: sha256(shapedStateBytes),
    },
    authority: "caller transient-event and parameter-curve choices remain authoritative; impulse field, base envelope, curve-modulated envelopes, AXM_SCENE bodies, render requests, receipts and pixels are derived evidence",
    truth_boundary: {
      proven: "current VFX transient-impulse parameter-curve graph, canonical-event continuity across curve choices, exact constant-one intensity no-op behavior, shaped derived intensity modulation without expansion rewrite, fixed-geometry intensity observation, and downstream native-render eligibility",
      not_proven: ["animation timing quality", "motion or pacing quality", "physical blast or fluid correctness", "consumer effect semantics", "accessibility suitability", "aesthetic quality", "real-time performance", "GPU or browser equivalence", "cross-machine bitwise determinism"],
    },
  };

  return {
    eventBytes,
    fieldBytes,
    baseEnvelopeBytes,
    noopCurveBytes,
    shapedCurveBytes,
    noopEnvelopeBytes,
    shapedEnvelopeBytes,
    noopStateBytes,
    shapedStateBytes,
    baseSceneBytes: baseAdapted.bytes,
    noopSceneBytes: noopAdapted.bytes,
    shapedSceneBytes: shapedAdapted.bytes,
    receipt,
  };
}
