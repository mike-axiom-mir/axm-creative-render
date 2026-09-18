#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  observeVisualEffectDirectElectricFlickerSvg,
  parseDirectElectricFlickerSvgBrowserProbeDump,
  verifyDirectElectricFlickerSvgBrowserRasterEvidence,
} from "./vfx_direct_electric_flicker_svg_browser_bridge.mjs";

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
  for (const key of ["vfx-root", "phase-a-svg", "phase-b-svg", "zero-svg", "state", "probe", "receipt"]) if (!args[key]) throw new Error(`missing --${key}`);
  const observed = await observeVisualEffectDirectElectricFlickerSvg(resolve(args["vfx-root"]));
  const outputs = {
    phase_a_svg: await writeBound(args["phase-a-svg"], observed.phaseASvg),
    phase_b_svg: await writeBound(args["phase-b-svg"], observed.phaseBSvg),
    zero_strength_svg: await writeBound(args["zero-svg"], observed.zeroSvg),
    vfx_state: await writeBound(args.state, observed.stateBytes),
    browser_probe_html: await writeBound(args.probe, observed.probeHtml),
  };
  const receipt = {
    contract: "AXM_CREATIVE_VFX_DIRECT_ELECTRIC_FLICKER_SVG_BROWSER_BUILD_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    outputs,
    comparison: {
      phase_svg_bytes_differ: outputs.phase_a_svg.sha256 !== outputs.phase_b_svg.sha256,
      whole_cycle_svg_identity_replay: observed.observation.invariants.whole_cycle_selected_set_and_svg_identity_replay,
      zero_strength_path_no_op: observed.observation.invariants.zero_strength_exact_path_no_op,
      zero_strength_svg_byte_identical_to_ordinary_base_donor: observed.observation.invariants.zero_strength_svg_byte_identical_to_ordinary_base_donor,
      self_consistent_derived_tamper_rejected: observed.observation.invariants.self_consistent_derived_tamper_rejected_by_realization_hand,
      prior_direct_modulation_identities_preserved: observed.observation.invariants.prior_direct_modulation_identities_preserved,
    },
    authority: {
      electric_base_paths: "RETAINED_VFX_ELECTRIC_PATH_STATE",
      flicker_cycle_source: "RETAINED_VFX_FLICKER_CYCLE_SOURCE",
      electric_flicker_binding_source: "RETAINED_VFX_ELECTRIC_FLICKER_BINDING_SOURCE",
      modulated_path_sets: "DERIVED_REBUILDABLE_VFX_BODIES",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_pixels: "NOT_YET_OBSERVED",
    },
    truth_boundary: {
      proves: "the current donor-owned electric-flicker SVG realization rebuild-validates its selected derived path-energy state against retained electric, flicker and binding sources; preserves the already-proven direct modulation identities; closes exactly across one cycle; keeps zero-strength output byte-identical to the ordinary retained-base SVG donor; rejects self-consistent derived tamper; and emits exact hash-bound SVG artifacts for browser observation",
      does_not_prove: "browser pixels until verify-browser executes, continuous temporal animation, perceptual flicker quality, photosensitivity safety or viewing comfort, aesthetic quality, physical electricity or emitted light, target-device performance, GPU parity, or cross-browser/cross-machine bitwise determinism",
    },
  };
  const receiptOut = await writeBound(args.receipt, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
  console.log("vfx_direct_electric_flicker_svg_browser_build=PASS");
  console.log(`phase_a_svg_sha256=${outputs.phase_a_svg.sha256}`);
  console.log(`phase_b_svg_sha256=${outputs.phase_b_svg.sha256}`);
  console.log(`retained_electric_base_paths_hash=${observed.observation.retained.electric_base_paths_hash}`);
  console.log(`retained_flicker_cycle_source_hash=${observed.observation.retained.flicker_cycle_source_hash}`);
  console.log(`retained_modulation_source_hash=${observed.observation.retained.electric_flicker_modulation_source_hash}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

async function verifyBrowser(args) {
  for (const key of ["dump", "probe", "build-receipt", "browser-version", "phase-a-screenshot", "phase-b-screenshot", "out"]) if (!args[key]) throw new Error(`missing --${key}`);
  const [dumpBytes, probeBytes, receiptBytes, browserVersionBytes, phaseAScreenshot, phaseBScreenshot] = await Promise.all([
    readFile(resolve(args.dump)),
    readFile(resolve(args.probe)),
    readFile(resolve(args["build-receipt"])),
    readFile(resolve(args["browser-version"])),
    readFile(resolve(args["phase-a-screenshot"])),
    readFile(resolve(args["phase-b-screenshot"])),
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (receipt.contract !== "AXM_CREATIVE_VFX_DIRECT_ELECTRIC_FLICKER_SVG_BROWSER_BUILD_RECEIPT" || receipt.version !== 1) throw new Error("unexpected direct electric flicker SVG browser build receipt");
  if (sha256(probeBytes) !== receipt.outputs.browser_probe_html.sha256) throw new Error("direct electric flicker browser probe HTML changed after build receipt");
  const raster = verifyDirectElectricFlickerSvgBrowserRasterEvidence(parseDirectElectricFlickerSvgBrowserProbeDump(dumpBytes), {
    phaseASvgSha256: receipt.outputs.phase_a_svg.sha256,
    phaseBSvgSha256: receipt.outputs.phase_b_svg.sha256,
    requireDifference: true,
  });
  const pngSignature = "89504e470d0a1a0a";
  if (phaseAScreenshot.subarray(0, 8).toString("hex") !== pngSignature || phaseBScreenshot.subarray(0, 8).toString("hex") !== pngSignature) throw new Error("direct electric flicker browser screenshots are not PNG artifacts");
  const browserVersion = browserVersionBytes.toString("utf8").trim();
  if (!browserVersion) throw new Error("browser version evidence is empty");
  const evidence = {
    contract: "AXM_CREATIVE_VFX_DIRECT_ELECTRIC_FLICKER_SVG_BROWSER_RASTER_EVIDENCE",
    version: 1,
    build_receipt_sha256: sha256(receiptBytes),
    retained: receipt.visual_effect_fabric.retained,
    derived: receipt.visual_effect_fabric.derived,
    phase_a_svg_sha256: receipt.outputs.phase_a_svg.sha256,
    phase_b_svg_sha256: receipt.outputs.phase_b_svg.sha256,
    zero_strength_svg_sha256: receipt.outputs.zero_strength_svg.sha256,
    probe_html_sha256: receipt.outputs.browser_probe_html.sha256,
    browser: { version: browserVersion, version_sha256: sha256(browserVersionBytes), mode: "headless-local-file", network_required: false },
    raster,
    screenshots: {
      phase_a: { sha256: sha256(phaseAScreenshot), bytes: phaseAScreenshot.length, evidentiary_role: "retained_visual_artifact_not_pixel-comparison-authority" },
      phase_b: { sha256: sha256(phaseBScreenshot), bytes: phaseBScreenshot.length, evidentiary_role: "retained_visual_artifact_not_pixel-comparison-authority" },
    },
    authority: {
      electric_base_paths: "RETAINED_VFX_ELECTRIC_PATH_STATE",
      flicker_cycle_source: "RETAINED_VFX_FLICKER_CYCLE_SOURCE",
      electric_flicker_binding_source: "RETAINED_VFX_ELECTRIC_FLICKER_BINDING_SOURCE",
      modulated_path_sets: "DERIVED_REBUILDABLE_VFX_BODIES",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_rgba_and_screenshots: "DERIVED_BROWSER_OUTPUT",
    },
    truth_boundary: {
      proves: "an identified real headless browser decoded and rasterized the exact hash-bound donor-owned electric-flicker SVG artifacts for two explicit phases at a fixed 1000x600 RGBA8 observation size, and the legitimate donor-derived energy difference survived into measurable raw-browser pixel differences while retained electric, flicker and binding sources remained authoritative",
      does_not_prove: "continuous animation or frame pacing, perceptual flicker quality, photosensitivity safety or viewing comfort, aesthetic quality, physical electricity or emitted light, target-device performance, GPU parity, Firefox/WebKit equivalence, or cross-browser/cross-machine bitwise determinism",
    },
  };
  const out = await writeBound(args.out, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"));
  console.log("vfx_direct_electric_flicker_svg_browser_raster=PASS");
  console.log(`browser=${browserVersion}`);
  console.log(`different_pixels=${raster.different_pixels}`);
  console.log(`different_channels=${raster.different_channels}`);
  console.log(`sum_abs_channel_delta=${raster.sum_abs_channel_delta}`);
  console.log(`phase_a_rgba_fnv1a32=${raster.base_rgba_fnv1a32}`);
  console.log(`phase_b_rgba_fnv1a32=${raster.modulated_rgba_fnv1a32}`);
  console.log(`evidence_sha256=${out.sha256}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "build") return build(args);
  if (args.command === "verify-browser") return verifyBrowser(args);
  throw new Error("usage: vfx_direct_electric_flicker_svg_browser_cli.mjs build|verify-browser [options]");
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
