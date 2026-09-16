#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeVisualEffectTransientImpulseMotionProfiles } from "./vfx_transient_motion_profile_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function parseArgs(argv) {
  if (argv[0] !== "build") throw new Error("only the 'build' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["vfx-root", "canvas-state", "canvas-html", "canvas-trace", "static-state", "static-svg", "evidence"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const vfxRoot = resolve(args["vfx-root"]);
  const outputs = {
    canvasState: resolve(args["canvas-state"]),
    canvasHtml: resolve(args["canvas-html"]),
    canvasTrace: resolve(args["canvas-trace"]),
    staticState: resolve(args["static-state"]),
    staticSvg: resolve(args["static-svg"]),
    evidence: resolve(args.evidence),
  };
  const outputPaths = Object.values(outputs);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("motion-profile outputs must be distinct");
  for (const path of outputPaths) {
    if (pathIsInside(vfxRoot, path)) throw new Error("motion-profile outputs may not be written inside the VFX donor repository");
  }

  const result = await observeVisualEffectTransientImpulseMotionProfiles(vfxRoot, {
    id: "creative-render-shared-visual-physics-impulse",
    seed: 20260916,
    origin: [0.5, 0.5],
    direction: [1, 0.28],
    energy: 0.9,
    radius: 0.28,
    duration: 0.8,
    tint: [0.18, 0.9, 1],
    accent: [1, 0.52, 0.18],
    controls: {
      symmetry: 0.2,
      directionality: 0.92,
      fragmentation: 0.62,
      ringWeight: 0.72,
      spokeWeight: 1.08,
    },
  });

  await write(outputs.canvasState, result.canvasStateBytes);
  await write(outputs.canvasHtml, result.canvasHtmlBytes);
  await write(outputs.canvasTrace, result.canvasTraceBytes);
  await write(outputs.staticState, result.staticStateBytes);
  await write(outputs.staticSvg, result.staticSvgBytes);

  const evidence = {
    contract: "AXM_CREATIVE_VFX_TRANSIENT_MOTION_PROFILE_EVIDENCE",
    version: 1,
    observation: result.observation,
    outputs: {
      canvas_state: { media_type: "application/json", sha256: sha256(result.canvasStateBytes), bytes: result.canvasStateBytes.length },
      canvas_html: { media_type: "text/html", sha256: sha256(result.canvasHtmlBytes), bytes: result.canvasHtmlBytes.length },
      canvas_trace: { media_type: "application/json", sha256: sha256(result.canvasTraceBytes), bytes: result.canvasTraceBytes.length },
      static_state: { media_type: "application/json", sha256: sha256(result.staticStateBytes), bytes: result.staticStateBytes.length },
      static_svg: { media_type: "image/svg+xml", sha256: sha256(result.staticSvgBytes), bytes: result.staticSvgBytes.length },
    },
    authority: {
      transient_event: "VFX_CANONICAL_EFFECT_INPUT",
      field_and_envelope: "DERIVED_REBUILDABLE_VFX_STATE",
      full_motion_canvas: "DERIVED_REPLACEABLE_VISUAL_REALIZATION",
      motion_free_svg: "DERIVED_REPLACEABLE_VISUAL_REALIZATION",
      profile_selection: "CALLER_OWNED_REALIZATION_CHOICE",
    },
    truth_boundary: {
      proves: [
        "the current VFX donor can derive full-motion Canvas2D and motion-free static SVG realizations from the exact same canonical event, derived field, and temporal envelope",
        "the generated Canvas2D JavaScript executes repeatably in the bounded recording runtime while the static SVG contains no script, SVG animate element, or requestAnimationFrame loop",
        "choosing full-motion or motion-free changes only the selected derived realization identity and does not rewrite canonical event, field, or envelope state",
      ],
      does_not_prove: [
        "actual browser Canvas pixels or browser/GPU equivalence",
        "static SVG pixel output on a target renderer",
        "pixel or aesthetic equivalence between the two realization profiles",
        "accessibility acceptance or user preference suitability",
        "visual quality, target-device performance, or gameplay meaning",
        "physics semantics or live-world authority for either visual profile",
      ],
    },
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await write(outputs.evidence, evidenceBytes);

  console.log("vfx_transient_motion_profiles=PASS");
  console.log(`event_hash=${result.observation.canonical_event_hash}`);
  console.log(`field_hash=${result.observation.field_geometry_hash}`);
  console.log(`envelope_sha256=${result.observation.envelope_sha256}`);
  console.log(`canvas_trace_sha256=${result.observation.canvas.runtime_trace_sha256}`);
  console.log(`static_svg_sha256=${result.observation.static.artifact_sha256}`);
  console.log(`evidence_sha256=${sha256(evidenceBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
