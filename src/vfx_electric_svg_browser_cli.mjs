#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  observeVisualEffectElectricModulatedSvg,
  parseElectricSvgBrowserProbeDump,
  verifyElectricSvgBrowserRasterEvidence,
} from "./vfx_electric_svg_browser_bridge.mjs";

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
  for (const key of ["vfx-root", "base-svg", "modulated-svg", "state", "probe", "receipt"]) if (!args[key]) throw new Error(`missing --${key}`);
  const observed = await observeVisualEffectElectricModulatedSvg(resolve(args["vfx-root"]));
  const outputs = {
    base_svg: await writeBound(args["base-svg"], observed.baseSvg),
    modulated_svg: await writeBound(args["modulated-svg"], observed.modulatedSvg),
    vfx_state: await writeBound(args.state, observed.stateBytes),
    browser_probe_html: await writeBound(args.probe, observed.probeHtml),
  };
  const receipt = {
    contract: "AXM_CREATIVE_VFX_ELECTRIC_SVG_BROWSER_BUILD_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    outputs,
    comparison: {
      base_and_modulated_svg_differ: outputs.base_svg.sha256 !== outputs.modulated_svg.sha256,
      zero_strength_svg_is_byte_identical: observed.observation.zero_strength_equivalence.byte_identical,
      same_retained_base_paths_hash: observed.observation.base_svg.derived_from_paths_hash === observed.observation.retained_base_paths_hash,
      modulated_svg_bound_to_selected_path_set: observed.observation.modulated_svg.derived_from_selected_path_set_hash === observed.observation.selected_modulated_path_set_hash,
      modulation_contract_preserved_before_render_selection: observed.observation.modulation_contract_preserved_before_render_selection,
    },
    authority: {
      base_electric_paths: "RETAINED_VFX_ELECTRIC_PATH_STATE",
      scalar_field_sources: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
      composition_source: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
      modulation_source: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE",
      modulated_path_set: "DERIVED_REBUILDABLE_VFX_BODY",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_pixels: "NOT_YET_OBSERVED",
    },
    truth_boundary: {
      proves: "the current VFX modulated-electric SVG graph preserves the already-proven modulation identities, leaves retained base paths authoritative, reuses the existing SVG donor through a disposable selection view, and produces separately bound ordinary and modulated SVG artifacts plus a fixed browser raster probe",
      does_not_prove: "browser pixel output until verify-browser executes, aesthetic or readability improvement, physical electricity, lighting correctness, gameplay/world meaning, realtime/device performance, GPU parity, or cross-machine bitwise determinism",
    },
  };
  const receiptOut = await writeBound(args.receipt, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
  console.log("vfx_electric_svg_browser_build=PASS");
  console.log(`base_paths_hash=${observed.observation.retained_base_paths_hash}`);
  console.log(`modulated_path_set_hash=${observed.observation.selected_modulated_path_set_hash}`);
  console.log(`base_svg_sha256=${outputs.base_svg.sha256}`);
  console.log(`modulated_svg_sha256=${outputs.modulated_svg.sha256}`);
  console.log(`probe_html_sha256=${outputs.browser_probe_html.sha256}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

async function verifyBrowser(args) {
  for (const key of ["dump", "probe", "build-receipt", "browser-version", "base-screenshot", "modulated-screenshot", "out"]) if (!args[key]) throw new Error(`missing --${key}`);
  const [dumpBytes, probeBytes, receiptBytes, browserVersionBytes, baseScreenshot, modulatedScreenshot] = await Promise.all([
    readFile(resolve(args.dump)),
    readFile(resolve(args.probe)),
    readFile(resolve(args["build-receipt"])),
    readFile(resolve(args["browser-version"])),
    readFile(resolve(args["base-screenshot"])),
    readFile(resolve(args["modulated-screenshot"])),
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (receipt.contract !== "AXM_CREATIVE_VFX_ELECTRIC_SVG_BROWSER_BUILD_RECEIPT" || receipt.version !== 1) throw new Error("unexpected electric SVG browser build receipt");
  if (sha256(probeBytes) !== receipt.outputs.browser_probe_html.sha256) throw new Error("browser probe HTML changed after build receipt");
  const raster = verifyElectricSvgBrowserRasterEvidence(parseElectricSvgBrowserProbeDump(dumpBytes), {
    baseSvgSha256: receipt.outputs.base_svg.sha256,
    modulatedSvgSha256: receipt.outputs.modulated_svg.sha256,
    requireDifference: true,
  });
  const pngSignature = "89504e470d0a1a0a";
  if (baseScreenshot.subarray(0, 8).toString("hex") !== pngSignature || modulatedScreenshot.subarray(0, 8).toString("hex") !== pngSignature) throw new Error("browser screenshots are not PNG artifacts");
  const browserVersion = browserVersionBytes.toString("utf8").trim();
  if (!browserVersion) throw new Error("browser version evidence is empty");
  const evidence = {
    contract: "AXM_CREATIVE_VFX_ELECTRIC_SVG_BROWSER_RASTER_EVIDENCE",
    version: 1,
    build_receipt_sha256: sha256(receiptBytes),
    retained_base_paths_hash: receipt.visual_effect_fabric.retained_base_paths_hash,
    selected_modulated_path_set_hash: receipt.visual_effect_fabric.selected_modulated_path_set_hash,
    composition_source_hash: receipt.visual_effect_fabric.field_composition_source_hash,
    modulation_source_hash: receipt.visual_effect_fabric.electric_modulation_source_hash,
    base_svg_sha256: receipt.outputs.base_svg.sha256,
    modulated_svg_sha256: receipt.outputs.modulated_svg.sha256,
    probe_html_sha256: receipt.outputs.browser_probe_html.sha256,
    browser: { version: browserVersion, version_sha256: sha256(browserVersionBytes), mode: "headless-local-file", network_required: false },
    raster,
    screenshots: {
      base: { sha256: sha256(baseScreenshot), bytes: baseScreenshot.length, evidentiary_role: "retained_visual_artifact_not_pixel-comparison-authority" },
      modulated: { sha256: sha256(modulatedScreenshot), bytes: modulatedScreenshot.length, evidentiary_role: "retained_visual_artifact_not_pixel-comparison-authority" },
    },
    authority: {
      base_electric_paths: "RETAINED_VFX_ELECTRIC_PATH_STATE",
      scalar_field_sources: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
      composition_source: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
      modulation_source: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE",
      modulated_path_set: "DERIVED_REBUILDABLE_VFX_BODY",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_rgba_and_screenshots: "DERIVED_BROWSER_OUTPUT",
    },
    truth_boundary: {
      proves: "a real headless browser decoded and rasterized the exact hash-bound ordinary and field-modulated SVG donor artifacts at a fixed 1000x600 RGBA8 observation size, and the non-zero derived modulation produced a measurable raw-pixel difference while retained base path state and source lineage stayed authoritative",
      does_not_prove: "that the modulation is aesthetically better or more readable, physical electricity or lighting correctness, gameplay/world meaning, target-device/GPU parity, realtime performance, accessibility suitability, or cross-browser/cross-machine bitwise determinism",
    },
  };
  const out = await writeBound(args.out, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"));
  console.log("vfx_electric_svg_browser_raster=PASS");
  console.log(`browser=${browserVersion}`);
  console.log(`different_pixels=${raster.different_pixels}`);
  console.log(`different_channels=${raster.different_channels}`);
  console.log(`sum_abs_channel_delta=${raster.sum_abs_channel_delta}`);
  console.log(`base_rgba_fnv1a32=${raster.base_rgba_fnv1a32}`);
  console.log(`modulated_rgba_fnv1a32=${raster.modulated_rgba_fnv1a32}`);
  console.log(`evidence_sha256=${out.sha256}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "build") return build(args);
  if (args.command === "verify-browser") return verifyBrowser(args);
  throw new Error("usage: vfx_electric_svg_browser_cli.mjs build|verify-browser [options]");
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
