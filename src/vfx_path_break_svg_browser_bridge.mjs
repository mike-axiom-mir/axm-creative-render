import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectPathBreakFragmentation } from "./vfx_path_break_fragmentation_bridge.mjs";

const WIDTH = 640;
const HEIGHT = 420;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integer(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer within [${min},${max}]`);
  return number;
}

function revision(value, label) {
  const next = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(next)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return next;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function dataUri(bytes) {
  return `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
}

function selectedPathSet(state, label) {
  const source = object(state.pathBreakSource, `${label} path-break source`);
  const selected = object(state.brokenPathSets?.[source.id], `${label} broken path set`);
  if (selected.schema !== "axm.broken-path-set/v0.1" || selected.derived !== true || selected.rebuildable !== true) {
    throw new Error(`${label} broken path set lost derived/rebuildable boundary`);
  }
  return selected;
}

function svgBytes(realization, label) {
  const row = object(realization, label);
  if (row.mediaType !== "image/svg+xml") throw new Error(`${label} media type must be image/svg+xml`);
  if (row.renderer !== "axm.vfx.path-break-static-svg/v0.1") throw new Error(`${label} renderer drifted`);
  if (row.width !== WIDTH || row.height !== HEIGHT) throw new Error(`${label} dimensions drifted`);
  if (row.showBase !== false) throw new Error(`${label} must not claim a same-topology canonical base underlay`);
  const content = text(row.content, `${label}.content`);
  if (!content.includes("<svg") || !content.includes('data-layer="derived-paths"')) throw new Error(`${label} is missing derived fragment markup`);
  if (content.includes('data-layer="base-paths"')) throw new Error(`${label} serialized a forbidden canonical base underlay`);
  return Buffer.from(content, "utf8");
}

function verifyRealizationLineage(state, selected, realization, label) {
  if (realization.derivedFromPathSetHash !== selected.pathSetHash) throw new Error(`${label} SVG lost selected path-set identity`);
  if (realization.pathSourceHash !== state.pathSourceHash) throw new Error(`${label} SVG lost canonical path lineage`);
  if (realization.breakSourceHash !== state.pathBreakSourceHash) throw new Error(`${label} SVG lost retained break-treatment lineage`);
  if (realization.sourcePathCount !== selected.sourcePathCount || realization.sourcePointCount !== selected.sourcePointCount) {
    throw new Error(`${label} SVG retained source cardinality drifted`);
  }
  if (realization.fragmentCount !== selected.fragmentCount || realization.pointCount !== selected.pointCount) {
    throw new Error(`${label} SVG fragment cardinality drifted from selected path set`);
  }
}

