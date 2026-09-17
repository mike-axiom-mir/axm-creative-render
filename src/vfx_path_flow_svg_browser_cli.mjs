#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  observeVisualEffectPathFlowStaticSvg,
  parsePathFlowSvgBrowserProbeDump,
  verifyPathFlowSvgBrowserRasterEvidence,
} from "./vfx_path_flow_svg_browser_bridge.mjs";

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
  for (const key of ["vfx-root", "vfx-revision", "source-paths", "displacement-receipt", "zero-state", "active-state", "zero-svg", "active-svg", "probe", "receipt"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  const observed = await observeVisualEffectPathFlowStaticSvg(resolve(args["vfx-root"]), { vfxRevision: args["vfx-revision"] });
  const outputs = {
    source_paths: await writeBound(args["source-paths"], observed.sourcePathsBytes),
    displacement_receipt: await writeBound(args["displacement-receipt"], observed.displacementReceiptBytes),
    zero_state: await writeBound(args["zero-state"], observed.zeroStateBytes),
    active_state: await writeBound(args["active-state"], observed.activeStateBytes),
    zero_svg: await writeBound(args["zero-svg"], observed.zeroSvg),
    active_svg: await writeBound(args["active-svg"], observed.activeSvg),
    browser_probe_html: await writeBound(args.probe, observed.probeHtml),
  };
  const vfx = observed.observation;
  const receipt = {
    contract: "AXM_CREATIVE_VFX_PATH_FLOW_SVG_BROWSER_BUILD_RECEIPT",
    version: 1,
    visual_effect_fabric: vfx,
    outputs,
    comparison: {
      retained_path_source_identical: Boolean(vfx.retained_sources.path_source_hash),
      retained_scalar_source_identical: Boolean(vfx.retained_sources.scalar_source_hash),
      retained_flow_source_identical: Boolean(vfx.retained_sources.flow_source_hash),
      zero_is_exact_noop: vfx.zero.amplitude === 0 && vfx.zero.max_displacement === 0,
      active_displaces_paths: vfx.active.amplitude > 0 && vfx.active.max_displacement > 0,
      derived_path_set_changes: vfx.zero.path_set_hash !== vfx.active.path_set_hash,
      donor_svg_changes: outputs.zero_svg.sha256 !== outputs.active_svg.sha256,
      both_svgs_bound_to_selected_derived_sets: vfx.zero.derived_from_path_set_hash === vfx.zero.path_set_hash && vfx.active.derived_from_path_set_hash === vfx.active.path_set_hash,
    },
    authority: {
      caller_paths: "CALLER_CANONICAL_PATH_SOURCE",
      vfx_sources: "RETAINED_VFX_SCALAR_VECTOR_AND_DISPLACEMENT_SOURCES",
      path_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_pixels: "NOT_YET_OBSERVED",
    },
    truth_boundary: {
      proves: "the pinned current VFX path-flow displacement proof can feed its separately retained derived path sets into the donor's real lineage-rechecking static-SVG realization Hand without replacing caller path or field authority, while exact zero and active SVG bytes are bound for a local browser observer",
      does_not_prove: "browser pixel output until verify-browser executes, aesthetic quality or readability, physical flow correctness, semantic meaning, animation quality, consumer acceptance, realtime/device performance, GPU parity, or cross-browser/cross-machine bitwise determinism",
    },
  };
  const receiptOut = await writeBound(args.receipt, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
  console.log("vfx_path_flow_svg_browser_build=PASS");
  console.log(`path_source_hash=${vfx.retained_sources.path_source_hash}`);
  console.log(`zero_path_set_hash=${vfx.zero.path_set_hash}`);
  console.log(`active_path_set_hash=${vfx.active.path_set_hash}`);
  console.log(`zero_svg_sha256=${outputs.zero_svg.sha256}`);
  console.log(`active_svg_sha256=${outputs.active_svg.sha256}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

async function verifyBrowser(args) {
  for (const key of ["dump", "probe", "build-receipt", "browser-version", "zero-screenshot", "active-screenshot", "out"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  const [dumpBytes, probeBytes, receiptBytes, browserVersionBytes, zeroScreenshot, activeScreenshot] = await Promise.all([
    readFile(resolve(args.dump)), readFile(resolve(args.probe)), readFile(resolve(args["build-receipt"])), readFile(resolve(args["browser-version"])), readFile(resolve(args["zero-screenshot"])), readFile(resolve(args["active-screenshot"])),
  ]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (receipt.contract !== "AXM_CREATIVE_VFX_PATH_FLOW_SVG_BROWSER_BUILD_RECEIPT" || receipt.version !== 1) throw new Error("unexpected path-flow SVG browser build receipt");
  if (sha256(probeBytes) !== receipt.outputs.browser_probe_html.sha256) throw new Error("browser probe HTML changed after build receipt");
  const raster = verifyPathFlowSvgBrowserRasterEvidence(parsePathFlowSvgBrowserProbeDump(dumpBytes), {
    zeroSvgSha256: receipt.outputs.zero_svg.sha256,
    activeSvgSha256: receipt.outputs.active_svg.sha256,
  });
  const pngSignature = "89504e470d0a1a0a";
  if (zeroScreenshot.subarray(0, 8).toString("hex") !== pngSignature || activeScreenshot.subarray(0, 8).toString("hex") !== pngSignature) throw new Error("browser screenshots are not PNG artifacts");
  const browserVersion = browserVersionBytes.toString("utf8").trim();
  if (!browserVersion) throw new Error("browser version evidence is empty");
  const vfx = receipt.visual_effect_fabric;
  const evidence = {
    contract: "AXM_CREATIVE_VFX_PATH_FLOW_SVG_BROWSER_RASTER_EVIDENCE",
    version: 1,
    build_receipt_sha256: sha256(receiptBytes),
    donor_revision: vfx.donor_revision,
    retained_sources: vfx.retained_sources,
    zero_path_set_hash: vfx.zero.path_set_hash,
    active_path_set_hash: vfx.active.path_set_hash,
    zero_svg_sha256: receipt.outputs.zero_svg.sha256,
    active_svg_sha256: receipt.outputs.active_svg.sha256,
    probe_html_sha256: receipt.outputs.browser_probe_html.sha256,
    browser: { version: browserVersion, version_sha256: sha256(browserVersionBytes), mode: "headless-local-file", network_required: false },
    raster,
    screenshots: {
      zero: { sha256: sha256(zeroScreenshot), bytes: zeroScreenshot.length, evidentiary_role: "retained_visual_artifact_not_aesthetic-acceptance-authority" },
      active: { sha256: sha256(activeScreenshot), bytes: activeScreenshot.length, evidentiary_role: "retained_visual_artifact_not_aesthetic-acceptance-authority" },
    },
    authority: {
      caller_paths: "CALLER_CANONICAL_PATH_SOURCE",
      vfx_sources: "RETAINED_VFX_SCALAR_VECTOR_AND_DISPLACEMENT_SOURCES",
      path_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
      svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
      browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      browser_rgba_and_screenshots: "DERIVED_BROWSER_OUTPUT",
    },
    truth_boundary: {
      proves: "a named real headless browser decoded and rasterized the exact hash-bound zero-amplitude and active-amplitude path-flow SVG artifacts from the pinned current VFX donor at fixed 640x420 RGBA8, and the explicit derived path displacement produced a measurable raw-pixel difference without replacing caller path or retained field source authority",
      does_not_prove: "that active path flow is aesthetically better or more readable, electrical/crack/root/river/trail or other consumer semantics, physical flow correctness, temporal animation quality, target-device/GPU parity, realtime performance, accessibility suitability, or cross-browser/cross-machine bitwise determinism",
    },
  };
  const out = await writeBound(args.out, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"));
  console.log("vfx_path_flow_svg_browser_raster=PASS");
  console.log(`browser=${browserVersion}`);
  console.log(`different_pixels=${raster.different_pixels}`);
  console.log(`different_channels=${raster.different_channels}`);
  console.log(`sum_abs_channel_delta=${raster.sum_abs_channel_delta}`);
  console.log(`zero_rgba_fnv1a32=${raster.zero_rgba_fnv1a32}`);
  console.log(`active_rgba_fnv1a32=${raster.active_rgba_fnv1a32}`);
  console.log(`evidence_sha256=${out.sha256}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "build") return build(args);
  if (args.command === "verify-browser") return verifyBrowser(args);
  throw new Error("usage: vfx_path_flow_svg_browser_cli.mjs build|verify-browser [options]");
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
