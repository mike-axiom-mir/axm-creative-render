import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectBranchPropagationNative } from "./vfx_branch_propagation_native_bridge.mjs";

const WIDTH = 640;
const HEIGHT = 420;
const HARD_MAX_SEGMENTS = 4096;

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

function envelopeHashPayload(envelope) {
  return {
    schema: envelope.schema,
    algorithm: envelope.algorithm,
    distanceMetric: envelope.distanceMetric,
    normalization: envelope.normalization,
    sampleSites: envelope.sampleSites,
    phaseMode: envelope.phaseMode,
    branchSourceHash: envelope.branchSourceHash,
    networkHash: envelope.networkHash,
    propagationSourceHash: envelope.propagationSourceHash,
    phase: envelope.phase,
    maxPathLength: envelope.maxPathLength,
    segmentCount: envelope.segmentCount,
    segments: envelope.segments,
    derived: envelope.derived,
    rebuildable: envelope.rebuildable,
  };
}

function realizationBytes(realization, envelope, prepared, network, label) {
  const row = object(realization, `${label} branch-propagation SVG realization`);
  if (row.schema !== "axm.vfx.branch-propagation-static-svg/v0.1") throw new Error(`${label} SVG schema drifted`);
  if (row.mediaType !== "image/svg+xml" || row.renderer !== "axm.vfx.branch-propagation-static-svg/v0.1") throw new Error(`${label} SVG renderer boundary drifted`);
  if (row.branchSourceHash !== prepared.branchGrowthSourceHash || row.networkHash !== network.networkHash) throw new Error(`${label} SVG lost retained branch/network lineage`);
  if (row.propagationSourceHash !== prepared.propagationFrontSourceHash || row.envelopeHash !== envelope.envelopeHash || row.phase !== envelope.phase) throw new Error(`${label} SVG lost propagation/envelope lineage`);
  if (row.renderControls?.width !== WIDTH || row.renderControls?.height !== HEIGHT) throw new Error(`${label} SVG dimensions drifted`);
  const content = text(row.content, `${label} SVG content`);
  if (!content.includes("<svg") || !content.includes("<line ")) throw new Error(`${label} SVG is missing donor branch markup`);
  return Buffer.from(content, "utf8");
}

