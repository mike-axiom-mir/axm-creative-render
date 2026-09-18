import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PHASE_RELATIONSHIP_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_CHANNELS = 32;
const FIXED_SEMANTICS = Object.freeze({
  algorithm: "integer-cycle-phase-relationship1d/v0.1",
  phaseDomain: "normalized-group-cycle",
  wrapMode: "loop",
  relationshipRule: "channel-phase=wrap(group-phase*cycles-per-group+phase-offset)",
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

function boundedUnitHalfOpen(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number >= 1) {
    throw new Error(`${label} must remain within [0,1)`);
  }
  return number;
}

function validateSource(source, sourceHash) {
  if (!source || source.schema !== "axm.phase-relationship-source/v0.1") {
    throw new Error("phase-relationship observer requires retained v0.1 source");
  }
  for (const [key, expected] of Object.entries(FIXED_SEMANTICS)) {
    if (source[key] !== expected) throw new Error(`phase-relationship source ${key} drifted`);
  }
  if (!String(sourceHash || "").trim()) throw new Error("phase-relationship observer requires source hash");
  if (!Array.isArray(source.channels) || source.channels.length < 2 || source.channels.length > HARD_MAX_CHANNELS) {
    throw new Error("phase-relationship source channel cardinality drifted");
  }
}

function geometryDigest(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

export function phaseRelationshipSetToAxmScene(source, sourceHash, set, options = {}) {
  validateSource(source, sourceHash);
  const maxChannels = boundedInteger(
    options.maxChannels ?? HARD_MAX_CHANNELS,
    2,
    HARD_MAX_CHANNELS,
    "phase-relationship observer maxChannels",
  );
  if (!set || set.schema !== "axm.phase-relationship-set/v0.1" || set.derived !== true || set.rebuildable !== true) {
    throw new Error("phase-relationship observer accepts only derived rebuildable v0.1 phase sets");
  }
  if (set.sourceHash !== sourceHash) throw new Error("phase-relationship observer source lineage mismatch");
  if (!String(set.phaseSetHash || "").trim()) throw new Error("phase-relationship observer requires derived phase-set hash");
  boundedUnitHalfOpen(set.groupPhase, "phase-relationship derived groupPhase");
  if (!Array.isArray(set.channels) || set.channels.length !== source.channels.length) {
    throw new Error("phase-relationship observer source/set cardinality mismatch");
  }
  if (set.channels.length > maxChannels) {
    throw new Error(`phase-relationship observer channel budget exceeded: ${set.channels.length} > ${maxChannels}`);
  }

  const count = set.channels.length;
  const triangles = [];
  const barWidth = Math.min(0.18, 0.72 / count);
  const gap = 0.8 / count;
  for (let index = 0; index < count; index += 1) {
    const sourceChannel = source.channels[index];
    const channel = set.channels[index];
    if (!channel || channel.id !== sourceChannel.id) {
      throw new Error(`phase-relationship observer channel lineage/order mismatch at index ${index}`);
    }
    const phase = boundedUnitHalfOpen(channel.phase, `phase-relationship channel ${channel.id} phase`);
    const centerX = 0.1 + (gap * (index + 0.5));
    const x0 = centerX - (barWidth / 2);
    const x1 = centerX + (barWidth / 2);
    const y0 = 0.22;
    const y1 = 0.78;
    const gray = Math.round(32 + (192 * phase));
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
      schema: "axm.creative-render.vfx-phase-relationship-to-axm-scene/v1",
      source_hash: sourceHash,
      phase_set_hash: set.phaseSetHash,
      group_phase: set.groupPhase,
      input_channel_count: count,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_sha256: geometryDigest(scene),
      geometry_encodes_phase: false,
      albedo_encodes_only_donor_derived_channel_phase: true,
      observer_gray_range_rgb8: [32, 224],
      consumer_semantics_assigned: false,
      adapter_policy: "use fixed per-channel rectangle geometry and encode only the donor-derived normalized channel phase as neutral grayscale albedo; do not infer animation, synchronization quality, effect, material, light, audio, gameplay, UI, or world meaning",
    },
  };
}

export async function observeVisualEffectPhaseRelationshipNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    phaseRelationship: resolve(rootPath, "hand-lab/src/phase-relationship1d.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const phaseRelationship = await import(
    `${pathToFileURL(paths.phaseRelationship).href}?sha=${sources.phaseRelationship.sha256}`
  );

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(phaseRelationship.PHASE_RELATIONSHIP_HANDS) ||
      !phaseRelationship.PHASE_RELATIONSHIP_GRAPH ||
      typeof phaseRelationship.makePhaseRelationshipState !== "function" ||
      typeof phaseRelationship.validatePhaseRelationshipSet !== "function") {
    throw new Error("VFX donor phase-relationship boundary is unavailable");
  }
  if (phaseRelationship.PHASE_RELATIONSHIP_GRAPH.id !== "fx.animation.phase-relationship1d" ||
      phaseRelationship.PHASE_RELATIONSHIP_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX phase-relationship graph identity");
  }

  const channels = [
    { id: "fast", cyclesPerGroup: 3, phaseOffset: 0.5 },
    { id: "medium", cyclesPerGroup: 2, phaseOffset: 0.25 },
    { id: "slow", cyclesPerGroup: 1, phaseOffset: 0 },
  ];
  const initial = phaseRelationship.makePhaseRelationshipState({
    id: "creative-render-neutral-phase-group",
    channels,
  });
  initial.consumerMetadata = { owner: "creative-render-observer", untouched: true };
  const initialBytes = stableBytes(initial);
  const requestBytes = stableBytes(initial.phaseRelationshipRequest);
  const registry = runtime.createHandRegistry(phaseRelationship.PHASE_RELATIONSHIP_HANDS);

  const graphAt = (phase) => ({
    ...phaseRelationship.PHASE_RELATIONSHIP_GRAPH,
    stages: phaseRelationship.PHASE_RELATIONSHIP_GRAPH.stages.map((stage) =>
      stage.id === "resolve-phase-relationship"
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
    throw new Error("VFX phase-relationship caller-neutral replay failed");
  }
  if (stableBytes(initial).compare(initialBytes) !== 0) throw new Error("VFX phase-relationship initial state mutated during replay");
  if (stableBytes(humanA.finalState.phaseRelationshipRequest).compare(requestBytes) !== 0 ||
      stableBytes(humanB.finalState.phaseRelationshipRequest).compare(requestBytes) !== 0) {
    throw new Error("VFX phase-relationship caller request mutated");
  }

  const source = humanA.finalState.phaseRelationshipSource;
  const sourceHash = humanA.finalState.phaseRelationshipSourceHash;
  const sourceB = humanB.finalState.phaseRelationshipSource;
  const sourceHashB = humanB.finalState.phaseRelationshipSourceHash;
  validateSource(source, sourceHash);
  if (sourceHashB !== sourceHash || stableBytes(sourceB).compare(stableBytes(source)) !== 0) {
    throw new Error("VFX phase-relationship selected group phase rewrote retained source truth");
  }
  const key = source.id;
  const selectedA = humanA.finalState.phaseRelationshipSets?.[key];
  const selectedB = humanB.finalState.phaseRelationshipSets?.[key];
  if (phaseRelationship.validatePhaseRelationshipSet(humanA.finalState, selectedA) !== true ||
      phaseRelationship.validatePhaseRelationshipSet(humanB.finalState, selectedB) !== true) {
    throw new Error("VFX phase-relationship donor validation failed");
  }
  if (selectedA.phaseSetHash === selectedB.phaseSetHash) {
    throw new Error("VFX phase-relationship selected group phases did not create distinct derived sets");
  }

  const seam = runGraph(phaseA + 1, "machine").finalState.phaseRelationshipSets?.[key];
  if (!seam || seam.phaseSetHash !== selectedA.phaseSetHash || seam.groupPhase !== selectedA.groupPhase) {
    throw new Error("VFX phase-relationship whole-group-cycle seam drifted");
  }

  const reversed = phaseRelationship.makePhaseRelationshipState({
    id: "creative-render-neutral-phase-group",
    channels: [...channels].reverse(),
  });
  const normalizedOriginal = phaseRelationship.normalizePhaseRelationshipSourceHand.execute(initial, {}, {}).state;
  const normalizedReversed = phaseRelationship.normalizePhaseRelationshipSourceHand.execute(reversed, {}, {}).state;
  if (normalizedOriginal.phaseRelationshipSourceHash !== normalizedReversed.phaseRelationshipSourceHash) {
    throw new Error("VFX phase-relationship caller ordering changed retained source truth");
  }

  const observedA = phaseRelationshipSetToAxmScene(source, sourceHash, selectedA, { maxChannels: source.channels.length });
  const observedB = phaseRelationshipSetToAxmScene(source, sourceHash, selectedB, { maxChannels: HARD_MAX_CHANNELS });
  if (observedA.observation.geometry_sha256 !== observedB.observation.geometry_sha256) {
    throw new Error("VFX phase-relationship phase changed neutral observer geometry");
  }
  if (observedA.observation.output_sha256 === observedB.observation.output_sha256) {
    throw new Error("VFX phase-relationship phase difference did not reach observation bytes");
  }

  const donorStateBytes = stableBytes(humanA.finalState);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: phaseRelationship.PHASE_RELATIONSHIP_GRAPH.id,
      graph_version: phaseRelationship.PHASE_RELATIONSHIP_GRAPH.version,
      hand_ids: phaseRelationship.PHASE_RELATIONSHIP_HANDS.map((hand) => hand.id),
      donor_graph_reused: true,
      donor_source_files: sources,
      caller_neutral_replay: "PASS",
      caller_request_unchanged: true,
      initial_state_unchanged: true,
      retained_phase_relationship_source: {
        schema: source.schema,
        source_hash: sourceHash,
        algorithm: source.algorithm,
        phase_domain: source.phaseDomain,
        wrap_mode: source.wrapMode,
        relationship_rule: source.relationshipRule,
        channel_count: source.channels.length,
        channels: source.channels,
      },
      canonical_ordering: {
        reversed_request_source_hash: normalizedReversed.phaseRelationshipSourceHash,
        equals_original_source_hash: true,
      },
      truth_boundary: {
        retained_phase_relationship_source_authority: "RETAINED_VFX_SOURCE",
        selected_group_phase_authority: "DERIVED_REBUILDABLE_SELECTION",
        channel_phase_sets_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        native_scenes_and_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
        animation_timing_proven: false,
        synchronization_quality_proven: false,
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
        phase_set_hash: seam.phaseSetHash,
        equals_phase_a: true,
      },
    },
    native_observer: {
      phase_a: observedA.observation,
      phase_b: observedB.observation,
      difference_channel: "NEUTRAL_GRAYSCALE_FROM_DONOR_DERIVED_CHANNEL_PHASE_ONLY",
    },
    invariants: {
      retained_source_identical_across_group_phase: true,
      whole_group_cycle_closes_exactly: true,
      caller_ordering_canonicalized: true,
      caller_neutral_replay: true,
      source_and_request_unchanged: true,
      geometry_fixed_across_group_phase: true,
      channel_phase_sets_derived_and_rebuildable: true,
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
    source,
    sourceHash,
    phaseASet: selectedA,
    phaseBSet: selectedB,
  };
}
