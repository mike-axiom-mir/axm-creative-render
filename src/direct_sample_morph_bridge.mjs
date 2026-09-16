import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";

const MAX_VFX_POINTS = 24_000;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function validateSampleField(field, label) {
  object(field, label);
  if ((field.stride ?? 7) !== 7) throw new Error(`${label} must use stride 7`);
  if (!Array.isArray(field.points) || field.points.length === 0 || field.points.length % 7 !== 0) {
    throw new Error(`${label} must contain a non-empty packed stride-7 point array`);
  }
  const pointCount = field.points.length / 7;
  if (pointCount > MAX_VFX_POINTS) throw new Error(`${label} exceeds the ${MAX_VFX_POINTS}-point ceiling`);
  for (const value of field.points) {
    if (!Number.isFinite(Number(value))) throw new Error(`${label} contains a non-finite point value`);
  }
  if (typeof field.sourceKind !== "string" || field.sourceKind.length === 0) throw new Error(`${label} requires sourceKind`);
  if (typeof field.sourceDigest !== "string" || field.sourceDigest.length === 0) throw new Error(`${label} requires sourceDigest`);
  return pointCount;
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export async function observeVisualEffectStateMorph(root, sourceField, targetField, options = {}) {
  const sourcePointCount = validateSampleField(sourceField, "morph source field");
  const targetPointCount = validateSampleField(targetField, "morph target field");
  const rootPath = resolve(root);
  const runtimePath = resolve(rootPath, "hand-lab/src/hand-runtime.mjs");
  const streamPath = resolve(rootPath, "hand-lab/src/holographic-state-stream.mjs");
  const [runtimeSource, streamSource] = await Promise.all([fileDigest(runtimePath), fileDigest(streamPath)]);

  const runtime = await import(`${pathToFileURL(runtimePath).href}?sha=${runtimeSource.sha256}`);
  const stream = await import(`${pathToFileURL(streamPath).href}?sha=${streamSource.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the expected Hand runtime");
  }
  if (
    !Array.isArray(stream.HOLOGRAPHIC_STATE_MORPH_HANDS) ||
    !stream.HOLOGRAPHIC_STATE_MORPH_GRAPH ||
    typeof stream.makeMorphState !== "function"
  ) {
    throw new Error("Visual Effect Fabric donor does not expose the holographic state-morph contract");
  }

  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(stream.HOLOGRAPHIC_STATE_MORPH_HANDS),
    graph: stream.HOLOGRAPHIC_STATE_MORPH_GRAPH,
    initialState: stream.makeMorphState(sourceField, targetField, options.seed ?? 20260916),
    context: { callerKind: "axm-creative-render" },
  });

  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("state-morph repeat verification failed");
  if (first.graph?.id !== "fx.holographic-state-morph") {
    throw new Error(`unexpected state-morph graph: ${String(first.graph?.id)}`);
  }

  const finalState = object(first.finalState, "state-morph final state");
  const morphField = object(finalState.morphField, "state-morph field");
  const realization = object(finalState.realizations?.holographicStateMorph, "state-morph realization");
  if (morphField.pairing !== "deterministic-spatial-order-v0.1") {
    throw new Error(`unexpected state-morph pairing policy: ${String(morphField.pairing)}`);
  }
  if (morphField.sourceDigest !== sourceField.sourceDigest || morphField.targetDigest !== targetField.sourceDigest) {
    throw new Error("state-morph field lost source or target identity");
  }
  if (realization.sourceDigest !== sourceField.sourceDigest || realization.targetDigest !== targetField.sourceDigest) {
    throw new Error("state-morph realization lost source or target identity");
  }
  if (realization.renderer !== "axm.vfx.holographic-state-morph/v0.1") {
    throw new Error(`unexpected state-morph renderer: ${String(realization.renderer)}`);
  }
  if (typeof realization.content !== "string" || !realization.content.includes("<canvas")) {
    throw new Error("state-morph realization did not produce HTML canvas content");
  }
  const morphPointCount = Number(morphField.count);
  if (!Number.isSafeInteger(morphPointCount) || morphPointCount < 1 || morphPointCount > MAX_VFX_POINTS) {
    throw new Error("state-morph produced an invalid point count");
  }
  if (realization.count !== morphPointCount) throw new Error("state-morph field/realization point-count continuity failed");

  const htmlBytes = Buffer.from(realization.content, "utf8");
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  return {
    htmlBytes,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-state-morph-observation/v1",
      donor: "axm-visual-effect-fabric",
      runtime_sha256: runtimeSource.sha256,
      stream_module_sha256: streamSource.sha256,
      graph_id: first.graph?.id ?? stream.HOLOGRAPHIC_STATE_MORPH_GRAPH.id,
      graph_version: first.graph?.version ?? stream.HOLOGRAPHIC_STATE_MORPH_GRAPH.version,
      graph_stage_count: stream.HOLOGRAPHIC_STATE_MORPH_GRAPH.stages.length,
      executed_stage_count: first.executedStageIds?.length ?? null,
      final_state_hash: first.finalStateHash,
      source: {
        id: String(sourceField.id ?? "source"),
        kind: sourceField.sourceKind,
        digest: sourceField.sourceDigest,
        point_count: sourcePointCount,
      },
      target: {
        id: String(targetField.id ?? "target"),
        kind: targetField.sourceKind,
        digest: targetField.sourceDigest,
        point_count: targetPointCount,
      },
      morph: {
        point_count: morphPointCount,
        source_id: morphField.sourceId,
        target_id: morphField.targetId,
        source_digest: morphField.sourceDigest,
        target_digest: morphField.targetDigest,
        pairing: morphField.pairing,
        source_resampled: sourcePointCount !== morphPointCount,
        target_resampled: targetPointCount !== morphPointCount,
      },
      renderer: realization.renderer,
      distinct_source_identity: sourceField.sourceDigest !== targetField.sourceDigest,
      repeat_verification: "PASS",
      html_sha256: sha256(htmlBytes),
      state_sha256: sha256(stateBytes),
      truth_boundary: {
        semantic_correspondence_proven: false,
        pairing_policy: "deterministic spatial ordering over derived sample points; this is geometric pairing evidence, not semantic vertex/body identity",
      },
    },
  };
}
