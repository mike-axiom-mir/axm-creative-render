import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectTransientImpulseCanvasRuntime } from "./vfx_transient_canvas_runtime_bridge.mjs";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function explicitImpulseSpec(options = {}) {
  return {
    id: options.id ?? "creative-render-shared-visual-physics-impulse",
    seed: options.seed ?? 20260916,
    origin: options.origin ?? [0.5, 0.5],
    direction: options.direction ?? [1, 0.28],
    energy: options.energy ?? 0.9,
    radius: options.radius ?? 0.28,
    duration: options.duration ?? 0.8,
    tint: options.tint ?? [0.18, 0.9, 1],
    accent: options.accent ?? [1, 0.52, 0.18],
    controls: options.controls ?? {
      symmetry: 0.2,
      directionality: 0.92,
      fragmentation: 0.62,
      ringWeight: 0.72,
      spokeWeight: 1.08,
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function jsonDigest(value) {
  return sha256(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
}

function requireStaticRealization(realization) {
  object(realization, "VFX transient static realization");
  if (realization.renderer !== "axm.vfx.transient-impulse-static-svg/v0.1") {
    throw new Error(`unexpected transient static renderer: ${String(realization.renderer)}`);
  }
  if (realization.mediaType !== "image/svg+xml" || typeof realization.content !== "string" || !realization.content.includes("<svg")) {
    throw new Error("transient motion-free realization must be inspectable SVG");
  }
  const lower = realization.content.toLowerCase();
  for (const forbidden of ["<animate", "<script", "requestanimationframe"]) {
    if (lower.includes(forbidden)) throw new Error(`motion-free realization unexpectedly contains ${forbidden}`);
  }
  const motion = object(realization.motion, "VFX transient static motion evidence");
  if (motion.mode !== "static" || motion.source !== "temporal-envelope-peak") {
    throw new Error("motion-free realization lost static envelope-peak policy");
  }
}

export function selectTransientImpulseMotionProfile(observed, preference) {
  object(observed, "transient motion-profile observation");
  const mode = String(preference);
  let selected;
  if (mode === "full-motion") selected = object(observed.canvas, "full-motion profile");
  else if (mode === "motion-free") selected = object(observed.static, "motion-free profile");
  else throw new Error("motion profile must be 'full-motion' or 'motion-free'");

  const result = {
    schema: "axm.creative-render.transient-motion-profile-selection/v1",
    preference: mode,
    renderer: selected.renderer,
    media_type: selected.media_type,
    canonical_event_hash: observed.canonical_event_hash,
    field_geometry_hash: observed.field_geometry_hash,
    envelope_sha256: observed.envelope_sha256,
    artifact_sha256: selected.artifact_sha256,
    authority: "DERIVED_REPLACEABLE_VISUAL_REALIZATION_SELECTION",
  };
  return Object.freeze(result);
}

export async function observeVisualEffectTransientImpulseMotionProfiles(root, options = {}) {
  const spec = explicitImpulseSpec(options);
  const canvas = await observeVisualEffectTransientImpulseCanvasRuntime(root, spec);
  const canvasState = object(JSON.parse(canvas.stateBytes.toString("utf8")), "Canvas transient final state");

  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    impulse: resolve(rootPath, "hand-lab/src/transient-impulse-hands.mjs"),
    static: resolve(rootPath, "hand-lab/src/transient-impulse-static.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)]),
  ));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const impulse = await import(`${pathToFileURL(paths.impulse).href}?sha=${sources.impulse.sha256}`);
  const staticModule = await import(`${pathToFileURL(paths.static).href}?sha=${sources.static.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("VFX Hand runtime unavailable for motion-profile proof");
  }
  if (typeof impulse.makeTransientImpulseState !== "function") {
    throw new Error("VFX transient impulse state factory unavailable for motion-profile proof");
  }
  if (!staticModule.TRANSIENT_IMPULSE_STATIC_GRAPH || !Array.isArray(staticModule.TRANSIENT_IMPULSE_STATIC_HANDS)) {
    throw new Error("VFX motion-free transient public graph unavailable");
  }

  const initialState = impulse.makeTransientImpulseState(spec);
  const executeStatic = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(staticModule.TRANSIENT_IMPULSE_STATIC_HANDS),
    graph: staticModule.TRANSIENT_IMPULSE_STATIC_GRAPH,
    initialState: structuredClone(initialState),
    context: { callerKind: "axm-creative-render" },
  });
  const first = executeStatic();
  const second = executeStatic();
  if (first.finalStateHash !== second.finalStateHash) {
    throw new Error("VFX motion-free transient graph did not repeat in the exercised runtime");
  }

  const staticState = object(first.finalState, "VFX motion-free transient final state");
  const staticRealization = object(staticState.realizations?.transientImpulseStaticSvg, "VFX motion-free transient SVG realization");
  requireStaticRealization(staticRealization);

  for (const [label, a, b] of [
    ["canonical event", canvasState.event, staticState.event],
    ["derived field", canvasState.impulseField, staticState.impulseField],
    ["temporal envelope", canvasState.impulseEnvelope, staticState.impulseEnvelope],
  ]) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`full-motion and motion-free branches diverged before realization at ${label}`);
    }
  }
  if (canvas.observation.canonical_event_hash !== staticState.eventCanonicalHash) {
    throw new Error("motion profiles lost canonical event identity");
  }
  if (canvas.observation.field.geometry_hash !== staticState.impulseField?.geometryHash) {
    throw new Error("motion profiles lost derived field identity");
  }
  if (staticRealization.canonicalEventHash !== staticState.eventCanonicalHash ||
      staticRealization.fieldGeometryHash !== staticState.impulseField.geometryHash) {
    throw new Error("motion-free realization lost event/field lineage");
  }

  const staticStateBytes = Buffer.from(`${JSON.stringify(staticState, null, 2)}\n`, "utf8");
  const staticSvgBytes = Buffer.from(staticRealization.content, "utf8");
  const envelopeSha256 = jsonDigest(staticState.impulseEnvelope);
  const observation = {
    schema: "axm.creative-render.vfx-transient-motion-profile-observation/v1",
    donor: "axm-visual-effect-fabric",
    donor_static_graph_id: staticModule.TRANSIENT_IMPULSE_STATIC_GRAPH.id,
    donor_static_graph_version: staticModule.TRANSIENT_IMPULSE_STATIC_GRAPH.version,
    module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
    canonical_event_hash: staticState.eventCanonicalHash,
    field_geometry_hash: staticState.impulseField.geometryHash,
    envelope_sha256: envelopeSha256,
    envelope_sample_count: staticState.impulseEnvelope.samples.length,
    pre_realization_state_parity: "PASS",
    canvas_runtime_repeat_verification: canvas.observation.runtime.repeat_verification,
    static_graph_repeat_verification: "PASS",
    canvas: {
      renderer: canvas.observation.realization.renderer,
      media_type: canvas.observation.realization.media_type,
      artifact_sha256: canvas.observation.realization.html_sha256,
      runtime_trace_sha256: canvas.observation.runtime.trace_sha256,
      generated_javascript_executed: canvas.observation.runtime.truth_boundary.generated_renderer_javascript_executed,
    },
    static: {
      renderer: staticRealization.renderer,
      media_type: staticRealization.mediaType,
      artifact_sha256: sha256(staticSvgBytes),
      motion: structuredClone(staticRealization.motion),
      contains_script: false,
      contains_svg_animation_element: false,
      contains_request_animation_frame: false,
    },
    truth_boundary: {
      canonical_event_mutated_by_profile_selection: false,
      derived_field_or_envelope_mutated_by_profile_selection: false,
      motion_profile_is_consumer_selectable_derived_realization: true,
      physics_or_gameplay_semantics_changed_by_profile: false,
      actual_browser_canvas_pixels_observed: false,
      static_svg_pixels_observed: false,
      visual_equivalence_proven: false,
      accessibility_acceptance_proven: false,
      visual_quality_proven: false,
    },
  };
  observation.full_motion_selection = selectTransientImpulseMotionProfile(observation, "full-motion");
  observation.motion_free_selection = selectTransientImpulseMotionProfile(observation, "motion-free");

  return {
    event: structuredClone(staticState.event),
    canvasStateBytes: canvas.stateBytes,
    canvasHtmlBytes: canvas.htmlBytes,
    canvasTraceBytes: canvas.traceBytes,
    staticStateBytes,
    staticSvgBytes,
    observation,
  };
}
