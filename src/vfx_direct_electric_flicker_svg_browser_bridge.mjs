import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  makeElectricSvgBrowserProbeHtml,
  parseElectricSvgBrowserProbeDump,
  verifyElectricSvgBrowserRasterEvidence,
} from "./vfx_electric_svg_browser_bridge.mjs";
import { observeVisualEffectDirectElectricFlicker } from "./vfx_direct_electric_flicker_bridge.mjs";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function graphAtPhase(graph, phase) {
  return {
    ...structuredClone(graph),
    stages: graph.stages.map((stage) => stage.id === "modulate-derived-electric-paths"
      ? { ...structuredClone(stage), params: { ...(stage.params ?? {}), phase } }
      : structuredClone(stage)),
  };
}

function selectedSet(state, id) {
  return object(state.flickerModulatedElectricPathSets?.[id], `VFX direct electric flicker set ${id}`);
}

function svgBytes(realizationValue, label) {
  const realization = object(realizationValue, label);
  if (realization.mediaType !== "image/svg+xml") throw new Error(`${label} media type must be image/svg+xml`);
  if (realization.renderer !== "axm.vfx.electric-flicker-modulated-svg/v0.1") throw new Error(`${label} renderer identity drifted`);
  const content = text(realization.content, `${label}.content`);
  if (!content.includes("<svg") || !content.includes("<polyline")) throw new Error(`${label} must contain SVG electric path markup`);
  return Buffer.from(content, "utf8");
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

function fixtureOptions(options = {}) {
  return {
    id: String(options.id ?? "creative-render-direct-electric-flicker-svg"),
    strength: options.strength ?? 0.8,
    floor: options.floor ?? 0.22,
    electric: options.electric ?? {
      seed: 20260918,
      source: { x: 0.08, y: 0.56 },
      target: { x: 0.92, y: 0.40 },
      controls: { branchEnergyScale: 0.68, glowScale: 1 },
    },
    flicker: options.flicker ?? {
      id: "creative-render-direct-electric-flicker-svg-cycle",
      seed: 7331,
      slotCount: 12,
      minValue: 0,
      maxValue: 1,
      responsePower: 1,
      phaseOffset: 0,
    },
  };
}

function verifyRealization({ state, set, realization, runtime, label }) {
  object(state, `${label} state`);
  object(set, `${label} selected set`);
  const row = object(realization, `${label} realization`);
  if (row.basePathsHash !== state.electricBasePathsHash || row.basePathsHash !== set.basePathsHash) throw new Error(`${label} base path lineage drifted`);
  if (row.flickerCycleSourceHash !== state.flickerCycleSourceHash || row.flickerCycleSourceHash !== set.flickerCycleSourceHash) throw new Error(`${label} flicker source lineage drifted`);
  if (row.electricFlickerModulationSourceHash !== state.electricFlickerModulationSourceHash || row.electricFlickerModulationSourceHash !== set.electricFlickerModulationSourceHash) throw new Error(`${label} modulation source lineage drifted`);
  if (row.derivedFromSelectedPathSetHash !== set.pathSetHash) throw new Error(`${label} selected path lineage drifted`);
  if (row.selectedPathSet?.pathSetHash !== set.pathSetHash || row.selectedPathSet?.modulatedSetHash !== set.modulatedSetHash) throw new Error(`${label} selected derived identity drifted`);
  if (row.selectedPathSet?.phase !== set.phase || row.factor !== set.factor || row.normalizedSample !== set.normalizedSample || row.sampleValue !== set.sampleValue) throw new Error(`${label} selected phase evidence drifted`);
  if (row.contentHash !== runtime.hashValue(row.content)) throw new Error(`${label} donor SVG content hash drifted`);
  return svgBytes(row, label);
}

export function makeDirectElectricFlickerSvgBrowserProbeHtml({ phaseASvg, phaseBSvg }) {
  return makeElectricSvgBrowserProbeHtml({ baseSvg: phaseASvg, modulatedSvg: phaseBSvg });
}

export function parseDirectElectricFlickerSvgBrowserProbeDump(bytes) {
  return parseElectricSvgBrowserProbeDump(bytes);
}

export function verifyDirectElectricFlickerSvgBrowserRasterEvidence(value, expected = {}) {
  return verifyElectricSvgBrowserRasterEvidence(value, {
    baseSvgSha256: expected.phaseASvgSha256,
    modulatedSvgSha256: expected.phaseBSvgSha256,
    requireDifference: expected.requireDifference,
  });
}

export async function observeVisualEffectDirectElectricFlickerSvg(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    electric: resolve(rootPath, "hand-lab/src/electric-hands.mjs"),
    flicker: resolve(rootPath, "hand-lab/src/flicker-cycle1d.mjs"),
    modulation: resolve(rootPath, "hand-lab/src/electric-flicker-modulation.mjs"),
    flickerSvg: resolve(rootPath, "hand-lab/src/electric-flicker-modulated-svg.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const electric = await import(`${pathToFileURL(paths.electric).href}?sha=${sources.electric.sha256}`);
  const modulation = await import(`${pathToFileURL(paths.modulation).href}?sha=${sources.modulation.sha256}`);
  const flickerSvg = await import(`${pathToFileURL(paths.flickerSvg).href}?sha=${sources.flickerSvg.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (typeof electric.svgPreviewHand?.execute !== "function") throw new Error("VFX ordinary electric SVG donor is unavailable");
  if (typeof modulation.validateElectricFlickerModulatedPathSet !== "function") throw new Error("VFX electric flicker validator is unavailable");
  if (!Array.isArray(flickerSvg.ELECTRIC_FLICKER_MODULATED_SVG_HANDS) || !flickerSvg.ELECTRIC_FLICKER_MODULATED_SVG_GRAPH || typeof flickerSvg.makeElectricFlickerModulatedSvgState !== "function") throw new Error("VFX direct electric flicker SVG graph is unavailable");
  if (typeof flickerSvg.electricFlickerModulatedSvgHand?.execute !== "function") throw new Error("VFX direct electric flicker SVG realization Hand is unavailable");
  const graph = flickerSvg.ELECTRIC_FLICKER_MODULATED_SVG_GRAPH;
  if (graph.id !== "fx.electric-storm.flicker-cycle-modulated-svg" || graph.version !== "0.1.0") throw new Error("unexpected VFX direct electric flicker SVG graph identity");
  if (flickerSvg.electricFlickerModulatedSvgHand.id !== "fx.electric.flicker-modulated-svg-realize" || flickerSvg.electricFlickerModulatedSvgHand.callerNeutral !== true || flickerSvg.electricFlickerModulatedSvgHand.network !== "forbidden") throw new Error("VFX direct electric flicker SVG Hand boundary drifted");

  const opts = fixtureOptions(options);
  const phaseA = Number(options.phaseA ?? 0.11);
  const phaseB = Number(options.phaseB ?? 0.43);
  const prior = await observeVisualEffectDirectElectricFlicker(rootPath, { ...opts, phaseA, phaseB });

  const execute = (phase, callerKind, stateOpts = opts) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(flickerSvg.ELECTRIC_FLICKER_MODULATED_SVG_HANDS),
    graph: graphAtPhase(graph, phase),
    initialState: flickerSvg.makeElectricFlickerModulatedSvgState(stateOpts),
    context: { callerKind },
  });

  const humanA = execute(phaseA, "human");
  const machineA = execute(phaseA, "machine");
  const humanB = execute(phaseB, "human");
  const machineB = execute(phaseB, "machine");
  if (humanA.finalStateHash !== machineA.finalStateHash || humanB.finalStateHash !== machineB.finalStateHash) throw new Error("VFX direct electric flicker SVG caller-neutral replay failed");

  const stateA = object(humanA.finalState, "VFX direct electric flicker SVG phase A state");
  const stateB = object(humanB.finalState, "VFX direct electric flicker SVG phase B state");
  const setA = selectedSet(stateA, opts.id);
  const setB = selectedSet(stateB, opts.id);
  if (!modulation.validateElectricFlickerModulatedPathSet(stateA, setA) || !modulation.validateElectricFlickerModulatedPathSet(stateB, setB)) throw new Error("VFX direct electric flicker SVG donor rebuild validation failed");
  if (setA.modulatedSetHash !== prior.setA.modulatedSetHash || setB.modulatedSetHash !== prior.setB.modulatedSetHash) throw new Error("VFX SVG graph changed the already-proven direct electric flicker derived identities");
  if (stateA.electricBasePathsHash !== stateB.electricBasePathsHash || stateA.flickerCycleSourceHash !== stateB.flickerCycleSourceHash || stateA.electricFlickerModulationSourceHash !== stateB.electricFlickerModulationSourceHash) throw new Error("VFX direct electric flicker SVG phases changed retained source authority");

  const realizationA = object(stateA.realizations?.electricFlickerModulatedSvg, "VFX direct electric flicker phase A SVG realization");
  const realizationB = object(stateB.realizations?.electricFlickerModulatedSvg, "VFX direct electric flicker phase B SVG realization");
  const phaseASvg = verifyRealization({ state: stateA, set: setA, realization: realizationA, runtime, label: "VFX direct electric flicker phase A SVG" });
  const phaseBSvg = verifyRealization({ state: stateB, set: setB, realization: realizationB, runtime, label: "VFX direct electric flicker phase B SVG" });
  if (setA.factor === setB.factor) throw new Error("selected VFX direct electric flicker SVG phases did not produce distinct donor factors");
  if (sha256(phaseASvg) === sha256(phaseBSvg)) throw new Error("distinct VFX direct electric flicker factors produced byte-identical SVG realizations");

  const loop = execute(phaseA + 1, "human");
  const loopState = object(loop.finalState, "VFX direct electric flicker SVG loop state");
  const loopSet = selectedSet(loopState, opts.id);
  const loopRealization = object(loopState.realizations?.electricFlickerModulatedSvg, "VFX direct electric flicker loop SVG realization");
  const loopSvg = verifyRealization({ state: loopState, set: loopSet, realization: loopRealization, runtime, label: "VFX direct electric flicker loop SVG" });
  if (loopSet.modulatedSetHash !== setA.modulatedSetHash || !loopSvg.equals(phaseASvg)) throw new Error("VFX direct electric flicker SVG whole-cycle identity replay failed");

  const zeroOptions = { ...structuredClone(opts), id: `${opts.id}-zero-strength`, strength: 0 };
  const zero = execute(phaseB, "human", zeroOptions);
  const zeroState = object(zero.finalState, "VFX direct electric flicker zero-strength SVG state");
  const zeroSet = selectedSet(zeroState, zeroOptions.id);
  const zeroRealization = object(zeroState.realizations?.electricFlickerModulatedSvg, "VFX direct electric flicker zero-strength SVG realization");
  const zeroSvg = verifyRealization({ state: zeroState, set: zeroSet, realization: zeroRealization, runtime, label: "VFX direct electric flicker zero-strength SVG" });
  if (zeroSet.factor !== 1 || zeroSet.pathSetHash !== zeroState.electricBasePathsHash) throw new Error("VFX direct electric flicker zero-strength path body was not an exact donor no-op");
  const ordinaryZero = object(electric.svgPreviewHand.execute(structuredClone(zeroState), {}).state?.realizations?.svgPreview, "VFX ordinary zero-strength electric SVG realization");
  const ordinaryZeroSvg = Buffer.from(text(ordinaryZero.content, "VFX ordinary zero-strength electric SVG content"), "utf8");
  if (ordinaryZero.derivedFromTopologyHash !== zeroState.electricBasePathsHash || !zeroSvg.equals(ordinaryZeroSvg)) throw new Error("VFX direct electric flicker zero-strength SVG was not byte-identical to the ordinary retained-base SVG donor");

  const tamperedState = structuredClone(stateA);
  const tampered = structuredClone(setA);
  tampered.paths[0].energy = Number((Number(tampered.paths[0].energy) + 0.01).toFixed(6));
  tampered.pathSetHash = runtime.hashValue(tampered.paths);
  tampered.modulatedSetHash = runtime.hashValue(modulatedSetHashPayload(tampered));
  tamperedState.flickerModulatedElectricPathSets[opts.id] = tampered;
  let selfConsistentTamperRejected = false;
  try {
    flickerSvg.electricFlickerModulatedSvgHand.execute(tamperedState, {});
  } catch (error) {
    selfConsistentTamperRejected = /does not rebuild from retained source truth/.test(String(error));
  }
  if (!selfConsistentTamperRejected) throw new Error("self-consistent direct electric flicker SVG derived tamper was accepted");

  const probeHtml = makeDirectElectricFlickerSvgBrowserProbeHtml({ phaseASvg, phaseBSvg });
  const stateBytes = Buffer.from(`${JSON.stringify({ phase_a: stateA, phase_b: stateB }, null, 2)}\n`, "utf8");
  return {
    phaseASvg,
    phaseBSvg,
    zeroSvg,
    probeHtml,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-direct-electric-flicker-svg-browser-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      graph_id: graph.id,
      graph_version: graph.version,
      realization_hand_id: flickerSvg.electricFlickerModulatedSvgHand.id,
      ordinary_svg_donor_reused: true,
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      caller_neutral_replay: "PASS",
      retained: {
        electric_base_paths_hash: stateA.electricBasePathsHash,
        flicker_cycle_source_hash: stateA.flickerCycleSourceHash,
        electric_flicker_modulation_source_hash: stateA.electricFlickerModulationSourceHash,
      },
      derived: {
        phase_a: { phase: setA.phase, factor: setA.factor, path_set_hash: setA.pathSetHash, modulated_set_hash: setA.modulatedSetHash, svg_content_hash: realizationA.contentHash, svg_sha256: sha256(phaseASvg) },
        phase_b: { phase: setB.phase, factor: setB.factor, path_set_hash: setB.pathSetHash, modulated_set_hash: setB.modulatedSetHash, svg_content_hash: realizationB.contentHash, svg_sha256: sha256(phaseBSvg) },
      },
      invariants: {
        prior_direct_modulation_identities_preserved: true,
        donor_rebuild_validation: true,
        same_retained_sources_between_phases: true,
        whole_cycle_selected_set_and_svg_identity_replay: true,
        zero_strength_exact_path_no_op: true,
        zero_strength_svg_byte_identical_to_ordinary_base_donor: true,
        self_consistent_derived_tamper_rejected_by_realization_hand: true,
        phase_svg_bytes_differ: true,
      },
      truth_boundary: {
        electric_base_paths_authority: "RETAINED_VFX_ELECTRIC_PATH_STATE",
        flicker_source_authority: "RETAINED_VFX_FLICKER_CYCLE_SOURCE",
        modulation_source_authority: "RETAINED_VFX_ELECTRIC_FLICKER_BINDING_SOURCE",
        modulated_path_sets_authority: "DERIVED_REBUILDABLE_VFX_BODY",
        svg_realizations_authority: "DERIVED_REPLACEABLE_VFX_BODY",
        browser_probe_and_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_EVIDENCE",
        browser_pixels_proven_before_browser_verification: false,
        temporal_animation_proven: false,
        perceptual_flicker_quality_proven: false,
        photosensitivity_or_comfort_proven: false,
        aesthetic_quality_proven: false,
      },
    },
  };
}