export function makePathBreakSvgBrowserProbeHtml({ zeroSvg, activeSvg }) {
  const zero = Buffer.from(zeroSvg);
  const active = Buffer.from(activeSvg);
  const zeroHash = sha256(zero);
  const activeHash = sha256(active);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM path-break SVG browser raster probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const ZERO_URI=${JSON.stringify(dataUri(zero))},ACTIVE_URI=${JSON.stringify(dataUri(active))};
const ZERO_SVG_SHA256=${JSON.stringify(zeroHash)},ACTIVE_SVG_SHA256=${JSON.stringify(activeHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
async function main(){const [zero,active]=await Promise.all([raster(ZERO_URI),raster(ACTIVE_URI)]);let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<zero.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(zero[i+c]-active[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}const result={schema:'axm.creative-render.path-break-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:zero.length,zero_svg_sha256:ZERO_SVG_SHA256,active_svg_sha256:ACTIVE_SVG_SHA256,zero_rgba_fnv1a32:fnv1a32(zero),active_rgba_fnv1a32:fnv1a32(active),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.path-break-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parsePathBreakSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyPathBreakSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.path-break-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  if (integer(evidence.width, 1, 4096, "browser raster width") !== WIDTH || integer(evidence.height, 1, 4096, "browser raster height") !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "RGBA byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  text(evidence.zero_svg_sha256, "zero SVG sha256");
  text(evidence.active_svg_sha256, "active SVG sha256");
  text(evidence.zero_rgba_fnv1a32, "zero RGBA checksum");
  text(evidence.active_rgba_fnv1a32, "active RGBA checksum");
  const differentPixels = integer(evidence.different_pixels, 0, WIDTH * HEIGHT, "different pixel count");
  const differentChannels = integer(evidence.different_channels, 0, WIDTH * HEIGHT * 4, "different channel count");
  const sum = integer(evidence.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, "absolute channel delta sum");
  const max = integer(evidence.max_channel_delta, 0, 255, "maximum channel delta");
  if (expected.zeroSvgSha256 && evidence.zero_svg_sha256 !== expected.zeroSvgSha256) throw new Error("browser evidence zero SVG identity mismatch");
  if (expected.activeSvgSha256 && evidence.active_svg_sha256 !== expected.activeSvgSha256) throw new Error("browser evidence active SVG identity mismatch");
  if (differentPixels < 1 || differentChannels < 1 || sum < 1 || max < 1) throw new Error("browser raster did not observe active path-break difference");
  if (evidence.zero_rgba_fnv1a32 === evidence.active_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge");
  return structuredClone(evidence);
}

export async function observeVisualEffectPathBreakStaticSvg(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const fragmentation = await observeVisualEffectPathBreakFragmentation(rootPath, { vfxRevision });
  const zeroState = object(JSON.parse(fragmentation.zeroStateBytes.toString("utf8")), "zero path-break state");
  const activeState = object(JSON.parse(fragmentation.activeStateBytes.toString("utf8")), "active path-break state");
  const zeroSet = selectedPathSet(zeroState, "zero");
  const activeSet = selectedPathSet(activeState, "active");

  const modulePath = resolve(rootPath, "hand-lab/src/path-break-static-svg.mjs");
  const corePath = resolve(rootPath, "hand-lab/src/path-static-svg-core.mjs");
  const [moduleBytes, coreBytes] = await Promise.all([readFile(modulePath), readFile(corePath)]);
  const donor = await import(`${pathToFileURL(modulePath).href}?sha=${sha256(moduleBytes)}`);
  const core = await import(`${pathToFileURL(corePath).href}?sha=${sha256(coreBytes)}`);
  if (!donor.pathBreakStaticSvgHand || !donor.PATH_BREAK_STATIC_SVG_GRAPH || !Array.isArray(donor.PATH_BREAK_STATIC_SVG_HANDS)) throw new Error("VFX donor path-break static SVG capability is unavailable");
  if (donor.PATH_BREAK_STATIC_SVG_GRAPH.id !== "fx.path.break-fragment-static-svg" || donor.PATH_BREAK_STATIC_SVG_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX path-break static SVG graph identity");
  const expectedHands = ["fx.path.break-fragment-source-normalize", "fx.path.break-fragment-build", "fx.path.break-static-svg-realize"];
  if (JSON.stringify(donor.PATH_BREAK_STATIC_SVG_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) throw new Error("unexpected VFX path-break static SVG Hand boundary");
  if (donor.pathBreakStaticSvgHand.id !== "fx.path.break-static-svg-realize" || donor.pathBreakStaticSvgHand.version !== "0.1.0") throw new Error("unexpected VFX path-break SVG realization Hand identity");
  if (typeof core.hashDerivedPathSetPayload !== "function") throw new Error("VFX shared path SVG core hash helper is unavailable");

  const params = { width: WIDTH, height: HEIGHT, padding: 20, strokeWidth: 2, opacity: 0.92, showBase: false, maxPoints: 18 };
  const zeroResult = donor.pathBreakStaticSvgHand.execute(zeroState, params);
  const activeResult = donor.pathBreakStaticSvgHand.execute(activeState, params);
  const zeroRealization = object(zeroResult.state?.realizations?.pathBreakStaticSvg, "zero path-break SVG realization");
  const activeRealization = object(activeResult.state?.realizations?.pathBreakStaticSvg, "active path-break SVG realization");
  verifyRealizationLineage(zeroState, zeroSet, zeroRealization, "zero");
  verifyRealizationLineage(activeState, activeSet, activeRealization, "active");
  if (zeroState.pathSourceHash !== activeState.pathSourceHash) throw new Error("retained caller path identity changed across zero/active break challenge");
  if (zeroState.pathBreakSourceHash === activeState.pathBreakSourceHash || zeroSet.pathSetHash === activeSet.pathSetHash) throw new Error("explicit path-break treatment did not change derived identities");
  if (zeroSet.fragmentCount !== 2 || zeroSet.pointCount !== 10 || zeroSet.removedNormalizedLengthPerPath !== 0) throw new Error("zero path-break fixture drifted");
  if (activeSet.fragmentCount !== 6 || activeSet.pointCount !== 18 || activeSet.removedNormalizedLengthPerPath !== 0.16) throw new Error("active path-break fixture drifted");

  const zeroSvg = svgBytes(zeroRealization, "zero path-break SVG realization");
  const activeSvg = svgBytes(activeRealization, "active path-break SVG realization");
  if (sha256(zeroSvg) === sha256(activeSvg)) throw new Error("active path break produced byte-identical donor SVG realization");

  const roomyResult = donor.pathBreakStaticSvgHand.execute(activeState, { ...params, maxPoints: 4096 });
  const roomyRealization = object(roomyResult.state?.realizations?.pathBreakStaticSvg, "roomy-budget path-break SVG realization");
  verifyRealizationLineage(activeState, activeSet, roomyRealization, "roomy budget");
  const roomySvg = svgBytes(roomyRealization, "roomy-budget path-break SVG realization");
  if (sha256(roomySvg) !== sha256(activeSvg)) throw new Error("sufficient SVG point budget became a hidden creative control");

  let insufficientPointError = "";
  try { donor.pathBreakStaticSvgHand.execute(activeState, { ...params, maxPoints: 17 }); }
  catch (error) { insufficientPointError = String(error?.message || error); }
  if (!/pathBreakSvg point budget exceeded: 18 > 17/.test(insufficientPointError)) {
    throw new Error(`insufficient path-break SVG point budget did not fail closed: ${insufficientPointError}`);
  }

  const alternateResult = donor.pathBreakStaticSvgHand.execute(activeState, { ...params, strokeWidth: 4, opacity: 0.68 });
  const alternateRealization = object(alternateResult.state?.realizations?.pathBreakStaticSvg, "alternate presentation path-break SVG realization");
  verifyRealizationLineage(activeState, activeSet, alternateRealization, "alternate presentation");
  const alternateSvg = svgBytes(alternateRealization, "alternate presentation path-break SVG realization");
  if (sha256(alternateSvg) === sha256(activeSvg)) throw new Error("renderer-only presentation controls did not alter disposable SVG bytes");

  let forbiddenBaseError = "";
  try { donor.pathBreakStaticSvgHand.execute(activeState, { ...params, showBase: true }); }
  catch (error) { forbiddenBaseError = String(error?.message || error); }
  if (!/showBase must remain false/.test(forbiddenBaseError)) {
    throw new Error(`fragmented topology incorrectly accepted a canonical base underlay: ${forbiddenBaseError}`);
  }

  const tamperedState = structuredClone(activeState);
  const tamperedSet = tamperedState.brokenPathSets[tamperedState.pathBreakSource.id];
  const point = tamperedSet.paths[0].points[1];
  point.y = Math.min(0.999, Math.max(0.001, point.y + 0.002));
  tamperedSet.pathSetHash = core.hashDerivedPathSetPayload(tamperedSet);
  let derivedTamperError = "";
  try { donor.pathBreakStaticSvgHand.execute(tamperedState, params); }
  catch (error) { derivedTamperError = String(error?.message || error); }
  if (!/selected path set does not match retained sources/.test(derivedTamperError)) {
    throw new Error(`self-consistent derived path-break tamper was not rejected: ${derivedTamperError}`);
  }

  const fragmentationReceiptBytes = stableBytes(fragmentation.receipt);
  const probeHtml = makePathBreakSvgBrowserProbeHtml({ zeroSvg, activeSvg });
  return {
    sourcePathsBytes: fragmentation.sourcePathsBytes,
    fragmentationReceiptBytes,
    zeroStateBytes: fragmentation.zeroStateBytes,
    activeStateBytes: fragmentation.activeStateBytes,
    zeroSvg,
    activeSvg,
    alternateSvg,
    probeHtml,
    observation: {
      schema: "axm.creative-render.vfx-path-break-svg-browser-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_revision: vfxRevision,
      fragmentation_graph_id: fragmentation.receipt.donor.graph_id,
      fragmentation_graph_version: fragmentation.receipt.donor.graph_version,
      static_graph_id: donor.PATH_BREAK_STATIC_SVG_GRAPH.id,
      static_graph_version: donor.PATH_BREAK_STATIC_SVG_GRAPH.version,
      static_hand_id: donor.pathBreakStaticSvgHand.id,
      static_hand_version: donor.pathBreakStaticSvgHand.version,
      static_module_sha256: sha256(moduleBytes),
      shared_static_core_sha256: sha256(coreBytes),
      caller_neutral_repeat_verification: fragmentation.receipt.zero_break.caller_neutral_repeat_verification === "PASS" && fragmentation.receipt.active_break.caller_neutral_repeat_verification === "PASS" ? "PASS" : "FAIL",
      retained_sources: { path_source_hash: zeroState.pathSourceHash },
      zero: {
        break_count: zeroState.pathBreakSource.breakCount,
        gap_width: zeroState.pathBreakSource.gapWidth,
        break_source_hash: zeroState.pathBreakSourceHash,
        path_set_hash: zeroSet.pathSetHash,
        source_path_count: zeroSet.sourcePathCount,
        source_point_count: zeroSet.sourcePointCount,
        fragment_count: zeroSet.fragmentCount,
        point_count: zeroSet.pointCount,
        removed_normalized_length_per_path: zeroSet.removedNormalizedLengthPerPath,
        svg_sha256: sha256(zeroSvg),
        svg_bytes: zeroSvg.length,
        derived_from_path_set_hash: zeroRealization.derivedFromPathSetHash,
      },
      active: {
        break_count: activeState.pathBreakSource.breakCount,
        gap_width: activeState.pathBreakSource.gapWidth,
        phase: activeState.pathBreakSource.phase,
        break_source_hash: activeState.pathBreakSourceHash,
        path_set_hash: activeSet.pathSetHash,
        source_path_count: activeSet.sourcePathCount,
        source_point_count: activeSet.sourcePointCount,
        fragment_count: activeSet.fragmentCount,
        point_count: activeSet.pointCount,
        removed_normalized_length_per_path: activeSet.removedNormalizedLengthPerPath,
        svg_sha256: sha256(activeSvg),
        svg_bytes: activeSvg.length,
        derived_from_path_set_hash: activeRealization.derivedFromPathSetHash,
      },
      svg_point_budget_challenge: {
        exact_max_points: 18,
        roomy_max_points: 4096,
        sufficient_budget_identity_preserved: sha256(roomySvg) === sha256(activeSvg),
        insufficient_max_points: 17,
        insufficient_rejected: true,
        error: insufficientPointError,
        retained_source_mutated: false,
      },
      presentation_challenge: {
        same_path_set_hash: alternateRealization.derivedFromPathSetHash === activeSet.pathSetHash,
        alternate_svg_sha256: sha256(alternateSvg),
        svg_bytes_changed: sha256(alternateSvg) !== sha256(activeSvg),
        retained_source_mutated: false,
        derived_path_set_mutated: false,
      },
      forbidden_base_underlay_challenge: {
        requested_show_base: true,
        rejected: true,
        error: forbiddenBaseError,
        reason: "fragmented topology intentionally cannot be presented as a one-to-one canonical base underlay",
      },
      derived_tamper_challenge: {
        recomputed_self_consistent_hash: true,
        rejected: true,
        error: derivedTamperError,
        retained_source_mutated: false,
      },
      browser_probe: { width: WIDTH, height: HEIGHT, pixel_format: "RGBA8", network_required: false, html_sha256: sha256(probeHtml) },
      authority: {
        caller_paths: "CALLER_CANONICAL_PATH_SOURCE",
        break_treatment: "RETAINED_VFX_PATH_BREAK_SOURCE",
        broken_path_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
        svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
        browser_pixels: "NOT_OBSERVED_BY_THIS_FUNCTION",
      },
      truth_boundary: {
        browser_pixels_proven: false,
        aesthetic_quality_proven: false,
        fracture_semantics_proven: false,
        physical_fracture_proven: false,
        animation_quality_proven: false,
        consumer_acceptance_proven: false,
      },
    },
  };
}