export function makeBranchPropagationSvgBrowserProbeHtml({ phaseASvg, phaseBSvg }) {
  const phaseA = Buffer.from(phaseASvg);
  const phaseB = Buffer.from(phaseBSvg);
  const phaseAHash = sha256(phaseA);
  const phaseBHash = sha256(phaseB);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM branch propagation SVG browser raster probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const PHASE_A_URI=${JSON.stringify(dataUri(phaseA))},PHASE_B_URI=${JSON.stringify(dataUri(phaseB))};
const PHASE_A_SVG_SHA256=${JSON.stringify(phaseAHash)},PHASE_B_SVG_SHA256=${JSON.stringify(phaseBHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
async function main(){const [a,b]=await Promise.all([raster(PHASE_A_URI),raster(PHASE_B_URI)]);let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<a.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}const result={schema:'axm.creative-render.branch-propagation-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:a.length,phase_a_svg_sha256:PHASE_A_SVG_SHA256,phase_b_svg_sha256:PHASE_B_SVG_SHA256,phase_a_rgba_fnv1a32:fnv1a32(a),phase_b_rgba_fnv1a32:fnv1a32(b),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.branch-propagation-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parseBranchPropagationSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyBranchPropagationSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.branch-propagation-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
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
  if (differentPixels < 1 || differentChannels < 1 || sum < 1 || max < 1) throw new Error("browser raster did not observe branch-propagation phase difference");
  if (evidence.phase_a_rgba_fnv1a32 === evidence.phase_b_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge");
  return structuredClone(evidence);
}

export async function observeVisualEffectBranchPropagationStaticSvg(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const native = await observeVisualEffectBranchPropagationNative(rootPath, {
    vfxRevision,
    phaseA: options.phaseA ?? 0.22,
    phaseB: options.phaseB ?? 0.72,
  });
  const prepared = object(JSON.parse(native.donorStateBytes.toString("utf8")), "prepared branch-propagation donor state");
  const network = object(native.network, "derived branch network");
  const key = `${prepared.branchGrowthSource?.id}::${prepared.propagationFrontSource?.id}`;
  if (!prepared.branchGrowthSource?.id || !prepared.propagationFrontSource?.id) throw new Error("prepared donor state lost retained branch/propagation source identity");

  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    branchGrowth: resolve(rootPath, "hand-lab/src/branch-growth2d.mjs"),
    branchPropagation: resolve(rootPath, "hand-lab/src/branch-propagation-envelope.mjs"),
    staticSvg: resolve(rootPath, "hand-lab/src/branch-propagation-static-svg.mjs"),
  };
  const sourceBytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sha256(sourceBytes.runtime)}`);
  const branchGrowth = await import(`${pathToFileURL(paths.branchGrowth).href}?sha=${sha256(sourceBytes.branchGrowth)}`);
  const branchPropagation = await import(`${pathToFileURL(paths.branchPropagation).href}?sha=${sha256(sourceBytes.branchPropagation)}`);
  const staticSvg = await import(`${pathToFileURL(paths.staticSvg).href}?sha=${sha256(sourceBytes.staticSvg)}`);

  if (typeof runtime.hashValue !== "function") throw new Error("VFX donor hash helper is unavailable");
  if (typeof branchGrowth.realizeBranchGrowthStaticSvgHand?.execute !== "function") throw new Error("VFX base branch SVG donor is unavailable");
  if (typeof branchPropagation.buildBranchPropagationEnvelopeHand?.execute !== "function" || typeof branchPropagation.validateBranchPropagationEnvelope !== "function") throw new Error("VFX branch-propagation envelope donor is unavailable");
  if (typeof staticSvg.realizeBranchPropagationStaticSvgHand?.execute !== "function" || !staticSvg.BRANCH_PROPAGATION_STATIC_SVG_GRAPH) throw new Error("VFX branch-propagation static SVG donor is unavailable");
  if (staticSvg.BRANCH_PROPAGATION_STATIC_SVG_GRAPH.id !== "fx.growth.branching2d-propagation-front-static-svg" || staticSvg.BRANCH_PROPAGATION_STATIC_SVG_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX branch-propagation static SVG graph identity");
  if (staticSvg.realizeBranchPropagationStaticSvgHand.id !== "fx.growth.branching2d-propagation-front-static-svg-realize" || staticSvg.realizeBranchPropagationStaticSvgHand.version !== "0.1.0") throw new Error("unexpected VFX branch-propagation static SVG Hand identity");

  const phaseAState = structuredClone(prepared);
  phaseAState.branchPropagationEnvelopes ??= {};
  phaseAState.branchPropagationEnvelopes[key] = structuredClone(native.phaseAEnvelope);
  const phaseBState = structuredClone(prepared);
  phaseBState.branchPropagationEnvelopes ??= {};
  phaseBState.branchPropagationEnvelopes[key] = structuredClone(native.phaseBEnvelope);
  const phaseAStateBytes = stableBytes(phaseAState);
  const phaseBStateBytes = stableBytes(phaseBState);

  const controls = { width: WIDTH, height: HEIGHT, strokeWidth: 2, opacity: 0.92, showOrigin: true, originRadius: 2.5, maxSegments: HARD_MAX_SEGMENTS };
  const render = (state, envelope, params, label) => {
    const result = staticSvg.realizeBranchPropagationStaticSvgHand.execute(state, params, {});
    const realization = object(result.state?.realizations?.branchPropagationStaticSvg, `${label} realization`);
    const bytes = realizationBytes(realization, envelope, prepared, network, label);
    return { result, realization, bytes };
  };
  const phaseA = render(phaseAState, native.phaseAEnvelope, controls, "phase A");
  const phaseB = render(phaseBState, native.phaseBEnvelope, controls, "phase B");
  if (sha256(phaseA.bytes) === sha256(phaseB.bytes)) throw new Error("selected branch-propagation phases produced byte-identical donor SVGs");

  const exactBudget = render(phaseBState, native.phaseBEnvelope, { ...controls, maxSegments: network.segmentCount }, "phase B exact budget");
  if (sha256(exactBudget.bytes) !== sha256(phaseB.bytes)) throw new Error("structural maxSegments changed branch-propagation SVG meaning");
  let insufficientBudgetError = "";
  try { render(phaseBState, native.phaseBEnvelope, { ...controls, maxSegments: network.segmentCount - 1 }, "phase B insufficient budget"); }
  catch (error) { insufficientBudgetError = String(error?.message || error); }
  if (!insufficientBudgetError) throw new Error("one-below branch-propagation SVG segment budget did not fail closed");

  const highState = branchPropagation.buildBranchPropagationEnvelopeHand.execute(structuredClone(prepared), { phase: 1, maxSegments: HARD_MAX_SEGMENTS }, {}).state;
  const highEnvelope = object(highState.branchPropagationEnvelopes?.[key], "phase-1 branch-propagation envelope");
  if (!highEnvelope.segments.every((row) => row.startWeight === 1 && row.endWeight === 1)) throw new Error("phase-1 donor envelope is not all-one");
  const high = render(highState, highEnvelope, controls, "phase 1");
  const baseHighResult = branchGrowth.realizeBranchGrowthStaticSvgHand.execute(highState, controls, {});
  const baseHighRealization = object(baseHighResult.state?.realizations?.branchGrowthStaticSvg, "phase-1 base branch SVG realization");
  const baseHighBytes = Buffer.from(text(baseHighRealization.content, "phase-1 base branch SVG content"), "utf8");
  if (sha256(high.bytes) !== sha256(baseHighBytes)) throw new Error("phase-1 branch propagation did not collapse to byte-identical base branch SVG");

  const alternate = render(phaseBState, native.phaseBEnvelope, { ...controls, strokeWidth: 4, opacity: 0.61, showOrigin: false }, "alternate presentation");
  if (sha256(alternate.bytes) === sha256(phaseB.bytes)) throw new Error("renderer-only presentation controls did not change disposable SVG bytes");
  if (alternate.realization.envelopeHash !== phaseB.realization.envelopeHash || alternate.realization.networkHash !== phaseB.realization.networkHash) throw new Error("presentation controls changed selected derived lineage");

  const tampered = structuredClone(phaseBState);
  const tamperedEnvelope = tampered.branchPropagationEnvelopes[key];
  const target = tamperedEnvelope.segments[0];
  target.endWeight = target.endWeight === 0 ? 0.25 : 0;
  tamperedEnvelope.envelopeHash = runtime.hashValue(envelopeHashPayload(tamperedEnvelope));
  let derivedTamperError = "";
  try { staticSvg.realizeBranchPropagationStaticSvgHand.execute(tampered, controls, {}); }
  catch (error) { derivedTamperError = String(error?.message || error); }
  if (!/does not match fresh source derivation/.test(derivedTamperError)) throw new Error(`self-consistent branch-propagation envelope tamper was not rejected: ${derivedTamperError}`);

  const probeHtml = makeBranchPropagationSvgBrowserProbeHtml({ phaseASvg: phaseA.bytes, phaseBSvg: phaseB.bytes });
  const nativeReceiptBytes = stableBytes(native.receipt);
  return {
    donorStateBytes: native.donorStateBytes,
    nativeReceiptBytes,
    phaseAStateBytes,
    phaseBStateBytes,
    phaseASvg: phaseA.bytes,
    phaseBSvg: phaseB.bytes,
    alternateSvg: alternate.bytes,
    phase1Svg: high.bytes,
    phase1BaseSvg: baseHighBytes,
    probeHtml,
    observation: {
      schema: "axm.creative-render.vfx-branch-propagation-svg-browser-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_revision: vfxRevision,
      native_graph_id: native.receipt.visual_effect_fabric.graph_id,
      static_graph_id: staticSvg.BRANCH_PROPAGATION_STATIC_SVG_GRAPH.id,
      static_graph_version: staticSvg.BRANCH_PROPAGATION_STATIC_SVG_GRAPH.version,
      static_hand_id: staticSvg.realizeBranchPropagationStaticSvgHand.id,
      static_hand_version: staticSvg.realizeBranchPropagationStaticSvgHand.version,
      donor_source_files: Object.fromEntries(Object.entries(sourceBytes).map(([name, bytes]) => [name, { sha256: sha256(bytes) }])),
      retained: {
        branch_source_hash: prepared.branchGrowthSourceHash,
        propagation_source_hash: prepared.propagationFrontSourceHash,
      },
      derived_network: {
        network_hash: network.networkHash,
        segment_count: network.segmentCount,
        derived: network.derived,
        rebuildable: network.rebuildable,
      },
      phase_a: {
        phase: native.phaseAEnvelope.phase,
        envelope_hash: native.phaseAEnvelope.envelopeHash,
        svg_sha256: sha256(phaseA.bytes),
        svg_bytes: phaseA.bytes.length,
      },
      phase_b: {
        phase: native.phaseBEnvelope.phase,
        envelope_hash: native.phaseBEnvelope.envelopeHash,
        svg_sha256: sha256(phaseB.bytes),
        svg_bytes: phaseB.bytes.length,
      },
      phase_1_no_op: {
        phase: highEnvelope.phase,
        envelope_hash: highEnvelope.envelopeHash,
        all_one: true,
        byte_identical_to_base_branch_svg: sha256(high.bytes) === sha256(baseHighBytes),
        svg_sha256: sha256(high.bytes),
      },
      capacity_challenge: {
        exact_max_segments: network.segmentCount,
        roomy_max_segments: HARD_MAX_SEGMENTS,
        exact_equals_roomy: sha256(exactBudget.bytes) === sha256(phaseB.bytes),
        one_below_rejected: Boolean(insufficientBudgetError),
        one_below_error: insufficientBudgetError,
      },
      presentation_challenge: {
        same_envelope_hash: alternate.realization.envelopeHash === phaseB.realization.envelopeHash,
        same_network_hash: alternate.realization.networkHash === phaseB.realization.networkHash,
        svg_bytes_changed: sha256(alternate.bytes) !== sha256(phaseB.bytes),
      },
      derived_tamper_challenge: {
        recomputed_self_consistent_hash: true,
        rejected: Boolean(derivedTamperError),
        error: derivedTamperError,
      },
      truth_boundary: {
        canonical_authority: "retained VFX branch-growth source plus retained VFX propagation-front source",
        derived_rebuildable: ["branch network", "branch-propagation envelopes"],
        derived_replaceable: ["SVG realizations", "browser probe", "browser pixels", "screenshots"],
        browser_pixels_proven: false,
        aesthetic_quality_proven: false,
        reveal_or_growth_semantics_proven: false,
        physical_propagation_proven: false,
        accessibility_proven: false,
        realtime_performance_proven: false,
      },
    },
  };
}
