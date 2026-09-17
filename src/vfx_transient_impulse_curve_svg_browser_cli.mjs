#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  observeVisualEffectTransientImpulseCurveStaticSvg,
  parseTransientImpulseCurveSvgBrowserProbeDump,
  verifyTransientImpulseCurveSvgBrowserRasterEvidence,
} from "./vfx_transient_impulse_curve_svg_browser_bridge.mjs";

function parseArgs(argv) {
  const out = { command: argv[2] ?? "" };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

async function writeBound(path, bytes) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const written = await readFile(target);
  if (sha256(written) !== sha256(bytes)) throw new Error(`written bytes changed for ${path}`);
  return { path: target, sha256: sha256(written), bytes: written.length };
}

async function build(args) {
  for (const key of [
    "vfx-root", "vfx-revision", "impulse", "noop-curve", "shaped-curve", "base-state", "noop-state", "shaped-state",
    "base-svg", "noop-svg", "shaped-svg", "probe", "receipt",
  ]) if (!args[key]) throw new Error(`missing --${key}`);

  const observed = await observeVisualEffectTransientImpulseCurveStaticSvg(resolve(args["vfx-root"]), { vfxRevision: args["vfx-revision"] });
  const outputs = {
    impulse: await writeBound(args.impulse, observed.impulseBytes),
    noop_curve: await writeBound(args["noop-curve"], observed.noopCurveBytes),
    shaped_curve: await writeBound(args["shaped-curve"], observed.shapedCurveBytes),
    base_state: await writeBound(args["base-state"], observed.baseStateBytes),
    noop_state: await writeBound(args["noop-state"], observed.noopStateBytes),
    shaped_state: await writeBound(args["shaped-state"], observed.shapedStateBytes),
    base_svg: await writeBound(args["base-svg"], observed.baseSvg),
    noop_svg: await writeBound(args["noop-svg"], observed.noopSvg),
    shaped_svg: await writeBound(args["shaped-svg"], observed.shapedSvg),
    browser_probe_html: await writeBound(args.probe, observed.probeHtml),
  };
  const receipt = {
    contract: "AXM_CREATIVE_VFX_TRANSIENT_IMPULSE_CURVE_SVG_BROWSER_BUILD_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    outputs,
    comparison: {
      canonical_event_retained: observed.observation.canonical_event_hash.length > 0,
      base_field_retained: observed.observation.field_geometry_hash.length > 0,
      base_envelope_retained: observed.observation.base_envelope_hash.length > 0,
      constant_one_svg_byte_identity: outputs.base_svg.sha256 === outputs.noop_svg.sha256,
      shaped_svg_distinct: outputs.base_svg.sha256 !== outputs.shaped_svg.sha256,
      selected_envelope_lineage_retained: observed.observation.selected_envelopes.noop.length > 0 && observed.observation.selected_envelopes.shaped.length > 0,
      shaped_intensity_changes_derived_state: observed.observation.selected_envelopes.shaped_intensity_change_count > 0,
    },
    authority: {
      caller_impulse_and_curve_requests: "CALLER_SOURCE_AUTHORITY",
      canonical_event: "VFX_CANONICAL_EVENT_AUTHORITY",
      base_field_and_envelope: "DERIVED_REBUILDABLE_VFX_STATE",
      selected_curve_envelopes: "DERIVED_REBUILDABLE_VFX_STATE",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_pixels: "NOT_YET_OBSERVED",
    },
    truth_boundary: {
      proves: "the pinned current VFX curve-selected transient static-SVG graph preserves canonical event, base field/envelope and caller curve authority; a constant-one curve remains byte-identical to the ordinary static donor; a shaped curve changes only separately derived curve-envelope state before producing a distinct replaceable SVG; and a fixed local browser probe is bound to those exact SVG bytes",
      does_not_prove: "browser pixels until verify-browser executes, visual hierarchy or glow quality, timing feel, physical blast or fluid correctness, compositing quality, accessibility, realtime/device performance, GPU parity, cross-browser parity, or cross-machine bitwise determinism",
    },
  };
  const receiptOut = await writeBound(args.receipt, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
  console.log("vfx_transient_impulse_curve_svg_browser_build=PASS");
  console.log(`canonical_event_hash=${observed.observation.canonical_event_hash}`);
  console.log(`base_envelope_hash=${observed.observation.base_envelope_hash}`);
  console.log(`base_svg_sha256=${outputs.base_svg.sha256}`);
  console.log(`noop_svg_sha256=${outputs.noop_svg.sha256}`);
  console.log(`shaped_svg_sha256=${outputs.shaped_svg.sha256}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

async function verifyBrowser(args) {
  for (const key of ["dump", "probe", "build-receipt", "browser-version", "base-screenshot", "noop-screenshot", "shaped-screenshot", "out"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  const [dumpBytes, probeBytes, receiptBytes, browserVersionBytes, baseScreenshot, noopScreenshot, shapedScreenshot] = await Promise.all([
    readFile(resolve(args.dump)),
    readFile(resolve(args.probe)),
    readFile(resolve(args["build-receipt"])),
    readFile(resolve(args["browser-version"])),
    readFile(resolve(args["base-screenshot"])),
    readFile(resolve(args["noop-screenshot"])),
    readFile(resolve(args["shaped-screenshot"])),
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (receipt.contract !== "AXM_CREATIVE_VFX_TRANSIENT_IMPULSE_CURVE_SVG_BROWSER_BUILD_RECEIPT" || receipt.version !== 1) throw new Error("unexpected transient impulse curve SVG browser build receipt");
  if (sha256(probeBytes) !== receipt.outputs.browser_probe_html.sha256) throw new Error("browser probe HTML changed after build receipt");
  const raster = verifyTransientImpulseCurveSvgBrowserRasterEvidence(parseTransientImpulseCurveSvgBrowserProbeDump(dumpBytes), {
    baseSvgSha256: receipt.outputs.base_svg.sha256,
    noopSvgSha256: receipt.outputs.noop_svg.sha256,
    shapedSvgSha256: receipt.outputs.shaped_svg.sha256,
  });
  const pngSignature = "89504e470d0a1a0a";
  for (const [name, bytes] of [["base", baseScreenshot], ["noop", noopScreenshot], ["shaped", shapedScreenshot]]) {
    if (bytes.subarray(0, 8).toString("hex") !== pngSignature) throw new Error(`${name} browser screenshot is not a PNG artifact`);
  }
  const browserVersion = browserVersionBytes.toString("utf8").trim();
  if (!browserVersion) throw new Error("browser version evidence is empty");
  const vfx = receipt.visual_effect_fabric;
  const evidence = {
    contract: "AXM_CREATIVE_VFX_TRANSIENT_IMPULSE_CURVE_SVG_BROWSER_RASTER_EVIDENCE",
    version: 1,
    build_receipt_sha256: sha256(receiptBytes),
    donor_revision: vfx.donor_revision,
    canonical_event_hash: vfx.canonical_event_hash,
    field_geometry_hash: vfx.field_geometry_hash,
    base_envelope_hash: vfx.base_envelope_hash,
    curve_sources: vfx.curve_sources,
    selected_envelopes: vfx.selected_envelopes,
    svg_sha256: {
      base: receipt.outputs.base_svg.sha256,
      noop: receipt.outputs.noop_svg.sha256,
      shaped: receipt.outputs.shaped_svg.sha256,
    },
    probe_html_sha256: receipt.outputs.browser_probe_html.sha256,
    browser: { version: browserVersion, version_sha256: sha256(browserVersionBytes), mode: "headless-local-file", network_required: false },
    raster,
    screenshots: {
      base: { sha256: sha256(baseScreenshot), bytes: baseScreenshot.length, evidentiary_role: "retained_visual_artifact_not_aesthetic_acceptance_authority" },
      noop: { sha256: sha256(noopScreenshot), bytes: noopScreenshot.length, evidentiary_role: "retained_visual_artifact_not_aesthetic_acceptance_authority" },
      shaped: { sha256: sha256(shapedScreenshot), bytes: shapedScreenshot.length, evidentiary_role: "retained_visual_artifact_not_aesthetic_acceptance_authority" },
    },
    authority: {
      caller_impulse_and_curve_requests: "CALLER_SOURCE_AUTHORITY",
      canonical_event: "VFX_CANONICAL_EVENT_AUTHORITY",
      base_field_and_envelope: "DERIVED_REBUILDABLE_VFX_STATE",
      selected_curve_envelopes: "DERIVED_REBUILDABLE_VFX_STATE",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_rgba_and_screenshots: "DERIVED_BROWSER_OUTPUT",
    },
    truth_boundary: {
      proves: "an identified real headless browser decoded the exact hash-bound ordinary, constant-one-selected and shaped-curve-selected transient impulse SVG bytes from the pinned current VFX donor; the constant-one selected path remained an exact raw-pixel no-op while the shaped derived envelope produced a measurable raw-pixel difference without replacing canonical event or caller curve authority",
      does_not_prove: "that the shaped realization is visually better, timing feel or animation quality, physical blast/fluid correctness, compositing quality, accessibility, consumer acceptance, target-device/GPU parity, realtime performance, cross-browser parity, or cross-machine/browser-version bitwise determinism",
    },
  };
  const out = await writeBound(args.out, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"));
  console.log("vfx_transient_impulse_curve_svg_browser_raster=PASS");
  console.log(`browser=${browserVersion}`);
  console.log(`base_noop_different_pixels=${raster.base_noop.different_pixels}`);
  console.log(`base_shaped_different_pixels=${raster.base_shaped.different_pixels}`);
  console.log(`base_shaped_different_channels=${raster.base_shaped.different_channels}`);
  console.log(`base_shaped_sum_abs_channel_delta=${raster.base_shaped.sum_abs_channel_delta}`);
  console.log(`base_rgba_fnv1a32=${raster.rgba_fnv1a32.base}`);
  console.log(`shaped_rgba_fnv1a32=${raster.rgba_fnv1a32.shaped}`);
  console.log(`evidence_sha256=${out.sha256}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "build") return build(args);
  if (args.command === "verify-browser") return verifyBrowser(args);
  throw new Error("usage: vfx_transient_impulse_curve_svg_browser_cli.mjs build|verify-browser [options]");
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
