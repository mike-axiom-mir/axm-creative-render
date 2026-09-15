import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function validateSampleField(field) {
  object(field, "direct sample field");
  if (!Array.isArray(field.points) || field.points.length === 0 || field.points.length % 7 !== 0) {
    throw new Error("direct sample shell requires a non-empty packed stride-7 field");
  }
  const pointCount = field.points.length / 7;
  if (pointCount > 24_000) throw new Error("direct sample shell exceeds VFX 24,000-point ceiling");
  if (!field.sourceKind || !field.sourceDigest) throw new Error("direct sample shell requires explicit source identity");
  return pointCount;
}

export async function observeVisualEffectDirectSampleShell(root, sampleField, options = {}) {
  const pointCount = validateSampleField(sampleField);
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    stream: resolve(rootPath, "hand-lab/src/holographic-state-stream.mjs"),
    projector: resolve(rootPath, "hand-lab/src/holographic-state-projector.mjs"),
    readable: resolve(rootPath, "hand-lab/src/holographic-state-readable.mjs"),
    shell: resolve(rootPath, "hand-lab/src/holographic-state-shell.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const modules = {};
  for (const [name, path] of Object.entries(paths)) {
    modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);
  }

  const { runtime, stream, projector, readable, shell } = modules;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  const hands = [
    stream.admitSampleFieldHand,
    projector.creativeFieldHand,
    readable.visibilityFitHand,
    shell.shellProjectionStateHand,
    shell.shellStateProjectorHand,
  ];
  if (hands.some((hand) => !hand?.id || typeof hand.execute !== "function")) {
    throw new Error("VFX donor does not expose the required direct-sample shell Hands");
  }
  if (typeof stream.makeDirectSampleState !== "function") throw new Error("VFX donor direct-sample state constructor is unavailable");

  const graph = {
    schema: "axm.hand-graph/v0.1",
    id: "axm.creative-render.direct-sample-shell",
    version: "0.1.0",
    stages: [
      { id: "admit-samples", hand: stream.admitSampleFieldHand.id, params: {} },
      { id: "creative-field", hand: projector.creativeFieldHand.id, params: {} },
      { id: "visibility-fit", hand: readable.visibilityFitHand.id, params: { targetFill: 1.32, pointBoost: 1.8, exposure: 1.45 } },
      {
        id: "shell-projection-state",
        hand: shell.shellProjectionStateHand.id,
        params: {
          floatAmplitude: 0.012,
          yawAmplitude: 0.038,
          breakup: 0.055,
          shellOpacity: 0.19,
          glowOpacity: 0.13,
          sparkleOpacity: 0.24,
          depthTransmission: 0.32,
        },
      },
      { id: "realize-shell", hand: shell.shellStateProjectorHand.id, params: {} },
    ],
  };

  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(hands),
    graph,
    initialState: stream.makeDirectSampleState(sampleField, options.seed ?? 20260915),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("direct-sample shell state repeat verification failed");

  const finalState = object(first.finalState, "direct-sample shell final state");
  const realization = object(finalState.realizations?.holographicStateShell, "direct-sample shell realization");
  const visualLanguage = object(realization.visualLanguage, "direct-sample shell visual language");
  const visibility = object(finalState.visibility, "direct-sample shell visibility state");
  const projection = object(finalState.projection, "direct-sample shell projection state");
  if (realization.renderer !== "axm.vfx.holographic-state-shell/v0.4") {
    throw new Error(`unexpected shell renderer: ${String(realization.renderer)}`);
  }
  if (typeof realization.content !== "string" || !realization.content.includes("<canvas")) {
    throw new Error("direct-sample shell did not produce HTML canvas content");
  }
  if (finalState.form?.sourceKind !== sampleField.sourceKind || finalState.form?.sourceDigest !== sampleField.sourceDigest) {
    throw new Error("direct-sample shell lost caller source identity");
  }
  if (finalState.sampleField?.pointCount !== pointCount || realization.pointCount !== pointCount) {
    throw new Error("direct-sample shell point-count continuity failed");
  }
  if (finalState.sampleField?.canonicalFormHash !== sampleField.sourceDigest || realization.canonicalFormHash !== sampleField.sourceDigest) {
    throw new Error("direct-sample shell canonical source hash drifted");
  }
  if (
    visualLanguage.primary !== "translucent-shell" ||
    visualLanguage.secondary !== "volumetric-glow" ||
    visualLanguage.tertiary !== "sparse-signal-noise" ||
    visualLanguage.brightSweep !== false
  ) {
    throw new Error("direct-sample shell visual-language contract drifted");
  }
  if (visibility.mobileLegibility !== true || visibility.twoPassGlow !== true) {
    throw new Error("direct-sample shell visibility-fit evidence drifted");
  }

  const htmlBytes = Buffer.from(realization.content, "utf8");
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  return {
    htmlBytes,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-direct-sample-shell-observation/v1",
      donor: "axm-visual-effect-fabric",
      graph_owner: "axm-creative-render-caller-composition",
      graph_id: graph.id,
      graph_version: graph.version,
      donor_hand_ids: hands.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      executed_stage_count: first.executedStageIds?.length ?? null,
      final_state_hash: first.finalStateHash,
      source_kind: finalState.form?.sourceKind ?? null,
      source_digest: finalState.form?.sourceDigest ?? null,
      point_count: pointCount,
      sample_field_schema: finalState.sampleField?.schema ?? null,
      sample_field_hash: realization.sampleFieldHash ?? null,
      canonical_source_hash: realization.canonicalFormHash ?? null,
      renderer: realization.renderer,
      visibility: {
        fit_scale: visibility.fitScale,
        point_boost: visibility.pointBoost,
        exposure: visibility.exposure,
        mobile_legibility: visibility.mobileLegibility,
        two_pass_glow: visibility.twoPassGlow,
      },
      projection,
      visual_language: visualLanguage,
      source_identity_retained: true,
      sample_field_remains_explicit: true,
      repeat_verification: "PASS",
      html_sha256: sha256(htmlBytes),
      state_sha256: sha256(stateBytes),
      truth_boundary: {
        donor_graph_reused: false,
        donor_hands_reused: true,
        reason: "VFX's stock shell graph begins from primitive/form sampling; Creative Render explicitly composes the donor's sample-admission, visibility, shell-state and shell-render Hands around an already admitted caller sample field.",
      },
    },
  };
}
