import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";
import { branchGrowthNetworkToAxmScene } from "./vfx_branch_growth_native_bridge.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_BRANCH_PROPAGATION_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_SEGMENTS = 4096;
const FIXED_DERIVATION = Object.freeze({
  algorithm: "branch-root-path-propagation-envelope/v0.1",
  distanceMetric: "root-path-actual-length",
  normalization: "max-root-path-end-distance",
  sampleSites: "segment-start-end",
  phaseMode: "clamp",
});

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
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
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must remain within [0,1]`);
  return number;
}

function geometryDigest(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

function validateFixedEnvelopeSemantics(envelope) {
  for (const [key, expected] of Object.entries(FIXED_DERIVATION)) {
    if (envelope?.[key] !== expected) throw new Error(`branch-propagation observer envelope ${key} drifted`);
  }
}

export function branchPropagationEnvelopeToAxmScene(network, envelope, options = {}) {
  const maxSegments = boundedInteger(options.maxSegments ?? HARD_MAX_SEGMENTS, 1, HARD_MAX_SEGMENTS, "branch-propagation observer maxSegments");
  const base = branchGrowthNetworkToAxmScene(network);

  if (!envelope || envelope.schema !== "axm.branch-propagation-envelope2d/v0.1" || envelope.derived !== true || envelope.rebuildable !== true) {
    throw new Error("branch-propagation observer accepts only derived rebuildable v0.1 envelopes");
  }
  validateFixedEnvelopeSemantics(envelope);
  if (envelope.branchSourceHash !== network.sourceHash || envelope.networkHash !== network.networkHash) {
    throw new Error("branch-propagation observer envelope lost branch/network lineage");
  }
  if (!String(envelope.propagationSourceHash || "").trim() || !String(envelope.envelopeHash || "").trim()) {
    throw new Error("branch-propagation observer requires retained propagation and derived envelope hashes");
  }
  if (!Number.isFinite(Number(envelope.phase)) || envelope.phase < 0 || envelope.phase > 1) {
    throw new Error("branch-propagation observer phase must remain within [0,1]");
  }
  if (!Array.isArray(envelope.segments) || envelope.segments.length !== envelope.segmentCount || envelope.segmentCount !== network.segmentCount) {
    throw new Error("branch-propagation observer envelope/network cardinality mismatch");
  }
  if (envelope.segmentCount > maxSegments) {
    throw new Error(`branch-propagation observer segment budget exceeded: ${envelope.segmentCount} > ${maxSegments}`);
  }

  const orderedNetwork = [...network.segments].sort((a, b) => a.index - b.index);
  const orderedEnvelope = [...envelope.segments].sort((a, b) => a.index - b.index);
  const scene = structuredClone(base.scene);

  for (let index = 0; index < orderedNetwork.length; index += 1) {
    const segment = orderedNetwork[index];
    const row = orderedEnvelope[index];
    if (!row || row.index !== index || row.segmentId !== segment.id || row.parentId !== segment.parentId || row.generation !== segment.generation) {
      throw new Error(`branch-propagation observer segment lineage/order mismatch at index ${index}`);
    }
    const normalizedStart = boundedUnit(row.normalizedStart, `branch-propagation segment ${index} normalizedStart`);
    const normalizedEnd = boundedUnit(row.normalizedEnd, `branch-propagation segment ${index} normalizedEnd`);
    if (normalizedStart > normalizedEnd) throw new Error(`branch-propagation segment ${index} normalized path interval is reversed`);
    const startWeight = boundedUnit(row.startWeight, `branch-propagation segment ${index} startWeight`);
    const endWeight = boundedUnit(row.endWeight, `branch-propagation segment ${index} endWeight`);
    const meanWeight = (startWeight + endWeight) / 2;
    const gray = Math.round(32 + (192 * meanWeight));
    scene.triangles[index * 2].albedo = [gray, gray, gray];
    scene.triangles[(index * 2) + 1].albedo = [gray, gray, gray];
  }

  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const geometrySha256 = geometryDigest(scene);
  if (geometrySha256 !== geometryDigest(base.scene)) throw new Error("branch-propagation observer changed reused branch geometry");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-branch-propagation-envelope-to-axm-scene/v1",
      branch_source_hash: envelope.branchSourceHash,
      network_hash: envelope.networkHash,
      propagation_source_hash: envelope.propagationSourceHash,
      envelope_hash: envelope.envelopeHash,
      phase: envelope.phase,
      input_segment_count: envelope.segmentCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: scene.triangles.length,
      output_sha256: sha256(bytes),
      geometry_sha256: geometrySha256,
      geometry_is_reused_branch_observer: true,
      geometry_encodes_weight: false,
      albedo_encodes_only_donor_derived_segment_mean_weight: true,
      observer_gray_range_rgb8: [32, 224],
      consumer_semantics_assigned: false,
      adapter_policy: "reuse the proven branch-network strip geometry exactly; encode only the donor-derived mean of each segment start/end propagation weights as neutral grayscale albedo; do not infer reveal, growth, opacity, emission, material, gameplay, UI, or world meaning",
    },
  };
}

export async function observeVisualEffectBranchPropagationNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    branchGrowth: resolve(rootPath, "hand-lab/src/branch-growth2d.mjs"),
    propagationFront: resolve(rootPath, "hand-lab/src/propagation-front1d.mjs"),
    branchPropagation: resolve(rootPath, "hand-lab/src/branch-propagation-envelope.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const branchGrowth = await import(`${pathToFileURL(paths.branchGrowth).href}?sha=${sources.branchGrowth.sha256}`);
  const propagationFront = await import(`${pathToFileURL(paths.propagationFront).href}?sha=${sources.propagationFront.sha256}`);
  const branchPropagation = await import(`${pathToFileURL(paths.branchPropagation).href}?sha=${sources.branchPropagation.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (typeof branchGrowth.makeBranchGrowth2dState !== "function" || typeof branchGrowth.normalizeBranchGrowthSourceHand?.execute !== "function" || typeof branchGrowth.buildBranchGrowthNetworkHand?.execute !== "function") {
    throw new Error("VFX donor branch-growth preparation boundary is unavailable");
  }
  if (typeof propagationFront.makePropagationFrontState !== "function" || typeof propagationFront.normalizePropagationFrontSourceHand?.execute !== "function") {
    throw new Error("VFX donor propagation-front preparation boundary is unavailable");
  }
  if (!Array.isArray(branchPropagation.BRANCH_PROPAGATION_HANDS) || !branchPropagation.BRANCH_PROPAGATION_GRAPH || typeof branchPropagation.validateBranchPropagationEnvelope !== "function" || typeof branchPropagation.buildBranchPropagationEnvelopeHand?.execute !== "function") {
    throw new Error("VFX donor branch-propagation graph is unavailable");
  }
  if (branchPropagation.BRANCH_PROPAGATION_GRAPH.id !== "fx.growth.branching2d-propagation-front" || branchPropagation.BRANCH_PROPAGATION_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX branch-propagation graph identity");
  }
  if (JSON.stringify(branchPropagation.BRANCH_PROPAGATION_HANDS.map((hand) => hand.id)) !== JSON.stringify(["fx.growth.branching2d-propagation-front-envelope-build"])) {
    throw new Error("unexpected VFX branch-propagation Hand boundary");
  }

  const branchRequest = {
    id: "creative-render-branch-propagation",
    origin: [0.5, 0.88],
    headingTurns: 0.75,
    baseLength: 0.18,
    lengthDecay: 0.64,
    branchOffsetsTurns: [-0.07, 0.07],
    generations: 5,
  };
  const propagationRequest = {
    id: "creative-render-branch-propagation-front",
    direction: "forward",
    frontSoftness: 0.18,
  };
  const branchRequestBytes = stableBytes(branchRequest);
  const propagationRequestBytes = stableBytes(propagationRequest);

  let prepared = branchGrowth.makeBranchGrowth2dState(branchRequest);
  prepared = branchGrowth.normalizeBranchGrowthSourceHand.execute(prepared, {}, {}).state;
  prepared = branchGrowth.buildBranchGrowthNetworkHand.execute(prepared, { maxSegments: HARD_MAX_SEGMENTS }, {}).state;
  const propagationSeed = propagationFront.makePropagationFrontState(propagationRequest);
  prepared.propagationFrontRequest = propagationSeed.propagationFrontRequest;
  prepared.propagationFrontSamples = {};
  prepared = propagationFront.normalizePropagationFrontSourceHand.execute(prepared, {}, {}).state;
  prepared.consumerMetadata = { owner: "creative-render-observer", untouched: true };

  const preparedBytes = stableBytes(prepared);
  const key = `${prepared.branchGrowthSource.id}::${prepared.propagationFrontSource.id}`;
  const registry = runtime.createHandRegistry(branchPropagation.BRANCH_PROPAGATION_HANDS);
  const runGraph = (callerKind) => runtime.executeHandGraph({
    registry,
    graph: branchPropagation.BRANCH_PROPAGATION_GRAPH,
    initialState: prepared,
    context: { callerKind },
  });
  const human = runGraph("human");
  const machine = runGraph("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX branch-propagation caller-neutral graph replay failed");
  if (stableBytes(prepared).compare(preparedBytes) !== 0) throw new Error("VFX branch-propagation prepared donor state mutated during replay");
  if (stableBytes(human.finalState.branchGrowthRequest).compare(branchRequestBytes) !== 0) throw new Error("VFX branch-propagation caller branch request mutated");
  if (stableBytes(human.finalState.propagationFrontRequest).compare(propagationRequestBytes) !== 0) throw new Error("VFX branch-propagation caller propagation request mutated");
  if (human.finalState.branchPropagationEnvelopes?.[key]?.envelopeHash !== machine.finalState.branchPropagationEnvelopes?.[key]?.envelopeHash) {
    throw new Error("VFX branch-propagation envelope replay identity drifted");
  }

  const network = prepared.branchGrowthNetworks?.[prepared.branchGrowthSource.id];
  if (!network || network.schema !== "axm.branch-growth-network2d/v0.1" || network.derived !== true || network.rebuildable !== true) {
    throw new Error("VFX branch-propagation prepared network boundary drifted");
  }
  const phaseA = Number(options.phaseA ?? 0.22);
  const phaseB = Number(options.phaseB ?? 0.72);
  const buildPhase = (phase, maxSegments = HARD_MAX_SEGMENTS) => {
    const state = branchPropagation.buildBranchPropagationEnvelopeHand.execute(prepared, { phase, maxSegments }, {}).state;
    const envelope = state.branchPropagationEnvelopes?.[key];
    if (!envelope || branchPropagation.validateBranchPropagationEnvelope(state, envelope, { maxSegments }) !== true) {
      throw new Error(`VFX branch-propagation donor validation failed at phase ${phase}`);
    }
    return { state, envelope };
  };

  const selectedA = buildPhase(phaseA);
  const selectedB = buildPhase(phaseB);
  if (selectedA.envelope.envelopeHash === selectedB.envelope.envelopeHash) throw new Error("VFX branch-propagation selected phases did not create distinct derived envelopes");
  const exactBudgetB = buildPhase(phaseB, network.segmentCount);
  if (exactBudgetB.envelope.envelopeHash !== selectedB.envelope.envelopeHash) throw new Error("VFX branch-propagation structural maxSegments changed derived meaning");
  const clampedLow = buildPhase(-4).envelope;
  const clampedHigh = buildPhase(9).envelope;
  if (clampedLow.phase !== 0 || !clampedLow.segments.every((row) => row.startWeight === 0 && row.endWeight === 0)) {
    throw new Error("VFX branch-propagation low phase clamp drifted");
  }
  if (clampedHigh.phase !== 1 || !clampedHigh.segments.every((row) => row.startWeight === 1 && row.endWeight === 1)) {
    throw new Error("VFX branch-propagation high phase clamp drifted");
  }

  const observedA = branchPropagationEnvelopeToAxmScene(network, selectedA.envelope, { maxSegments: network.segmentCount });
  const observedB = branchPropagationEnvelopeToAxmScene(network, selectedB.envelope, { maxSegments: HARD_MAX_SEGMENTS });
  if (observedA.observation.geometry_sha256 !== observedB.observation.geometry_sha256) throw new Error("VFX branch-propagation phase changed neutral observer geometry");
  if (observedA.observation.output_sha256 === observedB.observation.output_sha256) throw new Error("VFX branch-propagation phase difference did not reach observation bytes");

  const donorStateBytes = preparedBytes;
  const retainedBranch = prepared.branchGrowthSource;
  const retainedPropagation = prepared.propagationFrontSource;
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: branchPropagation.BRANCH_PROPAGATION_GRAPH.id,
      graph_version: branchPropagation.BRANCH_PROPAGATION_GRAPH.version,
      hand_ids: branchPropagation.BRANCH_PROPAGATION_HANDS.map((hand) => hand.id),
      donor_graph_reused: true,
      donor_source_files: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, { sha256: value.sha256 }])),
      caller_neutral_replay: "PASS",
      caller_requests_unchanged: true,
      prepared_state_unchanged: true,
      retained_branch_source: {
        schema: retainedBranch.schema,
        source_hash: prepared.branchGrowthSourceHash,
        boundary_mode: retainedBranch.boundaryMode,
      },
      derived_branch_network: {
        schema: network.schema,
        network_hash: network.networkHash,
        source_hash: network.sourceHash,
        segment_count: network.segmentCount,
        derived: network.derived,
        rebuildable: network.rebuildable,
      },
      retained_propagation_source: {
        schema: retainedPropagation.schema,
        source_hash: prepared.propagationFrontSourceHash,
        algorithm: retainedPropagation.algorithm,
        profile: retainedPropagation.profile,
        direction: retainedPropagation.direction,
        front_softness: retainedPropagation.frontSoftness,
      },
      truth_boundary: {
        retained_sources_authority: "RETAINED_VFX_BRANCH_GROWTH_AND_PROPAGATION_FRONT_SOURCES",
        branch_network_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        propagation_envelopes_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        native_scenes_and_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
        reveal_or_growth_semantics_proven: false,
        opacity_or_emission_semantics_proven: false,
        animation_timing_proven: false,
        aesthetic_quality_proven: false,
        accessibility_proven: false,
        realtime_performance_proven: false,
      },
    },
    selected: {
      phase_a: selectedA.envelope,
      phase_b: selectedB.envelope,
      clamped_low: { phase: clampedLow.phase, envelope_hash: clampedLow.envelopeHash, all_zero: true },
      clamped_high: { phase: clampedHigh.phase, envelope_hash: clampedHigh.envelopeHash, all_one: true },
      exact_vs_roomy: {
        max_segments_exact: network.segmentCount,
        max_segments_roomy: HARD_MAX_SEGMENTS,
        phase_b_envelope_hash: selectedB.envelope.envelopeHash,
        exact_envelope_hash: exactBudgetB.envelope.envelopeHash,
        identical: true,
      },
    },
    native_observer: {
      phase_a: observedA.observation,
      phase_b: observedB.observation,
      difference_channel: "NEUTRAL_GRAYSCALE_FROM_DONOR_DERIVED_SEGMENT_MEAN_WEIGHT_ONLY",
    },
    invariants: {
      branch_source_hash_stable_across_phases: selectedA.envelope.branchSourceHash === selectedB.envelope.branchSourceHash && selectedA.envelope.branchSourceHash === prepared.branchGrowthSourceHash,
      network_hash_stable_across_phases: selectedA.envelope.networkHash === selectedB.envelope.networkHash && selectedA.envelope.networkHash === network.networkHash,
      propagation_source_hash_stable_across_phases: selectedA.envelope.propagationSourceHash === selectedB.envelope.propagationSourceHash && selectedA.envelope.propagationSourceHash === prepared.propagationFrontSourceHash,
      selected_envelopes_remain_derived_rebuildable: selectedA.envelope.derived === true && selectedA.envelope.rebuildable === true && selectedB.envelope.derived === true && selectedB.envelope.rebuildable === true,
      observer_geometry_fixed_across_phases: observedA.observation.geometry_sha256 === observedB.observation.geometry_sha256,
      observer_bytes_change_only_after_derived_weight_change: observedA.observation.output_sha256 !== observedB.observation.output_sha256,
      consumer_metadata_untouched: prepared.consumerMetadata?.untouched === true,
    },
    outputs: {
      phase_a_scene: { sha256: observedA.observation.output_sha256, bytes: observedA.bytes.length },
      phase_b_scene: { sha256: observedB.observation.output_sha256, bytes: observedB.bytes.length },
      donor_state: { sha256: sha256(donorStateBytes), bytes: donorStateBytes.length },
    },
  };
  if (!Object.values(receipt.invariants).every(Boolean)) throw new Error("VFX branch-propagation receipt invariants failed");
  const receiptBytes = stableBytes(receipt);

  return {
    phaseASceneBytes: observedA.bytes,
    phaseBSceneBytes: observedB.bytes,
    donorStateBytes,
    receipt,
    receiptBytes,
    network,
    phaseAEnvelope: selectedA.envelope,
    phaseBEnvelope: selectedB.envelope,
  };
}
