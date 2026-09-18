import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectPathFrameInstancesNative } from "./vfx_path_frame_instances_native_bridge.mjs";

const WIDTH = 640;
const HEIGHT = 420;
const PROTOTYPE_POINTS = Object.freeze([
  Object.freeze({ x: -1, y: -0.55 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: -1, y: 0.55 }),
]);
const PROTOTYPE_ID = "creative-render-neutral-chevron";
const PROTOTYPE_PROVENANCE = "AXM Creative Render bounded observer fixture; caller-declared renderer-only prototype; not canonical source truth";

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

function instanceSetHashPayload(set) {
  return {
    schema: set.schema,
    sweepSourceHash: set.sweepSourceHash,
    pathSourceHash: set.pathSourceHash,
    frameSetHash: set.frameSetHash,
    pathCount: set.pathCount,
    sourcePointCount: set.sourcePointCount,
    instanceCount: set.instanceCount,
    selection: set.selection,
    semantics: set.semantics,
    paths: set.paths,
    provenance: set.provenance,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

function realizationBytes(realization, set, label) {
  const row = object(realization, `${label} path-frame instance SVG realization`);
  if (row.schema !== "axm.vfx.path-frame-instance-static-svg/v0.1" || row.renderer !== "axm.vfx.path-frame-instance-static-svg/v0.1") {
    throw new Error(`${label} SVG renderer/schema drifted`);
  }
  if (row.mediaType !== "image/svg+xml" || row.derived !== true || row.replaceable !== true) throw new Error(`${label} SVG replaceable-derived boundary drifted`);
  if (row.pathSourceHash !== set.pathSourceHash || row.sweepSourceHash !== set.sweepSourceHash || row.frameSetHash !== set.frameSetHash || row.instanceSetHash !== set.instanceSetHash) {
    throw new Error(`${label} SVG lost verified path/frame/instance lineage`);
  }
  if (row.prototype?.canonical !== false || row.prototype?.rendererOnly !== true || row.prototype?.provenanceStatus !== "CALLER_DECLARED_NOT_VERIFIED_BY_HAND") {
    throw new Error(`${label} caller prototype authority was promoted`);
  }
  if (row.renderControls?.width !== WIDTH || row.renderControls?.height !== HEIGHT) throw new Error(`${label} SVG dimensions drifted`);
  const content = text(row.content, `${label} SVG content`);
  if (!content.includes("<svg") || !content.includes("<polyline ")) throw new Error(`${label} SVG is missing expected donor markup`);
  return Buffer.from(content, "utf8");
}

export function makePathFrameInstancesSvgBrowserProbeHtml({ denseSvg, sparseSvg }) {
  const dense = Buffer.from(denseSvg);
  const sparse = Buffer.from(sparseSvg);
  const denseHash = sha256(dense);
  const sparseHash = sha256(sparse);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM path-frame instance SVG browser raster probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const DENSE_URI=${JSON.stringify(dataUri(dense))},SPARSE_URI=${JSON.stringify(dataUri(sparse))};
const DENSE_SVG_SHA256=${JSON.stringify(denseHash)},SPARSE_SVG_SHA256=${JSON.stringify(sparseHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
async function main(){const [a,b]=await Promise.all([raster(DENSE_URI),raster(SPARSE_URI)]);let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<a.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}const result={schema:'axm.creative-render.path-frame-instances-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:a.length,dense_svg_sha256:DENSE_SVG_SHA256,sparse_svg_sha256:SPARSE_SVG_SHA256,dense_rgba_fnv1a32:fnv1a32(a),sparse_rgba_fnv1a32:fnv1a32(b),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.path-frame-instances-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parsePathFrameInstancesSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyPathFrameInstancesSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.path-frame-instances-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  if (integer(evidence.width, 1, 4096, "browser raster width") !== WIDTH || integer(evidence.height, 1, 4096, "browser raster height") !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "RGBA byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  text(evidence.dense_svg_sha256, "dense SVG sha256");
  text(evidence.sparse_svg_sha256, "sparse SVG sha256");
  text(evidence.dense_rgba_fnv1a32, "dense RGBA checksum");
  text(evidence.sparse_rgba_fnv1a32, "sparse RGBA checksum");
  const differentPixels = integer(evidence.different_pixels, 0, WIDTH * HEIGHT, "different pixel count");
  const differentChannels = integer(evidence.different_channels, 0, WIDTH * HEIGHT * 4, "different channel count");
  const sum = integer(evidence.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, "absolute channel delta sum");
  const max = integer(evidence.max_channel_delta, 0, 255, "maximum channel delta");
  if (expected.denseSvgSha256 && evidence.dense_svg_sha256 !== expected.denseSvgSha256) throw new Error("browser evidence dense SVG identity mismatch");
  if (expected.sparseSvgSha256 && evidence.sparse_svg_sha256 !== expected.sparseSvgSha256) throw new Error("browser evidence sparse SVG identity mismatch");
  if (differentPixels < 1 || differentChannels < 1 || sum < 1 || max < 1) throw new Error("browser raster did not observe dense/sparse instance-selection difference");
  if (evidence.dense_rgba_fnv1a32 === evidence.sparse_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge");
  return structuredClone(evidence);
}

export async function observeVisualEffectPathFrameInstancesStaticSvg(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const native = await observeVisualEffectPathFrameInstancesNative(rootPath, { vfxRevision });
  const prepared = object(JSON.parse(native.donorStateBytes.toString("utf8")), "prepared path-frame instance donor state");
  const source = object(native.retained?.source, "retained sweep source");
  const denseSet = object(native.denseSet, "dense derived instance set");
  const sparseSet = object(native.sparseSet, "sparse derived instance set");
  if (!source.id || denseSet.instanceSetHash === sparseSet.instanceSetHash) throw new Error("native path-frame instance proof did not preserve distinct dense/sparse derived sets");

  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    instances: resolve(rootPath, "hand-lab/src/path-frame-instances2d.mjs"),
    staticSvg: resolve(rootPath, "hand-lab/src/path-frame-instance-static-svg.mjs"),
  };
  const sourceBytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sha256(sourceBytes.runtime)}`);
  const instances = await import(`${pathToFileURL(paths.instances).href}?sha=${sha256(sourceBytes.instances)}`);
  const staticSvg = await import(`${pathToFileURL(paths.staticSvg).href}?sha=${sha256(sourceBytes.staticSvg)}`);
  if (typeof runtime.hashValue !== "function" || typeof instances.validatePathFrameInstanceTransformSet !== "function") throw new Error("VFX donor validation helpers are unavailable");
  if (typeof staticSvg.realizePathFrameInstancesStaticSvgHand?.execute !== "function" || typeof staticSvg.makePathFrameInstanceStaticSvgGraph !== "function") throw new Error("VFX path-frame instance static SVG donor is unavailable");
  const graph = staticSvg.makePathFrameInstanceStaticSvgGraph({ prototypeId: PROTOTYPE_ID, prototypePoints: PROTOTYPE_POINTS, prototypeProvenance: PROTOTYPE_PROVENANCE });
  if (graph.id !== "fx.geometry.path-frame-instances2d-static-svg" || graph.version !== "0.1.0") throw new Error("unexpected VFX path-frame instance static SVG graph identity");
  if (staticSvg.realizePathFrameInstancesStaticSvgHand.id !== "fx.geometry.path-frame-instances2d-static-svg-realize" || staticSvg.realizePathFrameInstancesStaticSvgHand.version !== "0.1.0") throw new Error("unexpected VFX path-frame instance static SVG Hand identity");

  const controls = {
    prototypeId: PROTOTYPE_ID,
    prototypePoints: PROTOTYPE_POINTS,
    prototypeProvenance: PROTOTYPE_PROVENANCE,
    width: WIDTH,
    height: HEIGHT,
    padding: 20,
    markerSize: 9,
    strokeWidth: 1.6,
    opacity: 0.94,
    maxPoints: 4096,
    maxInstances: 4096,
    maxOutputPoints: 65536,
  };
  const stateWithSet = (set) => {
    const state = structuredClone(prepared);
    state.pathFrameInstanceTransformSets ??= {};
    state.pathFrameInstanceTransformSets[source.id] = structuredClone(set);
    return state;
  };
  const render = (set, params, label) => {
    const state = stateWithSet(set);
    if (instances.validatePathFrameInstanceTransformSet(state, set, { maxPoints: params.maxPoints, maxInstances: params.maxInstances }) !== true) throw new Error(`${label} donor instance validation failed`);
    const result = staticSvg.realizePathFrameInstancesStaticSvgHand.execute(state, params, {});
    const realization = object(result.state?.realizations?.pathFrameInstancesStaticSvg, `${label} realization`);
    return { result, realization, bytes: realizationBytes(realization, set, label) };
  };

  const dense = render(denseSet, controls, "dense");
  const sparse = render(sparseSet, controls, "sparse");
  if (sha256(dense.bytes) === sha256(sparse.bytes)) throw new Error("dense/sparse verified instance selections produced byte-identical donor SVGs");

  const exact = render(denseSet, { ...controls, maxInstances: denseSet.instanceCount, maxOutputPoints: denseSet.instanceCount * PROTOTYPE_POINTS.length }, "dense exact budget");
  if (sha256(exact.bytes) !== sha256(dense.bytes)) throw new Error("structural capacity changed path-frame instance SVG bytes");
  let instanceBudgetRejected = false;
  try { render(denseSet, { ...controls, maxInstances: denseSet.instanceCount - 1 }, "dense one-below instance budget"); }
  catch (error) { instanceBudgetRejected = /instance budget exceeded/.test(String(error?.message || error)); }
  if (!instanceBudgetRejected) throw new Error("one-below path-frame instance SVG capacity did not fail closed");
  let outputBudgetRejected = false;
  try { render(denseSet, { ...controls, maxOutputPoints: (denseSet.instanceCount * PROTOTYPE_POINTS.length) - 1 }, "dense one-below output budget"); }
  catch (error) { outputBudgetRejected = /output-point budget exceeded/.test(String(error?.message || error)); }
  if (!outputBudgetRejected) throw new Error("one-below path-frame instance SVG output capacity did not fail closed");

  const alternatePresentation = render(denseSet, { ...controls, markerSize: 14, strokeWidth: 3, opacity: 0.61 }, "alternate presentation");
  if (alternatePresentation.realization.instanceSetHash !== denseSet.instanceSetHash || alternatePresentation.realization.prototype.prototypeHash !== dense.realization.prototype.prototypeHash) throw new Error("presentation-only controls changed donor instance/prototype identity");
  if (sha256(alternatePresentation.bytes) === sha256(dense.bytes)) throw new Error("presentation-only controls did not change disposable SVG bytes");

  const alternatePrototypeParams = {
    ...controls,
    prototypeId: "creative-render-neutral-tick",
    prototypePoints: [{ x: -1, y: -0.4 }, { x: 0.2, y: 0.55 }, { x: 1, y: -0.15 }],
    prototypeProvenance: "AXM Creative Render alternate bounded renderer-only fixture; caller-declared and non-canonical",
  };
  const alternatePrototype = render(denseSet, alternatePrototypeParams, "alternate prototype");
  if (alternatePrototype.realization.instanceSetHash !== denseSet.instanceSetHash) throw new Error("caller renderer prototype changed verified instance identity");
  if (alternatePrototype.realization.prototype.prototypeHash === dense.realization.prototype.prototypeHash || sha256(alternatePrototype.bytes) === sha256(dense.bytes)) throw new Error("alternate caller prototype did not remain a distinct replaceable rendering choice");

  const tamperedSet = structuredClone(denseSet);
  tamperedSet.paths[0].instances[1].translation.x = Number((tamperedSet.paths[0].instances[1].translation.x + 0.1).toFixed(6));
  tamperedSet.instanceSetHash = runtime.hashValue(instanceSetHashPayload(tamperedSet));
  let tamperRejected = false;
  try { render(tamperedSet, controls, "self-consistent tampered derived set"); }
  catch (error) { tamperRejected = /does not rebuild from verified frame truth/.test(String(error?.message || error)); }
  if (!tamperRejected) throw new Error("self-consistent derived instance forgery was accepted by static SVG boundary");

  const donorStateBytes = stableBytes(prepared);
  const probeHtml = makePathFrameInstancesSvgBrowserProbeHtml({ denseSvg: dense.bytes, sparseSvg: sparse.bytes });
  const observation = {
    donor_revision: vfxRevision,
    native_graph_id: native.receipt.visual_effect_fabric.graph_id,
    static_graph_id: graph.id,
    static_graph_version: graph.version,
    static_hand_id: staticSvg.realizePathFrameInstancesStaticSvgHand.id,
    static_hand_version: staticSvg.realizePathFrameInstancesStaticSvgHand.version,
    source_files: Object.fromEntries(Object.entries(sourceBytes).map(([name, bytes]) => [name, { sha256: sha256(bytes) }])),
    retained: {
      path_source_hash: denseSet.pathSourceHash,
      sweep_source_hash: denseSet.sweepSourceHash,
    },
    derived: {
      frame_set_hash: denseSet.frameSetHash,
      dense_instance_set_hash: denseSet.instanceSetHash,
      sparse_instance_set_hash: sparseSet.instanceSetHash,
      dense_instance_count: denseSet.instanceCount,
      sparse_instance_count: sparseSet.instanceCount,
    },
    prototype: {
      id: dense.realization.prototype.id,
      hash: dense.realization.prototype.prototypeHash,
      provenance: dense.realization.prototype.provenance,
      provenance_status: dense.realization.prototype.provenanceStatus,
      canonical: dense.realization.prototype.canonical,
      renderer_only: dense.realization.prototype.rendererOnly,
    },
    dense: { svg_sha256: sha256(dense.bytes), content_hash: dense.realization.contentHash, output_point_count: dense.realization.outputPointCount },
    sparse: { svg_sha256: sha256(sparse.bytes), content_hash: sparse.realization.contentHash, output_point_count: sparse.realization.outputPointCount },
    capacity_challenge: { exact_equals_roomy: sha256(exact.bytes) === sha256(dense.bytes), one_below_instance_rejected: instanceBudgetRejected, one_below_output_points_rejected: outputBudgetRejected },
    presentation_challenge: { same_instance_set_hash: alternatePresentation.realization.instanceSetHash === denseSet.instanceSetHash, same_prototype_hash: alternatePresentation.realization.prototype.prototypeHash === dense.realization.prototype.prototypeHash, svg_bytes_changed: sha256(alternatePresentation.bytes) !== sha256(dense.bytes) },
    prototype_challenge: { same_instance_set_hash: alternatePrototype.realization.instanceSetHash === denseSet.instanceSetHash, prototype_hash_changed: alternatePrototype.realization.prototype.prototypeHash !== dense.realization.prototype.prototypeHash, svg_bytes_changed: sha256(alternatePrototype.bytes) !== sha256(dense.bytes), prototype_remains_noncanonical: alternatePrototype.realization.prototype.canonical === false && alternatePrototype.realization.prototype.rendererOnly === true },
    derived_tamper_challenge: { recomputed_self_consistent_hash: true, rejected: tamperRejected },
    truth_boundary: {
      caller_paths_authority: "RETAINED_CALLER_SOURCE_TRUTH",
      sweep_source_authority: "RETAINED_VFX_SOURCE",
      frame_and_instance_sets_authority: "DERIVED_REBUILDABLE_VFX_BODIES",
      prototype_authority: "CALLER_DECLARED_RENDERER_ONLY_NOT_VERIFIED_BY_HAND",
      svg_browser_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
      canonical_mesh_authority_acquired: false,
      consumer_semantics_proven: false,
      prototype_quality_proven: false,
      browser_pixels_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
      realtime_performance_proven: false,
      cross_browser_equivalence_proven: false,
      cross_machine_bitwise_determinism_proven: false,
    },
  };
  return {
    donorStateBytes,
    nativeReceiptBytes: native.receiptBytes,
    denseSvg: dense.bytes,
    sparseSvg: sparse.bytes,
    alternatePresentationSvg: alternatePresentation.bytes,
    alternatePrototypeSvg: alternatePrototype.bytes,
    probeHtml,
    observation,
  };
}
