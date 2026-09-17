import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";

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
  const candidate = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(candidate)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return candidate;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function dataUri(bytes) {
  return `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
}

function svgBytes(realization, expectedRenderer, label) {
  const row = object(realization, label);
  if (row.mediaType !== "image/svg+xml") throw new Error(`${label} media type must be image/svg+xml`);
  if (row.renderer !== expectedRenderer) throw new Error(`${label} renderer drifted`);
  const content = text(row.content, `${label}.content`);
  if (!content.includes("<svg") || !content.includes("<ellipse") || !content.includes("<line")) throw new Error(`${label} lost expected static impulse SVG structure`);
  if (/<script/i.test(content) || /<animate/i.test(content)) throw new Error(`${label} must remain motion-free and script-free`);
  return Buffer.from(content, "utf8");
}

function compareJson(left, right, label) {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(label);
}

function sharedImpulse() {
  return {
    id: "creative-render-curve-static-shared-impulse",
    seed: 20260917,
    origin: [0.48, 0.52],
    direction: [1, -0.18],
    energy: 1.16,
    radius: 0.3,
    duration: 0.74,
    tint: [0.2, 0.88, 1],
    accent: [1, 0.52, 0.18],
    controls: {
      symmetry: 0.18,
      directionality: 0.94,
      fragmentation: 0.79,
      ringWeight: 0.72,
      spokeWeight: 1.12,
    },
  };
}

function noopCurve() {
  return {
    id: "creative-render-curve-static-noop",
    wrapMode: "clamp",
    keyframes: [
      { t: 0, value: 1, interpolation: "linear" },
      { t: 1, value: 1, interpolation: "linear" },
    ],
  };
}

function shapedCurve() {
  return {
    id: "creative-render-curve-static-shaped",
    wrapMode: "clamp",
    keyframes: [
      { t: 0, value: 0.25, interpolation: "smoothstep" },
      { t: 0.25, value: 1.4, interpolation: "smoothstep" },
      { t: 1, value: 0.35, interpolation: "linear" },
    ],
  };
}

export function makeTransientImpulseCurveSvgBrowserProbeHtml({ baseSvg, noopSvg, shapedSvg }) {
  const base = Buffer.from(baseSvg);
  const noop = Buffer.from(noopSvg);
  const shaped = Buffer.from(shapedSvg);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM transient impulse curve SVG browser probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const SVG={base:${JSON.stringify(dataUri(base))},noop:${JSON.stringify(dataUri(noop))},shaped:${JSON.stringify(dataUri(shaped))}};
const HASH={base:${JSON.stringify(sha256(base))},noop:${JSON.stringify(sha256(noop))},shaped:${JSON.stringify(sha256(shaped))}};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
function diff(a,b){let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<a.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}return {different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};}
async function main(){const [base,noop,shaped]=await Promise.all([raster(SVG.base),raster(SVG.noop),raster(SVG.shaped)]);const result={schema:'axm.creative-render.transient-impulse-curve-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:base.length,svg_sha256:HASH,rgba_fnv1a32:{base:fnv1a32(base),noop:fnv1a32(noop),shaped:fnv1a32(shaped)},base_noop:diff(base,noop),base_shaped:diff(base,shaped),noop_shaped:diff(noop,shaped)};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.transient-impulse-curve-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parseTransientImpulseCurveSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyTransientImpulseCurveSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.transient-impulse-curve-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  if (integer(evidence.width, 1, 4096, "browser raster width") !== WIDTH || integer(evidence.height, 1, 4096, "browser raster height") !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "RGBA byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  const hashes = object(evidence.svg_sha256, "SVG hashes");
  const checksums = object(evidence.rgba_fnv1a32, "RGBA checksums");
  for (const name of ["base", "noop", "shaped"]) {
    text(hashes[name], `${name} SVG sha256`);
    text(checksums[name], `${name} RGBA checksum`);
    if (expected[`${name}SvgSha256`] && hashes[name] !== expected[`${name}SvgSha256`]) throw new Error(`browser evidence ${name} SVG identity mismatch`);
  }
  const readDiff = (name) => {
    const row = object(evidence[name], name);
    return {
      different_pixels: integer(row.different_pixels, 0, WIDTH * HEIGHT, `${name} different pixel count`),
      different_channels: integer(row.different_channels, 0, WIDTH * HEIGHT * 4, `${name} different channel count`),
      sum_abs_channel_delta: integer(row.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, `${name} absolute channel delta sum`),
      max_channel_delta: integer(row.max_channel_delta, 0, 255, `${name} maximum channel delta`),
    };
  };
  const baseNoop = readDiff("base_noop");
  const baseShaped = readDiff("base_shaped");
  const noopShaped = readDiff("noop_shaped");
  if (Object.values(baseNoop).some((value) => value !== 0) || checksums.base !== checksums.noop) throw new Error("constant-one donor SVG did not remain an exact browser-pixel no-op");
  if (baseShaped.different_pixels < 1 || baseShaped.different_channels < 1 || baseShaped.sum_abs_channel_delta < 1 || baseShaped.max_channel_delta < 1 || checksums.base === checksums.shaped) throw new Error("shaped curve was not observable in raw browser pixels");
  if (noopShaped.different_pixels < 1 || checksums.noop === checksums.shaped) throw new Error("shaped curve did not diverge from the constant-one browser observation");
  return structuredClone(evidence);
}

export async function observeVisualEffectTransientImpulseCurveStaticSvg(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    impulseHands: resolve(rootPath, "hand-lab/src/transient-impulse-hands.mjs"),
    baseStatic: resolve(rootPath, "hand-lab/src/transient-impulse-static.mjs"),
    curveStatic: resolve(rootPath, "hand-lab/src/transient-impulse-curve-static.mjs"),
    curveModulation: resolve(rootPath, "hand-lab/src/transient-impulse-curve-modulation.mjs"),
    parameterCurve: resolve(rootPath, "hand-lab/src/parameter-curve.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const impulseHands = await import(`${pathToFileURL(paths.impulseHands).href}?sha=${sources.impulseHands.sha256}`);
  const baseStatic = await import(`${pathToFileURL(paths.baseStatic).href}?sha=${sources.baseStatic.sha256}`);
  const curveStatic = await import(`${pathToFileURL(paths.curveStatic).href}?sha=${sources.curveStatic.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (typeof impulseHands.makeTransientImpulseState !== "function") throw new Error("VFX transient impulse state builder is unavailable");
  if (!Array.isArray(baseStatic.TRANSIENT_IMPULSE_STATIC_HANDS) || !baseStatic.TRANSIENT_IMPULSE_STATIC_GRAPH) throw new Error("VFX base transient static SVG graph is unavailable");
  if (!Array.isArray(curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_HANDS) || !curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_GRAPH || typeof curveStatic.makeTransientImpulseCurveStaticState !== "function") throw new Error("VFX curve-selected transient static SVG graph is unavailable");
  if (baseStatic.TRANSIENT_IMPULSE_STATIC_GRAPH.id !== "fx.transient-impulse-static" || baseStatic.TRANSIENT_IMPULSE_STATIC_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX base transient static graph identity");
  if (curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_GRAPH.id !== "fx.transient-impulse.parameter-curve-static" || curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX curve-selected transient static graph identity");

  const expectedCurveHands = [
    "fx.impulse.event-normalize",
    "fx.impulse.field-build",
    "fx.impulse.temporal-envelope",
    "fx.animation.parameter-curve-source-normalize",
    "fx.impulse.parameter-curve-modulate-envelope",
    "fx.impulse.parameter-curve-static-svg-realize",
  ];
  if (JSON.stringify(curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedCurveHands)) throw new Error("unexpected VFX curve-selected transient static Hand boundary");

  const impulse = sharedImpulse();
  const noop = noopCurve();
  const shaped = shapedCurve();
  const callerBytesBefore = { impulse: stableBytes(impulse), noop: stableBytes(noop), shaped: stableBytes(shaped) };
  const runBase = (callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(baseStatic.TRANSIENT_IMPULSE_STATIC_HANDS),
    graph: baseStatic.TRANSIENT_IMPULSE_STATIC_GRAPH,
    initialState: impulseHands.makeTransientImpulseState(impulse),
    context: { callerKind },
  });
  const runCurve = (curve, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_HANDS),
    graph: curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_GRAPH,
    initialState: curveStatic.makeTransientImpulseCurveStaticState({ impulse, curve }),
    context: { callerKind },
  });

  const baseHuman = runBase("human"), baseMachine = runBase("machine");
  const noopHuman = runCurve(noop, "human"), noopMachine = runCurve(noop, "machine");
  const shapedHuman = runCurve(shaped, "human"), shapedMachine = runCurve(shaped, "machine");
  if (baseHuman.finalStateHash !== baseMachine.finalStateHash || noopHuman.finalStateHash !== noopMachine.finalStateHash || shapedHuman.finalStateHash !== shapedMachine.finalStateHash) throw new Error("VFX transient impulse static SVG caller-neutral repeat verification failed");
  if (stableBytes(impulse).compare(callerBytesBefore.impulse) !== 0 || stableBytes(noop).compare(callerBytesBefore.noop) !== 0 || stableBytes(shaped).compare(callerBytesBefore.shaped) !== 0) throw new Error("caller-owned impulse or curve request mutated");

  const baseState = object(baseHuman.finalState, "base transient static state");
  const noopState = object(noopHuman.finalState, "constant-one curve transient static state");
  const shapedState = object(shapedHuman.finalState, "shaped curve transient static state");
  if (baseState.eventCanonicalHash !== noopState.eventCanonicalHash || baseState.eventCanonicalHash !== shapedState.eventCanonicalHash) throw new Error("canonical transient event identity drifted across render choice");
  if (baseState.impulseField.geometryHash !== noopState.impulseField.geometryHash || baseState.impulseField.geometryHash !== shapedState.impulseField.geometryHash) throw new Error("base impulse field geometry drifted across render choice");
  const baseEnvelopeHash = runtime.hashValue(baseState.impulseEnvelope);
  if (runtime.hashValue(noopState.impulseEnvelope) !== baseEnvelopeHash || runtime.hashValue(shapedState.impulseEnvelope) !== baseEnvelopeHash) throw new Error("base transient envelope drifted across curve choice");
  if (baseState.impulseEnvelope.samples.some((sample) => Object.hasOwn(sample, "curveMultiplier")) || noopState.impulseEnvelope.samples.some((sample) => Object.hasOwn(sample, "curveMultiplier")) || shapedState.impulseEnvelope.samples.some((sample) => Object.hasOwn(sample, "curveMultiplier"))) throw new Error("curve multiplier leaked into retained base envelope");

  const noopSelected = object(noopState.curveModulatedImpulseEnvelopes?.[noop.id], "constant-one selected envelope");
  const shapedSelected = object(shapedState.curveModulatedImpulseEnvelopes?.[shaped.id], "shaped selected envelope");
  if (noopSelected.baseEnvelopeHash !== baseEnvelopeHash || shapedSelected.baseEnvelopeHash !== baseEnvelopeHash) throw new Error("selected curve envelope lost base-envelope lineage");
  if (noopSelected.parameterCurveSourceHash !== noopState.parameterCurveSourceHash || shapedSelected.parameterCurveSourceHash !== shapedState.parameterCurveSourceHash) throw new Error("selected curve envelope lost parameter-curve source lineage");
  let shapedIntensityChanges = 0;
  for (let index = 0; index < baseState.impulseEnvelope.samples.length; index += 1) {
    const baseSample = baseState.impulseEnvelope.samples[index];
    const noopSample = noopSelected.samples[index];
    const shapedSample = shapedSelected.samples[index];
    if (noopSample.t !== baseSample.t || noopSample.expansion !== baseSample.expansion || noopSample.intensity !== baseSample.intensity || noopSample.curveMultiplier !== 1) throw new Error("constant-one selected envelope stopped being an exact intensity no-op");
    if (shapedSample.t !== baseSample.t || shapedSample.expansion !== baseSample.expansion) throw new Error("shaped selected envelope rewrote sample time or expansion");
    if (shapedSample.intensity !== baseSample.intensity) shapedIntensityChanges += 1;
  }
  if (shapedIntensityChanges < 1) throw new Error("shaped selected envelope did not change derived intensity");

  const baseRealization = object(baseState.realizations?.transientImpulseStaticSvg, "base transient SVG realization");
  const noopRealization = object(noopState.realizations?.transientImpulseCurveStaticSvg, "constant-one curve SVG realization");
  const shapedRealization = object(shapedState.realizations?.transientImpulseCurveStaticSvg, "shaped curve SVG realization");
  const baseSvg = svgBytes(baseRealization, "axm.vfx.transient-impulse-static-svg/v0.1", "base SVG realization");
  const noopSvg = svgBytes(noopRealization, "axm.vfx.transient-impulse-curve-static-svg/v0.1", "constant-one curve SVG realization");
  const shapedSvg = svgBytes(shapedRealization, "axm.vfx.transient-impulse-curve-static-svg/v0.1", "shaped curve SVG realization");
  if (baseSvg.compare(noopSvg) !== 0) throw new Error("constant-one curve stopped being byte-identical to the ordinary static SVG donor");
  if (baseSvg.compare(shapedSvg) === 0) throw new Error("shaped curve produced byte-identical static SVG output");
  compareJson(baseRealization.motion, noopRealization.motion, "constant-one curve motion evidence drifted from the ordinary static donor");
  if (noopRealization.baseEnvelopeHash !== baseEnvelopeHash || shapedRealization.baseEnvelopeHash !== baseEnvelopeHash) throw new Error("curve-selected SVG lost retained base-envelope lineage");
  if (noopRealization.selectedEnvelope.hash !== runtime.hashValue(noopSelected) || shapedRealization.selectedEnvelope.hash !== runtime.hashValue(shapedSelected)) throw new Error("curve-selected SVG lost selected-envelope lineage");
  if (noopRealization.parameterCurveSourceHash !== noopState.parameterCurveSourceHash || shapedRealization.parameterCurveSourceHash !== shapedState.parameterCurveSourceHash) throw new Error("curve-selected SVG lost parameter-curve source lineage");

  const probeHtml = makeTransientImpulseCurveSvgBrowserProbeHtml({ baseSvg, noopSvg, shapedSvg });
  return {
    impulseBytes: callerBytesBefore.impulse,
    noopCurveBytes: callerBytesBefore.noop,
    shapedCurveBytes: callerBytesBefore.shaped,
    baseStateBytes: stableBytes(baseState),
    noopStateBytes: stableBytes(noopState),
    shapedStateBytes: stableBytes(shapedState),
    baseSvg,
    noopSvg,
    shapedSvg,
    probeHtml,
    observation: {
      schema: "axm.creative-render.vfx-transient-impulse-curve-svg-browser-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_revision: vfxRevision,
      base_graph: { id: baseStatic.TRANSIENT_IMPULSE_STATIC_GRAPH.id, version: baseStatic.TRANSIENT_IMPULSE_STATIC_GRAPH.version },
      curve_graph: { id: curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_GRAPH.id, version: curveStatic.TRANSIENT_IMPULSE_CURVE_STATIC_GRAPH.version, hand_ids: expectedCurveHands },
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      caller_neutral_repeat_verification: "PASS",
      canonical_event_hash: baseState.eventCanonicalHash,
      field_geometry_hash: baseState.impulseField.geometryHash,
      base_envelope_hash: baseEnvelopeHash,
      curve_sources: { noop: noopState.parameterCurveSourceHash, shaped: shapedState.parameterCurveSourceHash },
      selected_envelopes: { noop: runtime.hashValue(noopSelected), shaped: runtime.hashValue(shapedSelected), shaped_intensity_change_count: shapedIntensityChanges },
      svg: {
        base: { sha256: sha256(baseSvg), bytes: baseSvg.length, motion: baseRealization.motion },
        noop: { sha256: sha256(noopSvg), bytes: noopSvg.length, motion: noopRealization.motion },
        shaped: { sha256: sha256(shapedSvg), bytes: shapedSvg.length, motion: shapedRealization.motion },
        base_noop_byte_identical: true,
        shaped_distinct: true,
      },
      browser_probe: { width: WIDTH, height: HEIGHT, pixel_format: "RGBA8", network_required: false, html_sha256: sha256(probeHtml) },
      authority: {
        caller_impulse_and_curve_requests: "CALLER_SOURCE_AUTHORITY",
        canonical_event: "VFX_CANONICAL_EVENT_AUTHORITY",
        base_field_and_envelope: "DERIVED_REBUILDABLE_VFX_STATE",
        selected_curve_envelopes: "DERIVED_REBUILDABLE_VFX_STATE",
        svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
        browser_pixels: "NOT_OBSERVED_BY_THIS_FUNCTION",
      },
      truth_boundary: {
        browser_pixels_proven: false,
        aesthetic_quality_proven: false,
        timing_feel_proven: false,
        physical_correctness_proven: false,
        target_device_equivalence_proven: false,
      },
    },
  };
}
