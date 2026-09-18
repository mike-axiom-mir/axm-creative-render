import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectLightParticleLayerPlanNative } from "./vfx_light_particle_layer_native_bridge.mjs";

const WIDTH = 640;
const HEIGHT = 420;
const PLAN_ID = "creative-render-light-particle-layer-plan";
const MODES = ["rays-under-particles", "particles-under-rays"];
const PLAN_HASH_KEYS = [
  "contract",
  "coordinateSpace",
  "layerAuthority",
  "blendModeAuthority",
  "opacityAuthority",
  "materialAuthority",
  "rendererAuthority",
  "consumerAuthority",
  "geometryMutation",
  "sourceMerge",
];

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

function planHash(runtime, plan) {
  const payload = { schema: plan.schema };
  for (const key of PLAN_HASH_KEYS) payload[key] = plan[key];
  payload.id = plan.id;
  payload.orderMode = plan.orderMode;
  payload.layers = plan.layers;
  payload.derived = plan.derived;
  payload.rebuildable = plan.rebuildable;
  return runtime.hashValue(payload);
}

function expectRejected(fn, label) {
  try { fn(); }
  catch (error) { return String(error?.message || error); }
  throw new Error(`${label} was unexpectedly accepted`);
}

function realizationBytes(realization, plan, label) {
  const row = object(realization, `${label} light-particle SVG realization`);
  if (row.schema !== "axm.vfx.light-particle-layer-static-svg/v0.1" || row.renderer !== "axm.vfx.light-particle-layer-static-svg/v0.1") {
    throw new Error(`${label} SVG renderer/schema drifted`);
  }
  if (row.mediaType !== "image/svg+xml" || row.derived !== true || row.replaceable !== true) throw new Error(`${label} SVG replaceable-derived boundary drifted`);
  if (row.derivedFromLayerPlanHash !== plan.planHash || row.planId !== plan.id || row.orderMode !== plan.orderMode) throw new Error(`${label} SVG lost verified layer-plan lineage`);
  if (row.semantics?.orderAuthority !== "verified-layer-plan-only" || row.semantics?.subrealizationMutation !== "none") throw new Error(`${label} SVG ordering/subrealization boundary drifted`);
  if (row.semantics?.blendModeAuthority !== "none" || row.semantics?.opacityAuthority !== "none" || row.semantics?.materialAuthority !== "none" || row.semantics?.canonicalAuthority !== "none" || row.semantics?.consumerAuthority !== "none") {
    throw new Error(`${label} SVG acquired authority the donor does not own`);
  }
  const content = text(row.content, `${label} SVG content`);
  if (!content.includes("<svg") || !content.includes(`data-plan-hash=\"${plan.planHash}\"`) || !content.includes(`data-order-mode=\"${plan.orderMode}\"`)) {
    throw new Error(`${label} SVG is missing exact donor plan binding`);
  }
  return Buffer.from(content, "utf8");
}

