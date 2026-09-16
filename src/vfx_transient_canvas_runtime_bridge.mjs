import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function integer(value, label, min, max, fallback) {
  const number = Math.round(value == null ? fallback : finite(value, label));
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return number;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function inlineScript(html) {
  const matches = [...String(html).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  if (matches.length !== 1) throw new Error("Canvas2D artifact must contain exactly one inline script");
  return matches[0][1];
}

function defaultFrameTimes(durationSeconds) {
  const durationMs = finite(durationSeconds, "Canvas2D one-shot duration") * 1000;
  if (durationMs < 80 || durationMs > 5000) throw new Error("Canvas2D one-shot duration must stay in 80..5000ms");
  return [0, durationMs * 0.5, durationMs * 1.25].map((value) => Number(value.toFixed(6)));
}

function validateFrameTimes(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    throw new Error("Canvas2D runtime proof requires 2..8 explicit frame times");
  }
  const times = value.map((entry, index) => finite(entry, `frameTimes[${index}]`));
  for (let index = 0; index < times.length; index += 1) {
    if (times[index] < 0) throw new Error("Canvas2D frame times must be non-negative");
    if (index > 0 && times[index] <= times[index - 1]) throw new Error("Canvas2D frame times must increase strictly");
  }
  return times;
}

function runInlineCanvasScript(script, frameTimes, maxCalls) {
  const calls = [];
  const record = (name, ...args) => {
    if (calls.length >= maxCalls) throw new Error(`Canvas2D runtime trace exceeded ${maxCalls} calls`);
    calls.push([name, ...cloneJson(args)]);
  };

  const contextTarget = {
    fillRect(...args) { record("fillRect", ...args); },
    save(...args) { record("save", ...args); },
    restore(...args) { record("restore", ...args); },
    translate(...args) { record("translate", ...args); },
    rotate(...args) { record("rotate", ...args); },
    beginPath(...args) { record("beginPath", ...args); },
    ellipse(...args) { record("ellipse", ...args); },
    stroke(...args) { record("stroke", ...args); },
    moveTo(...args) { record("moveTo", ...args); },
    lineTo(...args) { record("lineTo", ...args); },
    arc(...args) { record("arc", ...args); },
    fill(...args) { record("fill", ...args); },
  };
  const context = new Proxy(contextTarget, {
    set(target, property, value) {
      record(`set:${String(property)}`, value);
      target[property] = value;
      return true;
    },
  });
  const canvas = {
    getContext(kind, options) {
      record("getContext", kind, options ?? null);
      if (kind !== "2d") throw new Error(`unexpected Canvas context request: ${String(kind)}`);
      return context;
    },
  };

  let frameIndex = 0;
  const sandbox = {
    document: {
      querySelector(selector) {
        record("querySelector", selector);
        if (selector !== "#c") throw new Error(`unexpected Canvas selector: ${String(selector)}`);
        return canvas;
      },
    },
    performance: { now: () => 0 },
    requestAnimationFrame(callback) {
      if (typeof callback !== "function") throw new Error("requestAnimationFrame callback must be a function");
      if (frameIndex >= frameTimes.length) {
        throw new Error("generated Canvas2D renderer scheduled beyond bounded proof frames");
      }
      const timestamp = frameTimes[frameIndex];
      frameIndex += 1;
      record("requestAnimationFrame", timestamp);
      callback(timestamp);
      return frameIndex;
    },
  };

  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  return { calls, frameCount: frameIndex };
}

function summarizeCalls(calls) {
  const counts = {};
  for (const row of calls) counts[row[0]] = (counts[row[0]] ?? 0) + 1;
  return counts;
}

export function executeTransientImpulseCanvasRuntime(realization, options = {}) {
  object(realization, "VFX transient Canvas2D realization");
  if (realization.renderer !== "axm.vfx.transient-impulse-canvas2d/v0.1") {
    throw new Error(`unexpected transient Canvas2D renderer: ${String(realization.renderer)}`);
  }
  if (typeof realization.content !== "string" || !realization.content.includes("<canvas")) {
    throw new Error("transient Canvas2D realization must contain inspectable HTML canvas content");
  }
  if (typeof realization.canonicalEventHash !== "string" || !realization.canonicalEventHash) {
    throw new Error("transient Canvas2D realization requires canonical event identity");
  }
  if (typeof realization.fieldGeometryHash !== "string" || !realization.fieldGeometryHash) {
    throw new Error("transient Canvas2D realization requires field geometry identity");
  }
  const workingSet = object(realization.workingSet, "VFX Canvas2D working set");
  if (workingSet.canonicalEventRetained !== true || workingSet.derivedFieldRebuildable !== true || workingSet.rendererStateDisposable !== true) {
    throw new Error("VFX Canvas2D working-set authority boundary drifted");
  }

  const script = inlineScript(realization.content);
  const frameTimes = validateFrameTimes(options.frameTimes ?? defaultFrameTimes(realization.oneShotDuration));
  const maxCalls = integer(options.maxCalls, "Canvas2D runtime max calls", 100, 20_000, 8_000);
  const first = runInlineCanvasScript(script, frameTimes, maxCalls);
  const second = runInlineCanvasScript(script, frameTimes, maxCalls);
  const firstBytes = Buffer.from(`${JSON.stringify(first.calls)}\n`, "utf8");
  const secondBytes = Buffer.from(`${JSON.stringify(second.calls)}\n`, "utf8");
  if (sha256(firstBytes) !== sha256(secondBytes) || first.frameCount !== second.frameCount) {
    throw new Error("generated Canvas2D runtime trace did not repeat in the exercised JS runtime");
  }
  if (first.frameCount !== frameTimes.length) {
    throw new Error(`generated Canvas2D renderer consumed ${first.frameCount} of ${frameTimes.length} proof frames`);
  }

  const callCounts = summarizeCalls(first.calls);
  for (const required of ["querySelector", "getContext", "fillRect", "ellipse", "lineTo", "arc", "fill"]) {
    if (!callCounts[required]) throw new Error(`generated Canvas2D renderer did not exercise required interface call: ${required}`);
  }

  const trace = {
    schema: "axm.creative-render.vfx-transient-canvas2d-runtime-trace/v1",
    renderer: realization.renderer,
    canonical_event_hash: realization.canonicalEventHash,
    field_geometry_hash: realization.fieldGeometryHash,
    derived_from_state_hash: realization.derivedFromStateHash ?? null,
    frame_times_ms: frameTimes,
    frame_count: first.frameCount,
    call_count: first.calls.length,
    call_counts: callCounts,
    calls: first.calls,
  };
  const traceBytes = Buffer.from(`${JSON.stringify(trace, null, 2)}\n`, "utf8");
  return {
    traceBytes,
    observation: {
      schema: "axm.creative-render.vfx-transient-canvas2d-runtime-observation/v1",
      renderer: realization.renderer,
      canonical_event_hash: realization.canonicalEventHash,
      field_geometry_hash: realization.fieldGeometryHash,
      derived_from_state_hash: realization.derivedFromStateHash ?? null,
      frame_times_ms: frameTimes,
      frame_count: first.frameCount,
      call_count: first.calls.length,
      call_counts: callCounts,
      trace_sha256: sha256(traceBytes),
      repeat_verification: "PASS",
      execution_boundary: "generated donor Canvas2D inline JavaScript executed in a bounded Node vm with a recording Canvas2D interface harness",
      truth_boundary: {
        generated_renderer_javascript_executed: true,
        actual_browser_canvas_pixels_observed: false,
        browser_gpu_equivalence_proven: false,
        canvas_api_trace_is_derived_replaceable_evidence: true,
        canonical_event_mutated_by_runtime: false,
      },
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export async function observeVisualEffectTransientImpulseCanvasRuntime(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    impulse: resolve(rootPath, "hand-lab/src/transient-impulse-hands.mjs"),
    canvas: resolve(rootPath, "hand-lab/src/transient-impulse-canvas.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)]),
  ));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const impulse = await import(`${pathToFileURL(paths.impulse).href}?sha=${sources.impulse.sha256}`);
  const canvas = await import(`${pathToFileURL(paths.canvas).href}?sha=${sources.canvas.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("VFX Hand runtime unavailable for transient Canvas2D proof");
  }
  if (typeof impulse.makeTransientImpulseState !== "function" || !canvas.TRANSIENT_IMPULSE_CANVAS_GRAPH || !Array.isArray(canvas.TRANSIENT_IMPULSE_CANVAS_HANDS)) {
    throw new Error("VFX transient Canvas2D public graph unavailable");
  }

  const initialState = impulse.makeTransientImpulseState({
    id: options.id ?? "creative-render-canvas-runtime-impulse",
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
  });
  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(canvas.TRANSIENT_IMPULSE_CANVAS_HANDS),
    graph: canvas.TRANSIENT_IMPULSE_CANVAS_GRAPH,
    initialState: structuredClone(initialState),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("VFX transient Canvas2D graph repeat verification failed");

  const finalState = object(first.finalState, "VFX transient Canvas2D final state");
  const event = object(finalState.event, "VFX transient Canvas2D canonical event");
  const field = object(finalState.impulseField, "VFX transient Canvas2D derived field");
  const envelope = object(finalState.impulseEnvelope, "VFX transient Canvas2D derived envelope");
  const realization = object(finalState.realizations?.transientImpulseCanvas2d, "VFX transient Canvas2D realization");
  if (event.schema !== "axm.transient-impulse-event/v0.1" || event.kind !== "transient-impulse") {
    throw new Error("VFX transient Canvas2D canonical event contract drifted");
  }
  if (field.schema !== "axm.transient-impulse-field/v0.1" || field.derived !== true || field.rebuildable !== true) {
    throw new Error("VFX transient Canvas2D field must remain derived and rebuildable");
  }
  if (envelope.schema !== "axm.transient-envelope/v0.1" || envelope.derived !== true) {
    throw new Error("VFX transient Canvas2D envelope must remain derived");
  }
  if (field.canonicalEventHash !== finalState.eventCanonicalHash || envelope.fieldGeometryHash !== field.geometryHash) {
    throw new Error("VFX transient Canvas2D state lineage drifted");
  }
  if (realization.canonicalEventHash !== finalState.eventCanonicalHash || realization.fieldGeometryHash !== field.geometryHash) {
    throw new Error("VFX transient Canvas2D realization lost event/field identity");
  }

  const runtimeEvidence = executeTransientImpulseCanvasRuntime(realization, options.runtime ?? {});
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  const htmlBytes = Buffer.from(realization.content, "utf8");
  return {
    event: structuredClone(event),
    stateBytes,
    htmlBytes,
    traceBytes: runtimeEvidence.traceBytes,
    observation: {
      schema: "axm.creative-render.vfx-transient-canvas2d-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_id: canvas.TRANSIENT_IMPULSE_CANVAS_GRAPH.id,
      donor_graph_version: canvas.TRANSIENT_IMPULSE_CANVAS_GRAPH.version,
      donor_hand_ids: canvas.TRANSIENT_IMPULSE_CANVAS_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: first.finalStateHash,
      canonical_event_hash: finalState.eventCanonicalHash,
      event: structuredClone(event),
      field: {
        schema: field.schema,
        geometry_hash: field.geometryHash,
        counts: structuredClone(field.counts),
        derived: field.derived,
        rebuildable: field.rebuildable,
      },
      envelope: {
        schema: envelope.schema,
        duration: envelope.duration,
        sample_count: Array.isArray(envelope.samples) ? envelope.samples.length : null,
        derived: envelope.derived,
      },
      realization: {
        renderer: realization.renderer,
        media_type: realization.mediaType,
        one_shot_duration: realization.oneShotDuration,
        html_sha256: sha256(htmlBytes),
        working_set: structuredClone(realization.workingSet),
      },
      runtime: runtimeEvidence.observation,
      graph_repeat_verification: "PASS",
      state_sha256: sha256(stateBytes),
      truth_boundary: {
        canonical_event_is_source_for_visual_branch: true,
        field_envelope_html_and_runtime_trace_are_derived_replaceable_bodies: true,
        generated_canvas_renderer_javascript_executed: true,
        actual_browser_pixels_proven: false,
        visual_quality_proven: false,
        gameplay_or_physics_semantics_owned_by_vfx: false,
      },
    },
  };
}
