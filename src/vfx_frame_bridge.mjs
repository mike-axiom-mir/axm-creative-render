import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { parsePpmRgb8, ppmToPrecisionRaster, precisionRasterToPpm } from "./post_render_bridge.mjs";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export async function executeElectricEffect(root, seed = 20260915) {
  const rootPath = resolve(root);
  const runtimePath = resolve(rootPath, "hand-lab/src/hand-runtime.mjs");
  const effectPath = resolve(rootPath, "hand-lab/src/electric-hands.mjs");
  const [runtimeSource, effectSource] = await Promise.all([digestFile(runtimePath), digestFile(effectPath)]);
  const runtime = await import(`${pathToFileURL(runtimePath).href}?sha=${runtimeSource.sha256}`);
  const effect = await import(`${pathToFileURL(effectPath).href}?sha=${effectSource.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the expected Hand runtime");
  }
  if (!Array.isArray(effect.ELECTRIC_HANDS) || !effect.ELECTRIC_STORM_GRAPH || typeof effect.makeElectricInitialState !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the electric-storm Hand graph");
  }
  if (!Number.isSafeInteger(Number(seed))) throw new Error("effect seed must be an integer");

  const registry = runtime.createHandRegistry(effect.ELECTRIC_HANDS);
  const run = runtime.executeHandGraph({
    registry,
    graph: effect.ELECTRIC_STORM_GRAPH,
    initialState: effect.makeElectricInitialState(Number(seed)),
    context: { callerKind: "axm-creative-render" },
  });
  const finalState = object(run.finalState, "electric effect final state");
  const realization = object(finalState.realizations?.svgPreview, "electric SVG realization");
  if (realization.mediaType !== "image/svg+xml" || typeof realization.content !== "string" || !realization.content.includes("<svg")) {
    throw new Error("electric effect did not produce the expected SVG realization");
  }
  const svgBytes = Buffer.from(realization.content, "utf8");
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  const pathCount = Array.isArray(finalState.paths) ? finalState.paths.length : 0;
  if (pathCount < 1) throw new Error("electric effect produced no canonical paths");

  return {
    svgBytes,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-electric-observation/v1",
      donor: "axm-visual-effect-fabric",
      runtime_sha256: runtimeSource.sha256,
      effect_module_sha256: effectSource.sha256,
      graph_id: run.graph?.id ?? effect.ELECTRIC_STORM_GRAPH.id,
      graph_version: run.graph?.version ?? effect.ELECTRIC_STORM_GRAPH.version,
      graph_stage_count: effect.ELECTRIC_STORM_GRAPH.stages.length,
      executed_stage_count: run.executedStageIds?.length ?? null,
      final_state_hash: run.finalStateHash,
      path_count: pathCount,
      topology_hash: realization.derivedFromTopologyHash ?? null,
      svg_sha256: sha256(svgBytes),
      state_sha256: sha256(stateBytes),
      seed: Number(seed),
    },
  };
}

function validateCompositeFlow(result) {
  object(result, "VFX composite Creative Flow result");
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) {
    throw new Error(`VFX composite Creative Flow did not pass cleanly: ${String(result.status)}`);
  }
  if (!Array.isArray(result.receipts) || result.receipts.length !== 2) throw new Error("VFX composite Creative Flow receipt count drifted");
  const styled = object(result.final_state?.styled, "VFX composite styled raster");
  if (styled.schema !== "axm.precision-raster/v1") throw new Error("VFX composite did not return precision raster state");
  return styled;
}

export async function compositeElectricRasterWithUniversalCreation(root, basePpmBytes, effectPpmBytes) {
  const basePpm = parsePpmRgb8(basePpmBytes);
  const effectPpm = parsePpmRgb8(effectPpmBytes);
  if (basePpm.width !== effectPpm.width || basePpm.height !== effectPpm.height) {
    throw new Error("base frame and effect raster dimensions must match");
  }

  const rootPath = resolve(root);
  const entryPath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const entry = await digestFile(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands;
  const flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeHands service");
  }
  if (!flow || typeof flow.summary !== "function" || typeof flow.run !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeFlow service");
  }

  const audit = object(hands.audit(), "creative hands audit");
  const recipes = object(hands.recipeRegistry(), "creative recipe registry");
  const summary = object(flow.summary(), "creative flow summary");
  const baseRaster = ppmToPrecisionRaster(basePpmBytes);
  const effectRaster = ppmToPrecisionRaster(effectPpmBytes);
  const request = {
    mode: "execute",
    goal: "screen-composite a verified special-effect realization over a rendered frame",
    state: { base: baseRaster, effect: effectRaster },
    steps: [
      {
        id: "screen",
        hand_id: "creative.composite.screen",
        args: { base: { $state: "base" }, top: { $state: "effect" }, spec: { opacity: 0.82 } },
        save_as: "composite",
      },
      {
        id: "finish",
        hand_id: "creative.adjust.contrast",
        args: { image: { $state: "composite.image" }, spec: { factor: 1.06 } },
        save_as: "styled",
      },
    ],
  };

  const first = flow.run(request);
  const firstRaster = validateCompositeFlow(first);
  const second = flow.run(request);
  const secondRaster = validateCompositeFlow(second);
  const outputPpm = precisionRasterToPpm(firstRaster);
  const repeatPpm = precisionRasterToPpm(secondRaster);
  if (first.digest !== second.digest || firstRaster.digest !== secondRaster.digest || !outputPpm.equals(repeatPpm)) {
    throw new Error("VFX composite repeat verification failed");
  }
  if (outputPpm.equals(basePpmBytes)) throw new Error("VFX composite produced unchanged frame bytes");

  return {
    outputPpm,
    observation: {
      schema: "axm.creative-render.vfx-composite-uc-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      creative_hands_version: String(hands.version ?? "unknown"),
      hand_count: audit.total,
      hand_audit_digest: audit.digest ?? null,
      recipe_count: recipes.count,
      recipe_registry_digest: recipes.digest ?? null,
      creative_flow_version: String(flow.version ?? "unknown"),
      creative_flow_summary_digest: summary.digest ?? null,
      flow_digest: first.digest ?? null,
      flow_receipts: first.receipts,
      operation_ids: first.receipts.map((row) => row.operation_id ?? null),
      base_raster_digest: baseRaster.digest,
      effect_raster_digest: effectRaster.digest,
      output_raster_digest: firstRaster.digest ?? null,
      base_ppm_sha256: sha256(basePpmBytes),
      effect_ppm_sha256: sha256(effectPpmBytes),
      output_ppm_sha256: sha256(outputPpm),
      width: basePpm.width,
      height: basePpm.height,
      repeat_verification: "PASS",
      blend_mode: "screen",
      blend_opacity: 0.82,
    },
  };
}