export function makeLightParticleLayerSvgBrowserProbeHtml({ raysUnderParticlesSvg, particlesUnderRaysSvg }) {
  const under = Buffer.from(raysUnderParticlesSvg);
  const over = Buffer.from(particlesUnderRaysSvg);
  const underHash = sha256(under);
  const overHash = sha256(over);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM light-particle layer SVG browser raster probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const UNDER_URI=${JSON.stringify(dataUri(under))},OVER_URI=${JSON.stringify(dataUri(over))};
const UNDER_SVG_SHA256=${JSON.stringify(underHash)},OVER_SVG_SHA256=${JSON.stringify(overHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
async function main(){const [a,b]=await Promise.all([raster(UNDER_URI),raster(OVER_URI)]);let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<a.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}const result={schema:'axm.creative-render.light-particle-layer-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:a.length,rays_under_particles_svg_sha256:UNDER_SVG_SHA256,particles_under_rays_svg_sha256:OVER_SVG_SHA256,rays_under_particles_rgba_fnv1a32:fnv1a32(a),particles_under_rays_rgba_fnv1a32:fnv1a32(b),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.light-particle-layer-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parseLightParticleLayerSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyLightParticleLayerSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.light-particle-layer-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  if (integer(evidence.width, 1, 4096, "browser raster width") !== WIDTH || integer(evidence.height, 1, 4096, "browser raster height") !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "RGBA byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  text(evidence.rays_under_particles_svg_sha256, "rays-under-particles SVG sha256");
  text(evidence.particles_under_rays_svg_sha256, "particles-under-rays SVG sha256");
  text(evidence.rays_under_particles_rgba_fnv1a32, "rays-under-particles RGBA checksum");
  text(evidence.particles_under_rays_rgba_fnv1a32, "particles-under-rays RGBA checksum");
  const differentPixels = integer(evidence.different_pixels, 0, WIDTH * HEIGHT, "different pixel count");
  const differentChannels = integer(evidence.different_channels, 0, WIDTH * HEIGHT * 4, "different channel count");
  const sum = integer(evidence.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, "absolute channel delta sum");
  const max = integer(evidence.max_channel_delta, 0, 255, "maximum channel delta");
  if (expected.raysUnderParticlesSvgSha256 && evidence.rays_under_particles_svg_sha256 !== expected.raysUnderParticlesSvgSha256) throw new Error("browser evidence rays-under-particles SVG identity mismatch");
  if (expected.particlesUnderRaysSvgSha256 && evidence.particles_under_rays_svg_sha256 !== expected.particlesUnderRaysSvgSha256) throw new Error("browser evidence particles-under-rays SVG identity mismatch");
  if (differentPixels < 1 || differentChannels < 1 || sum < 1 || max < 1) throw new Error("browser raster did not observe the verified layer-order difference");
  if (evidence.rays_under_particles_rgba_fnv1a32 === evidence.particles_under_rays_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge");
  return structuredClone(evidence);
}

export async function observeVisualEffectLightParticleLayerStaticSvg(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const native = await observeVisualEffectLightParticleLayerPlanNative(rootPath, { vfxRevision });
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    layerPlan: resolve(rootPath, "hand-lab/src/light-particle-layer-plan2d.mjs"),
    staticSvg: resolve(rootPath, "hand-lab/src/light-particle-layer-static-svg.mjs"),
  };
  const sourceBytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sha256(sourceBytes.runtime)}`);
  const layerPlan = await import(`${pathToFileURL(paths.layerPlan).href}?sha=${sha256(sourceBytes.layerPlan)}`);
  const staticSvg = await import(`${pathToFileURL(paths.staticSvg).href}?sha=${sha256(sourceBytes.staticSvg)}`);
  if (typeof runtime.hashValue !== "function" || typeof layerPlan.makeLightParticleLayerPlanState !== "function" || typeof layerPlan.validateLightParticleLayerPlan !== "function") throw new Error("VFX light-particle plan validation boundary is unavailable");
  if (staticSvg.LIGHT_PARTICLE_LAYER_STATIC_SVG_GRAPH?.id !== "fx.composition.light-particle-layer-static-svg" || staticSvg.LIGHT_PARTICLE_LAYER_STATIC_SVG_GRAPH?.version !== "0.1.0") throw new Error("unexpected VFX light-particle static SVG graph identity");
  if (staticSvg.realizeLightParticleLayerStaticSvgHand?.id !== "fx.composition.light-particle-layer-static-svg-realize" || staticSvg.realizeLightParticleLayerStaticSvgHand?.version !== "0.1.0") throw new Error("unexpected VFX light-particle static SVG Hand identity");

  const controls = {
    planId: PLAN_ID,
    width: WIDTH,
    height: HEIGHT,
    lightStrokeWidth: 1.5,
    lightMinOpacity: 0,
    lightMaxOpacity: 0.85,
    particlePadding: 20,
    particleMarkerRadius: 2.4,
    maxParticles: 2048,
    maxParticleSamples: 65536,
    maxSvgBytes: 1048576,
  };

  const stateFor = (plan) => {
    const state = layerPlan.makeLightParticleLayerPlanState(native.lightState, native.particleState);
    state.effectLayerPlans ??= {};
    state.effectLayerPlans[PLAN_ID] = structuredClone(plan);
    return state;
  };
  const render = (plan, params, label) => {
    const state = stateFor(plan);
    if (layerPlan.validateLightParticleLayerPlan(state, plan) !== true) throw new Error(`${label} donor layer-plan validation failed`);
    const before = JSON.stringify(state);
    const result = staticSvg.realizeLightParticleLayerStaticSvgHand.execute(state, params, {});
    if (JSON.stringify(state) !== before) throw new Error(`${label} donor static renderer mutated its caller state`);
    const realization = object(result.state?.realizations?.lightParticleLayerStaticSvg, `${label} realization`);
    return { realization, bytes: realizationBytes(realization, plan, label), evidence: result.evidence };
  };

  const renders = {};
  for (const mode of MODES) renders[mode] = render(native.plans[mode], controls, mode);
  const under = renders["rays-under-particles"];
  const over = renders["particles-under-rays"];
  if (sha256(under.bytes) === sha256(over.bytes)) throw new Error("distinct verified layer orders produced byte-identical donor SVGs");
  if (under.realization.layers.map((row) => row.layerId).join(",") !== "light-rays,particles") throw new Error("rays-under-particles SVG lost donor order");
  if (over.realization.layers.map((row) => row.layerId).join(",") !== "particles,light-rays") throw new Error("particles-under-rays SVG lost donor order");

  const exactBytes = under.evidence.bytes;
  const exact = render(native.plans["rays-under-particles"], { ...controls, maxSvgBytes: exactBytes }, "rays-under-particles exact byte budget");
  if (sha256(exact.bytes) !== sha256(under.bytes)) throw new Error("structural SVG byte capacity changed output bytes");
  const byteBudgetFailure = expectRejected(
    () => render(native.plans["rays-under-particles"], { ...controls, maxSvgBytes: exactBytes - 1 }, "rays-under-particles one-below byte budget"),
    "one-below light-particle SVG byte capacity",
  );
  if (!/lightParticleSvg (?:embedded SVG|output byte) budget exceeded/.test(byteBudgetFailure)) {
    throw new Error(`one-below light-particle SVG capacity failed for the wrong reason: ${byteBudgetFailure}`);
  }

  const presentation = render(native.plans["rays-under-particles"], { ...controls, lightStrokeWidth: 3, particleMarkerRadius: 4 }, "alternate presentation");
  if (presentation.realization.derivedFromLayerPlanHash !== under.realization.derivedFromLayerPlanHash) throw new Error("presentation-only controls rewrote verified plan identity");
  if (sha256(presentation.bytes) === sha256(under.bytes)) throw new Error("alternate renderer presentation did not change disposable SVG bytes");

  const forgedBlend = structuredClone(native.plans["rays-under-particles"]);
  forgedBlend.blendModeAuthority = "screen";
  forgedBlend.planHash = planHash(runtime, forgedBlend);
  const forgedBlendState = stateFor(forgedBlend);
  const forgedBlendFailure = expectRejected(() => layerPlan.validateLightParticleLayerPlan(forgedBlendState, forgedBlend), "self-consistently rehashed blend-authority forgery");

  const forgedLineage = structuredClone(native.plans["rays-under-particles"]);
  const lightLayer = forgedLineage.layers.find((layer) => layer.layerId === "light-rays");
  lightLayer.lineage.raySetHash = "0".repeat(64);
  forgedLineage.planHash = planHash(runtime, forgedLineage);
  const forgedLineageState = stateFor(forgedLineage);
  const forgedLineageFailure = expectRejected(() => layerPlan.validateLightParticleLayerPlan(forgedLineageState, forgedLineage), "self-consistently rehashed layer-lineage forgery");

  const probeHtml = makeLightParticleLayerSvgBrowserProbeHtml({ raysUnderParticlesSvg: under.bytes, particlesUnderRaysSvg: over.bytes });
  return {
    raysUnderParticlesSvg: under.bytes,
    particlesUnderRaysSvg: over.bytes,
    alternatePresentationSvg: presentation.bytes,
    probeHtml,
    nativeReceiptBytes: Buffer.from(`${JSON.stringify(native.receipt, null, 2)}\n`, "utf8"),
    observation: {
      schema: "axm.creative-render.vfx-light-particle-layer-static-svg-browser/v1",
      donor_revision: vfxRevision,
      static_graph_id: staticSvg.LIGHT_PARTICLE_LAYER_STATIC_SVG_GRAPH.id,
      static_graph_version: staticSvg.LIGHT_PARTICLE_LAYER_STATIC_SVG_GRAPH.version,
      static_hand_id: staticSvg.realizeLightParticleLayerStaticSvgHand.id,
      static_hand_version: staticSvg.realizeLightParticleLayerStaticSvgHand.version,
      donor_modules: Object.fromEntries(Object.entries(sourceBytes).map(([name, bytes]) => [name, sha256(bytes)])),
      retained: {
        light_source_hash: native.receipt.visual_effect_fabric.retained_light_source_hash,
        particle_flow_source_hash: native.receipt.visual_effect_fabric.retained_particle_flow_source_hash,
      },
      derived: {
        ray_set_hash: native.receipt.visual_effect_fabric.derived_ray_set_hash,
        particle_set_hash: native.receipt.visual_effect_fabric.derived_particle_set_hash,
        rays_under_particles_plan_hash: native.plans["rays-under-particles"].planHash,
        particles_under_rays_plan_hash: native.plans["particles-under-rays"].planHash,
        rays_under_particles_realization_hash: under.realization.realizationHash,
        particles_under_rays_realization_hash: over.realization.realizationHash,
        same_source_layer_identities_across_orders: native.receipt.comparison.same_ray_set_identity === true && native.receipt.comparison.same_particle_set_identity === true,
        order_preserved: true,
      },
      renderer_semantics: structuredClone(under.realization.semantics),
      capacity_challenge: {
        exact_byte_budget: exactBytes,
        exact_equals_roomy: sha256(exact.bytes) === sha256(under.bytes),
        one_below_rejected: Boolean(byteBudgetFailure),
        one_below_error: byteBudgetFailure,
      },
      presentation_challenge: {
        same_plan_hash: presentation.realization.derivedFromLayerPlanHash === under.realization.derivedFromLayerPlanHash,
        svg_bytes_changed: sha256(presentation.bytes) !== sha256(under.bytes),
      },
      forgery_challenges: {
        blend_authority_rehashed_and_rejected: Boolean(forgedBlendFailure),
        blend_authority_error: forgedBlendFailure,
        layer_lineage_rehashed_and_rejected: Boolean(forgedLineageFailure),
        layer_lineage_error: forgedLineageFailure,
      },
      truth_boundary: {
        canonical: "retained caller light/particle source truth plus retained VFX source truth",
        derived_rebuildable: ["light-ray set", "particle-flow set", "light-particle layer plan"],
        derived_replaceable: ["nested donor SVGs", "composite donor SVG", "browser probe", "browser RGBA", "screenshots"],
        browser_pixels_proven: false,
        blend_semantics_proven: false,
        material_semantics_proven: false,
        depth_semantics_proven: false,
        consumer_semantics_proven: false,
        aesthetic_quality_proven: false,
        accessibility_proven: false,
        realtime_performance_proven: false,
        cross_browser_bitwise_determinism_proven: false,
      },
    },
  };
}
