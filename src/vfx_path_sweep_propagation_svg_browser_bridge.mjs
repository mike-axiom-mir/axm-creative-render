import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectPathSweepPropagationNative } from "./vfx_path_sweep_propagation_native_bridge.mjs";

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

function dataUri(bytes) {
  return `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
}

function weightHashPayload(set) {
  return {
    schema: set.schema,
    sweepSourceHash: set.sweepSourceHash,
    pathSourceHash: set.pathSourceHash,
    frameSetHash: set.frameSetHash,
    ribbonSetHash: set.ribbonSetHash,
    indexedStripSetHash: set.indexedStripSetHash,
    propagationSourceHash: set.propagationSourceHash,
    phase: set.phase,
    pathCount: set.pathCount,
    pointCount: set.pointCount,
    vertexCount: set.vertexCount,
    minWeight: set.minWeight,
    maxWeight: set.maxWeight,
    semantics: set.semantics,
    paths: set.paths,
    provenance: set.provenance,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

function realizationBytes(realization, set, stripSet, label) {
  const row = object(realization, `${label} sweep propagation SVG realization`);
  if (row.schema !== "axm.vfx.path-sweep-propagation-static-svg/v0.1" || row.renderer !== "axm.vfx.path-sweep-propagation-static-svg/v0.1") {
    throw new Error(`${label} SVG renderer/schema drifted`);
  }
  if (row.mediaType !== "image/svg+xml" || row.derived !== true || row.replaceable !== true) throw new Error(`${label} SVG replaceable-derived boundary drifted`);
  if (
    row.pathSourceHash !== set.pathSourceHash
    || row.sweepSourceHash !== set.sweepSourceHash
    || row.frameSetHash !== set.frameSetHash
    || row.ribbonSetHash !== set.ribbonSetHash
    || row.indexedStripSetHash !== set.indexedStripSetHash
    || row.propagationSourceHash !== set.propagationSourceHash
    || row.weightSetHash !== set.weightSetHash
  ) throw new Error(`${label} SVG lost verified sweep/propagation lineage`);
  if (row.indexedStripSetHash !== stripSet.indexedStripSetHash || row.phase !== set.phase) throw new Error(`${label} SVG selected the wrong verified derived body`);
  if (row.renderControls?.width !== WIDTH || row.renderControls?.height !== HEIGHT) throw new Error(`${label} SVG dimensions drifted`);
  if (
    row.rendererMapping?.geometryInput !== "verified-indexed-strip-triangle-list"
    || row.rendererMapping?.weightInput !== "verified-neutral-propagation-vertex-scalar"
    || row.rendererMapping?.materialAuthority !== "none"
    || row.rendererMapping?.consumerAuthority !== "none"
    || row.rendererMapping?.canonicalAuthority !== "none"
  ) throw new Error(`${label} SVG renderer-local authority boundary drifted`);
  const content = text(row.content, `${label} SVG content`);
  if (!content.includes("<svg") || !content.includes("<polygon ")) throw new Error(`${label} SVG is missing expected donor markup`);
  return Buffer.from(content, "utf8");
}

export function makePathSweepPropagationSvgBrowserProbeHtml({ phaseASvg, phaseBSvg }) {
  const phaseA = Buffer.from(phaseASvg);
  const phaseB = Buffer.from(phaseBSvg);
  const phaseAHash = sha256(phaseA);
  const phaseBHash = sha256(phaseB);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM path-sweep propagation SVG browser raster probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const PHASE_A_URI=${JSON.stringify(dataUri(phaseA))},PHASE_B_URI=${JSON.stringify(dataUri(phaseB))};
const PHASE_A_SVG_SHA256=${JSON.stringify(phaseAHash)},PHASE_B_SVG_SHA256=${JSON.stringify(phaseBHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
async function main(){const [a,b]=await Promise.all([raster(PHASE_A_URI),raster(PHASE_B_URI)]);let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<a.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}const result={schema:'axm.creative-render.path-sweep-propagation-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:a.length,phase_a_svg_sha256:PHASE_A_SVG_SHA256,phase_b_svg_sha256:PHASE_B_SVG_SHA256,phase_a_rgba_fnv1a32:fnv1a32(a),phase_b_rgba_fnv1a32:fnv1a32(b),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.path-sweep-propagation-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parsePathSweepPropagationSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyPathSweepPropagationSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.path-sweep-propagation-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  if (integer(evidence.width, 1, 4096, "browser raster width") !== WIDTH || integer(evidence.height, 1, 4096, "browser raster height") !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "RGBA byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  text(evidence.phase_a_svg_sha256, "phase A SVG sha256");
  text(evidence.phase_b_svg_sha256, "phase B SVG sha256");
  text(evidence.phase_a_rgba_fnv1a32, "phase A RGBA checksum");
  text(evidence.phase_b_rgba_fnv1a32, "phase B RGBA checksum");
  const differentPixels = integer(evidence.different_pixels, 0, WIDTH * HEIGHT, "different pixel count");
  const differentChannels = integer(evidence.different_channels, 0, WIDTH * HEIGHT * 4, "different channel count");
  const sum = integer(evidence.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, "absolute channel delta sum");
  const max = integer(evidence.max_channel_delta, 0, 255, "maximum channel delta");
  if (expected.phaseASvgSha256 && evidence.phase_a_svg_sha256 !== expected.phaseASvgSha256) throw new Error("browser evidence phase A SVG identity mismatch");
  if (expected.phaseBSvgSha256 && evidence.phase_b_svg_sha256 !== expected.phaseBSvgSha256) throw new Error("browser evidence phase B SVG identity mismatch");
  if (differentPixels < 1 || differentChannels < 1 || sum < 1 || max < 1) throw new Error("browser raster did not observe the verified phase difference");
  if (evidence.phase_a_rgba_fnv1a32 === evidence.phase_b_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge");
  return structuredClone(evidence);
}

export async function observeVisualEffectPathSweepPropagationStaticSvg(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const native = await observeVisualEffectPathSweepPropagationNative(rootPath, { vfxRevision });
  const prepared = object(JSON.parse(native.donorStateBytes.toString("utf8")), "prepared sweep propagation donor state");
  const setA = object(native.phaseAWeightSet, "phase A propagation weight set");
  const setB = object(native.phaseBWeightSet, "phase B propagation weight set");
  const sweepSource = object(prepared.pathSweepFrameSource, "retained sweep source");
  const propagationSource = object(prepared.propagationFrontSource, "retained propagation source");
  const stripSet = object(prepared.pathSweepIndexedStripSets?.[sweepSource.id], "derived indexed strip set");
  const key = `${sweepSource.id}::${propagationSource.id}`;
  if (setA.weightSetHash === setB.weightSetHash || setA.indexedStripSetHash !== setB.indexedStripSetHash) throw new Error("native sweep propagation proof did not preserve fixed geometry across distinct derived phases");

  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    weighted: resolve(rootPath, "hand-lab/src/path-sweep-propagation-weights2d.mjs"),
    staticSvg: resolve(rootPath, "hand-lab/src/path-sweep-propagation-static-svg.mjs"),
  };
  const sourceBytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sha256(sourceBytes.runtime)}`);
  const weighted = await import(`${pathToFileURL(paths.weighted).href}?sha=${sha256(sourceBytes.weighted)}`);
  const staticSvg = await import(`${pathToFileURL(paths.staticSvg).href}?sha=${sha256(sourceBytes.staticSvg)}`);
  if (typeof runtime.hashValue !== "function" || typeof weighted.validatePathSweepPropagationWeightSet !== "function" || typeof weighted.buildPathSweepPropagationWeightSetHand?.execute !== "function") throw new Error("VFX sweep propagation validation helpers are unavailable");
  if (typeof staticSvg.realizePathSweepPropagationStaticSvgHand?.execute !== "function" || typeof staticSvg.makePathSweepPropagationStaticSvgGraph !== "function") throw new Error("VFX sweep propagation static SVG donor is unavailable");
  const graph = staticSvg.makePathSweepPropagationStaticSvgGraph({ phase: setA.phase, width: WIDTH, height: HEIGHT });
  if (graph.id !== "fx.geometry.path-sweep-propagation-static-svg" || graph.version !== "0.1.0") throw new Error("unexpected VFX sweep propagation static SVG graph identity");
  if (staticSvg.realizePathSweepPropagationStaticSvgHand.id !== "fx.geometry.path-sweep-propagation-static-svg-realize" || staticSvg.realizePathSweepPropagationStaticSvgHand.version !== "0.1.0") throw new Error("unexpected VFX sweep propagation static SVG Hand identity");

  const segmentCount = stripSet.pointCount - stripSet.pathCount;
  const outputPointCount = stripSet.triangleCount * 3;
  const controls = {
    width: WIDTH,
    height: HEIGHT,
    padding: 20,
    fillOpacity: 0.92,
    maxPoints: 4096,
    maxVertices: 8192,
    maxSegments: 4096,
    maxOutputPoints: 24576,
  };
  const stateWithSet = (set) => {
    const state = structuredClone(prepared);
    state.pathSweepPropagationWeightSets ??= {};
    state.pathSweepPropagationWeightSets[key] = structuredClone(set);
    return state;
  };
  const render = (set, params, label) => {
    const state = stateWithSet(set);
    if (weighted.validatePathSweepPropagationWeightSet(state, set, { maxPoints: params.maxPoints, maxVertices: params.maxVertices }) !== true) throw new Error(`${label} donor propagation validation failed`);
    const result = staticSvg.realizePathSweepPropagationStaticSvgHand.execute(state, params, {});
    const realization = object(result.state?.realizations?.pathSweepPropagationStaticSvg, `${label} realization`);
    return { result, realization, bytes: realizationBytes(realization, set, stripSet, label) };
  };

  const phaseA = render(setA, controls, "phase A");
  const phaseB = render(setB, controls, "phase B");
  if (sha256(phaseA.bytes) === sha256(phaseB.bytes)) throw new Error("distinct verified propagation phases produced byte-identical donor SVGs");

  const exactControls = {
    ...controls,
    maxPoints: stripSet.pointCount,
    maxVertices: stripSet.vertexCount,
    maxSegments: segmentCount,
    maxOutputPoints: outputPointCount,
  };
  const exact = render(setA, exactControls, "phase A exact budget");
  if (sha256(exact.bytes) !== sha256(phaseA.bytes)) throw new Error("structural capacity changed sweep propagation SVG bytes");
  let segmentBudgetRejected = false;
  try { render(setA, { ...controls, maxSegments: segmentCount - 1 }, "phase A one-below segment budget"); }
  catch (error) { segmentBudgetRejected = /segment budget exceeded/.test(String(error?.message || error)); }
  if (!segmentBudgetRejected) throw new Error("one-below sweep propagation SVG segment capacity did not fail closed");
  let outputBudgetRejected = false;
  try { render(setA, { ...controls, maxOutputPoints: outputPointCount - 1 }, "phase A one-below output budget"); }
  catch (error) { outputBudgetRejected = /output-point budget exceeded/.test(String(error?.message || error)); }
  if (!outputBudgetRejected) throw new Error("one-below sweep propagation SVG output capacity did not fail closed");

  const alternatePresentation = render(setA, { ...controls, padding: 36, fillOpacity: 0.61 }, "alternate presentation");
  if (alternatePresentation.realization.weightSetHash !== setA.weightSetHash || alternatePresentation.realization.indexedStripSetHash !== stripSet.indexedStripSetHash) throw new Error("presentation-only controls changed verified donor identity");
  if (sha256(alternatePresentation.bytes) === sha256(phaseA.bytes)) throw new Error("presentation-only controls did not change disposable SVG bytes");

  const fullState = weighted.buildPathSweepPropagationWeightSetHand.execute(prepared, { phase: 1, maxPoints: stripSet.pointCount, maxVertices: stripSet.vertexCount }).state;
  const fullSet = object(fullState.pathSweepPropagationWeightSets?.[key], "full-weight propagation set");
  if (fullSet.phase !== 1 || fullSet.minWeight !== 1 || fullSet.maxWeight !== 1) throw new Error("full-weight donor endpoint drifted");
  const fullWeight = render(fullSet, controls, "full-weight endpoint");
  if (/<polygon\b[^>]*\sopacity=/i.test(fullWeight.bytes.toString("utf8"))) throw new Error("full-weight SVG retained renderer-local polygon opacity attributes");

  const tampered = structuredClone(setA);
  tampered.paths[0].vertices[2].weight = tampered.paths[0].vertices[2].weight === 0 ? 0.25 : 0;
  tampered.weightSetHash = runtime.hashValue(weightHashPayload(tampered));
  const tamperedHashSelfConsistent = tampered.weightSetHash === runtime.hashValue(weightHashPayload(tampered));
  let tamperRejected = false;
  try { staticSvg.realizePathSweepPropagationStaticSvgHand.execute(stateWithSet(tampered), controls, {}); }
  catch { tamperRejected = true; }
  if (!tamperedHashSelfConsistent || !tamperRejected) throw new Error("self-consistently re-hashed derived propagation tamper was accepted by SVG donor");

  const semanticForgery = structuredClone(setA);
  semanticForgery.semantics.materialAuthority = "emission";
  semanticForgery.weightSetHash = runtime.hashValue(weightHashPayload(semanticForgery));
  const semanticHashSelfConsistent = semanticForgery.weightSetHash === runtime.hashValue(weightHashPayload(semanticForgery));
  let semanticForgeryRejected = false;
  try { staticSvg.realizePathSweepPropagationStaticSvgHand.execute(stateWithSet(semanticForgery), controls, {}); }
  catch { semanticForgeryRejected = true; }
  if (!semanticHashSelfConsistent || !semanticForgeryRejected) throw new Error("self-consistently re-hashed propagation semantic forgery was accepted by SVG donor");

  const probeHtml = makePathSweepPropagationSvgBrowserProbeHtml({ phaseASvg: phaseA.bytes, phaseBSvg: phaseB.bytes });
  const observation = {
    schema: "axm.creative-render.vfx-path-sweep-propagation-svg-browser-build/v1",
    donor_revision: vfxRevision,
    static_graph_id: graph.id,
    static_graph_version: graph.version,
    static_hand_id: staticSvg.realizePathSweepPropagationStaticSvgHand.id,
    static_hand_version: staticSvg.realizePathSweepPropagationStaticSvgHand.version,
    retained: {
      path_source_hash: setA.pathSourceHash,
      sweep_source_hash: setA.sweepSourceHash,
      propagation_source_hash: setA.propagationSourceHash,
    },
    derived: {
      frame_set_hash: setA.frameSetHash,
      ribbon_set_hash: setA.ribbonSetHash,
      indexed_strip_set_hash: setA.indexedStripSetHash,
      phase_a: setA.phase,
      phase_b: setB.phase,
      phase_a_weight_set_hash: setA.weightSetHash,
      phase_b_weight_set_hash: setB.weightSetHash,
      geometry_fixed_across_phases: setA.indexedStripSetHash === setB.indexedStripSetHash,
    },
    capacity_challenge: {
      exact_equals_roomy: sha256(exact.bytes) === sha256(phaseA.bytes),
      one_below_segments_rejected: segmentBudgetRejected,
      one_below_output_points_rejected: outputBudgetRejected,
    },
    presentation_challenge: {
      same_weight_set_hash: alternatePresentation.realization.weightSetHash === setA.weightSetHash,
      same_indexed_strip_set_hash: alternatePresentation.realization.indexedStripSetHash === stripSet.indexedStripSetHash,
      svg_bytes_changed: sha256(alternatePresentation.bytes) !== sha256(phaseA.bytes),
    },
    full_weight_endpoint: {
      phase: fullSet.phase,
      min_weight: fullSet.minWeight,
      max_weight: fullSet.maxWeight,
      local_polygon_opacity_omitted: !/<polygon\b[^>]*\sopacity=/i.test(fullWeight.bytes.toString("utf8")),
    },
    derived_tamper_challenge: {
      recomputed_self_consistent_hash: tamperedHashSelfConsistent,
      rejected: tamperRejected,
    },
    semantic_forgery_challenge: {
      recomputed_self_consistent_hash: semanticHashSelfConsistent,
      rejected: semanticForgeryRejected,
    },
    truth_boundary: {
      canonical_authority: "retained caller path source plus retained VFX sweep-frame and propagation-front sources",
      derived_rebuildable: ["path sweep frames", "ribbon boundaries", "indexed strip connectivity", "propagation weight sets"],
      derived_replaceable: ["SVG realization", "browser probe", "browser RGBA", "screenshots"],
      browser_pixels_proven: false,
      opacity_semantics_proven: false,
      reveal_semantics_proven: false,
      material_semantics_proven: false,
      consumer_semantics_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
    },
  };
  return {
    donorStateBytes: native.donorStateBytes,
    nativeReceiptBytes: native.receiptBytes,
    phaseASvg: phaseA.bytes,
    phaseBSvg: phaseB.bytes,
    fullWeightSvg: fullWeight.bytes,
    alternatePresentationSvg: alternatePresentation.bytes,
    probeHtml,
    observation,
  };
}
