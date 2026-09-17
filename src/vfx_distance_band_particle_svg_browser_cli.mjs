#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  observeVisualEffectDistanceBandParticleStaticSvgBrowser,
  parseDistanceBandParticleSvgBrowserProbeDump,
  verifyDistanceBandParticleSvgBrowserRasterEvidence,
} from "./vfx_distance_band_particle_svg_browser_bridge.mjs";

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
  for (const key of ["vfx-root", "vfx-revision", "fbm-weighted-set", "cellular-weighted-set", "fbm-svg", "cellular-svg", "probe", "receipt"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  const observed = await observeVisualEffectDistanceBandParticleStaticSvgBrowser(resolve(args["vfx-root"]), { vfxRevision: args["vfx-revision"] });
  const outputs = {
    fbm_weighted_set: await writeBound(args["fbm-weighted-set"], observed.variants.fbm.weightSetBytes),
    cellular_weighted_set: await writeBound(args["cellular-weighted-set"], observed.variants.cellular.weightSetBytes),
    fbm_svg: await writeBound(args["fbm-svg"], observed.variants.fbm.svg),
    cellular_svg: await writeBound(args["cellular-svg"], observed.variants.cellular.svg),
    browser_probe_html: await writeBound(args.probe, observed.probeHtml),
  };
  const receipt = {
    contract: "AXM_CREATIVE_VFX_DISTANCE_BAND_PARTICLE_SVG_BROWSER_BUILD_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    outputs,
    comparison: {
      shared_caller_particle_source: observed.observation.comparison.particle_source_hash_identical,
      distinct_scalar_sources: observed.observation.comparison.source_hashes_differ,
      distinct_weighted_sets: observed.observation.comparison.weighted_set_hashes_differ,
      distinct_donor_svg_bytes: observed.observation.comparison.donor_svg_bytes_differ,
      both_svgs_bound_to_selected_weighted_sets:
        observed.observation.variants.fbm.derived_from_weighted_set_hash === observed.observation.variants.fbm.weighted_set_hash
        && observed.observation.variants.cellular.derived_from_weighted_set_hash === observed.observation.variants.cellular.weighted_set_hash,
    },
    authority: {
      retained_sources: "VFX_AND_CALLER_SOURCE_AUTHORITY",
      weighted_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_pixels: "NOT_YET_OBSERVED",
    },
    truth_boundary: {
      proves: "the pinned current VFX distance-band particle SVG graphs extend the already-proven neutral weighted-particle sets without changing retained source authority; sufficient budgets are non-creative, insufficient budgets fail closed, self-consistent derived tampering is rejected by source-truth rebuild, and exact donor SVG bytes are bound for a local browser observer",
      does_not_prove: "browser pixel output until verify-browser executes, aesthetic quality, useful particle/spark/mote meaning, physical behavior, animation quality, accessibility, production suitability, realtime/device performance, GPU parity, or cross-browser/cross-machine bitwise determinism",
    },
  };
  const receiptOut = await writeBound(args.receipt, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
  console.log("vfx_distance_band_particle_svg_browser_build=PASS");
  console.log(`fbm_weighted_set_hash=${observed.observation.variants.fbm.weighted_set_hash}`);
  console.log(`cellular_weighted_set_hash=${observed.observation.variants.cellular.weighted_set_hash}`);
  console.log(`fbm_svg_sha256=${outputs.fbm_svg.sha256}`);
  console.log(`cellular_svg_sha256=${outputs.cellular_svg.sha256}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

async function verifyBrowser(args) {
  for (const key of ["dump", "probe", "build-receipt", "browser-version", "fbm-screenshot", "cellular-screenshot", "out"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  const [dumpBytes, probeBytes, receiptBytes, browserVersionBytes, fbmScreenshot, cellularScreenshot] = await Promise.all([
    readFile(resolve(args.dump)),
    readFile(resolve(args.probe)),
    readFile(resolve(args["build-receipt"])),
    readFile(resolve(args["browser-version"])),
    readFile(resolve(args["fbm-screenshot"])),
    readFile(resolve(args["cellular-screenshot"])),
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (receipt.contract !== "AXM_CREATIVE_VFX_DISTANCE_BAND_PARTICLE_SVG_BROWSER_BUILD_RECEIPT" || receipt.version !== 1) throw new Error("unexpected distance-band particle SVG browser build receipt");
  if (sha256(probeBytes) !== receipt.outputs.browser_probe_html.sha256) throw new Error("browser probe HTML changed after build receipt");

  const raster = verifyDistanceBandParticleSvgBrowserRasterEvidence(parseDistanceBandParticleSvgBrowserProbeDump(dumpBytes), {
    fbmSvgSha256: receipt.outputs.fbm_svg.sha256,
    cellularSvgSha256: receipt.outputs.cellular_svg.sha256,
  });
  const pngSignature = "89504e470d0a1a0a";
  if (fbmScreenshot.subarray(0, 8).toString("hex") !== pngSignature || cellularScreenshot.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("browser screenshots are not PNG artifacts");
  }
  const browserVersion = browserVersionBytes.toString("utf8").trim();
  if (!browserVersion) throw new Error("browser version evidence is empty");
  const vfx = receipt.visual_effect_fabric;
  const evidence = {
    contract: "AXM_CREATIVE_VFX_DISTANCE_BAND_PARTICLE_SVG_BROWSER_RASTER_EVIDENCE",
    version: 1,
    build_receipt_sha256: sha256(receiptBytes),
    donor_revision: vfx.donor_revision,
    weighted_sets: {
      fbm: vfx.variants.fbm.weighted_set_hash,
      cellular: vfx.variants.cellular.weighted_set_hash,
    },
    svg_sha256: {
      fbm: receipt.outputs.fbm_svg.sha256,
      cellular: receipt.outputs.cellular_svg.sha256,
    },
    probe_html_sha256: receipt.outputs.browser_probe_html.sha256,
    browser: {
      version: browserVersion,
      version_sha256: sha256(browserVersionBytes),
      mode: "headless-local-file",
      network_required: false,
    },
    raster,
    screenshots: {
      fbm: { sha256: sha256(fbmScreenshot), bytes: fbmScreenshot.length, evidentiary_role: "retained_visual_artifact_not_aesthetic_acceptance_authority" },
      cellular: { sha256: sha256(cellularScreenshot), bytes: cellularScreenshot.length, evidentiary_role: "retained_visual_artifact_not_aesthetic_acceptance_authority" },
    },
    authority: {
      retained_sources: "VFX_AND_CALLER_SOURCE_AUTHORITY",
      weighted_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_rgba_and_screenshots: "DERIVED_BROWSER_OUTPUT",
    },
    truth_boundary: {
      proves: "a named real headless browser decoded and rasterized the exact hash-bound fBm-backed and cellular-backed donor SVG artifacts at fixed 640x420 RGBA8, and their legitimate source-derived neutral particle-weight difference remained measurably observable without changing retained caller/VFX source authority",
      does_not_prove: "that either source family or particle realization is aesthetically better, physically meaningful, semantically correct for sparks/motes/opacity/size/emission, animated well, accessible, production-ready, realtime on target devices, GPU-equivalent, or cross-browser/cross-machine bitwise deterministic",
    },
  };
  const out = await writeBound(args.out, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"));
  console.log("vfx_distance_band_particle_svg_browser_raster=PASS");
  console.log(`browser=${browserVersion}`);
  console.log(`different_pixels=${raster.different_pixels}`);
  console.log(`different_channels=${raster.different_channels}`);
  console.log(`sum_abs_channel_delta=${raster.sum_abs_channel_delta}`);
  console.log(`fbm_rgba_fnv1a32=${raster.fbm_rgba_fnv1a32}`);
  console.log(`cellular_rgba_fnv1a32=${raster.cellular_rgba_fnv1a32}`);
  console.log(`evidence_sha256=${out.sha256}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "build") return build(args);
  if (args.command === "verify-browser") return verifyBrowser(args);
  throw new Error("usage: vfx_distance_band_particle_svg_browser_cli.mjs build|verify-browser [options]");
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
