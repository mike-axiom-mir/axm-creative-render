import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { observeVisualEffectDistanceBandParticleWeightFamiliesNative } from "./vfx_distance_band_particle_weight_native_bridge.mjs";

const WIDTH = 640;
const HEIGHT = 420;
const PARTICLE_COUNT = 49;
const GRID_WIDTH = 48;
const GRID_HEIGHT = 32;
const GRID_CELLS = GRID_WIDTH * GRID_HEIGHT;
const MAX_COMPARISONS = 8388608;

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

function particleFixture() {
  const particles = [];
  let index = 0;
  for (const y of [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92]) {
    for (const x of [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92]) {
      particles.push({
        id: `p${String(index).padStart(2, "0")}`,
        x,
        y,
        ...(index === 0 ? { tag: "caller-source-metadata-preserved" } : {}),
      });
      index += 1;
    }
  }
  return particles;
}

function graphWithControls(graph) {
  return {
    ...graph,
    stages: graph.stages.map((stage) => {
      if (stage.hand === "fx.field.coverage-mask-grid-build") {
        return { ...stage, params: { width: GRID_WIDTH, height: GRID_HEIGHT, maxCells: GRID_CELLS } };
      }
      if (stage.hand === "fx.field.mask-distance-grid-build") {
        return { ...stage, params: { maxCells: GRID_CELLS, maxComparisons: MAX_COMPARISONS } };
      }
      if (stage.hand === "fx.field.mask-distance-band-grid-build") {
        return { ...stage, params: { maxCells: GRID_CELLS, maxComparisons: MAX_COMPARISONS } };
      }
      if (stage.hand === "fx.particle.distance-band-weight-build") {
        return { ...stage, params: { maxParticles: PARTICLE_COUNT, maxBandCells: GRID_CELLS, maxComparisons: MAX_COMPARISONS } };
      }
      if (stage.hand === "fx.particle.distance-band-weighted-static-svg-realize") {
        return {
          ...stage,
          params: {
            ...stage.params,
            width: WIDTH,
            height: HEIGHT,
            padding: 20,
            minRadius: 1.2,
            maxRadius: 5.2,
            minOpacity: 0.08,
            maxOpacity: 0.94,
            pointColor: "#69d7ff",
            backgroundColor: "#071018",
            maxParticles: PARTICLE_COUNT,
            maxBandCells: GRID_CELLS,
            maxComparisons: MAX_COMPARISONS,
          },
        };
      }
      return stage;
    }),
  };
}

function realizationParams({ maxParticles = PARTICLE_COUNT, maxBandCells = GRID_CELLS, maxComparisons = MAX_COMPARISONS, ...overrides } = {}) {
  return {
    width: WIDTH,
    height: HEIGHT,
    padding: 20,
    minRadius: 1.2,
    maxRadius: 5.2,
    minOpacity: 0.08,
    maxOpacity: 0.94,
    pointColor: "#69d7ff",
    backgroundColor: "#071018",
    maxParticles,
    maxBandCells,
    maxComparisons,
    ...overrides,
  };
}

function weightedSetHashPayload(set) {
  return {
    schema: set.schema,
    weightSourceHash: set.weightSourceHash,
    particleSourceHash: set.particleSourceHash,
    distanceBandSourceHash: set.distanceBandSourceHash,
    bandGridHash: set.bandGridHash,
    particleCount: set.particleCount,
    samples: set.samples,
  };
}

function recomputeWeightedSummary(runtime, set) {
  const weights = set.samples.map((sample) => Number(sample.weight));
  set.minWeight = Number(Math.min(...weights).toFixed(6));
  set.maxWeight = Number(Math.max(...weights).toFixed(6));
  set.meanWeight = Number((weights.reduce((sum, value) => sum + value, 0) / weights.length).toFixed(6));
  set.zeroWeightCount = weights.filter((value) => value === 0).length;
  set.fullWeightCount = weights.filter((value) => value === 1).length;
  set.weightedSetHash = runtime.hashValue(weightedSetHashPayload(set));
}

function svgBytes(realization, label) {
  const row = object(realization, label);
  if (row.mediaType !== "image/svg+xml") throw new Error(`${label} media type drifted`);
  if (row.renderer !== "axm.vfx.distance-band-particle-static-svg/v0.1") throw new Error(`${label} renderer drifted`);
  if (row.width !== WIDTH || row.height !== HEIGHT) throw new Error(`${label} dimensions drifted`);
  const content = text(row.content, `${label}.content`);
  if (!content.includes('data-layer="weighted-particles"')) throw new Error(`${label} missing weighted-particle layer`);
  if ((content.match(/<circle /g) ?? []).length !== PARTICLE_COUNT) throw new Error(`${label} particle circle count drifted`);
  return Buffer.from(content, "utf8");
}

export function makeDistanceBandParticleSvgBrowserProbeHtml({ fbmSvg, cellularSvg }) {
  const fbm = Buffer.from(fbmSvg);
  const cellular = Buffer.from(cellularSvg);
  const fbmHash = sha256(fbm);
  const cellularHash = sha256(cellular);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM distance-band particle SVG browser raster probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const FBM_URI=${JSON.stringify(dataUri(fbm))},CELLULAR_URI=${JSON.stringify(dataUri(cellular))};
const FBM_SVG_SHA256=${JSON.stringify(fbmHash)},CELLULAR_SVG_SHA256=${JSON.stringify(cellularHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
async function main(){const [fbm,cellular]=await Promise.all([raster(FBM_URI),raster(CELLULAR_URI)]);let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<fbm.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(fbm[i+c]-cellular[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}const result={schema:'axm.creative-render.distance-band-particle-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:fbm.length,fbm_svg_sha256:FBM_SVG_SHA256,cellular_svg_sha256:CELLULAR_SVG_SHA256,fbm_rgba_fnv1a32:fnv1a32(fbm),cellular_rgba_fnv1a32:fnv1a32(cellular),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.distance-band-particle-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parseDistanceBandParticleSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyDistanceBandParticleSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.distance-band-particle-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  if (integer(evidence.width, 1, 4096, "browser raster width") !== WIDTH || integer(evidence.height, 1, 4096, "browser raster height") !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "RGBA byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  text(evidence.fbm_svg_sha256, "fBm SVG sha256");
  text(evidence.cellular_svg_sha256, "cellular SVG sha256");
  text(evidence.fbm_rgba_fnv1a32, "fBm RGBA checksum");
  text(evidence.cellular_rgba_fnv1a32, "cellular RGBA checksum");
  const differentPixels = integer(evidence.different_pixels, 0, WIDTH * HEIGHT, "different pixel count");
  const differentChannels = integer(evidence.different_channels, 0, WIDTH * HEIGHT * 4, "different channel count");
  const sum = integer(evidence.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, "absolute channel delta sum");
  const max = integer(evidence.max_channel_delta, 0, 255, "maximum channel delta");
  if (expected.fbmSvgSha256 && evidence.fbm_svg_sha256 !== expected.fbmSvgSha256) throw new Error("browser evidence fBm SVG identity mismatch");
  if (expected.cellularSvgSha256 && evidence.cellular_svg_sha256 !== expected.cellularSvgSha256) throw new Error("browser evidence cellular SVG identity mismatch");
  if (differentPixels < 1 || differentChannels < 1 || sum < 1 || max < 1) throw new Error("browser raster did not observe source-family particle realization difference");
  if (evidence.fbm_rgba_fnv1a32 === evidence.cellular_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge");
  return structuredClone(evidence);
}

export async function observeVisualEffectDistanceBandParticleStaticSvgBrowser(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const prior = await observeVisualEffectDistanceBandParticleWeightFamiliesNative(rootPath, { vfxRevision });

  const runtimePath = resolve(rootPath, "hand-lab/src/hand-runtime.mjs");
  const modulePath = resolve(rootPath, "hand-lab/src/distance-band-particle-static-svg.mjs");
  const [runtimeBytes, moduleBytes] = await Promise.all([readFile(runtimePath), readFile(modulePath)]);
  const runtime = await import(`${pathToFileURL(runtimePath).href}?sha=${sha256(runtimeBytes)}`);
  const donor = await import(`${pathToFileURL(modulePath).href}?sha=${sha256(moduleBytes)}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!donor.distanceBandParticleStaticSvgHand
    || !donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH
    || !donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH
    || !Array.isArray(donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_HANDS)
    || !Array.isArray(donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_HANDS)
    || typeof donor.makeDistanceBandParticleStaticSvgState !== "function"
    || typeof donor.makeCellularDistanceBandParticleStaticSvgState !== "function") {
    throw new Error("VFX distance-band particle static SVG donor is unavailable");
  }
  if (donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.id !== "fx.particle.distance-band-weighted-static-svg" || donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX fBm particle SVG graph identity");
  if (donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.id !== "fx.particle.distance-band-weighted-static-svg-cellular" || donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX cellular particle SVG graph identity");
  if (donor.distanceBandParticleStaticSvgHand.id !== "fx.particle.distance-band-weighted-static-svg-realize" || donor.distanceBandParticleStaticSvgHand.version !== "0.1.0") throw new Error("unexpected VFX particle SVG realization Hand identity");

  const particles = particleFixture();
  const sharedMask = { id: "creative-render-particle-mask", threshold: 0.5, softness: 0.1, invert: false };
  const sharedDistance = { id: "creative-render-particle-distance", maskId: sharedMask.id, isoLevel: 0.5 };
  const sharedBand = { id: "creative-render-particle-band", distanceId: sharedDistance.id, innerWidth: 0.1, outerWidth: 0.15, softness: 0.03 };
  const sharedWeight = { id: "creative-render-weighted-particles", bandId: sharedBand.id, exponent: 1.3 };
  const specs = {
    fbm: {
      family: "fbm-value-noise-2d",
      hands: donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_HANDS,
      graph: donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH,
      initial: donor.makeDistanceBandParticleStaticSvgState(particles, {
        field: { id: "creative-render-particle-field", seed: 317, frequency: 4.35, octaves: 5, lacunarity: 2, gain: 0.53, offset: [0.09, -0.17] },
        mask: sharedMask,
        distance: sharedDistance,
        band: sharedBand,
        weight: sharedWeight,
      }),
    },
    cellular: {
      family: "cellular-nearest-feature-2d",
      hands: donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_HANDS,
      graph: donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH,
      initial: donor.makeCellularDistanceBandParticleStaticSvgState(particles, {
        field: { id: "creative-render-particle-field", seed: 317, frequency: 4.35, jitter: 0.84, offset: [0.09, -0.17], valueMode: "distance" },
        mask: sharedMask,
        distance: sharedDistance,
        band: sharedBand,
        weight: sharedWeight,
      }),
    },
  };

  const variants = {};
  for (const [name, spec] of Object.entries(specs)) {
    const registry = runtime.createHandRegistry(spec.hands);
    const graph = graphWithControls(spec.graph);
    const execute = (callerKind) => runtime.executeHandGraph({ registry, graph, initialState: spec.initial, context: { callerKind } });
    const human = execute("human");
    const machine = execute("machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${name} static SVG caller-neutral replay failed`);

    const state = human.finalState;
    const weightSource = object(state.bandParticleWeightSource, `${name} retained particle-weight source`);
    const selected = object(state.bandWeightedParticleSets?.[weightSource.id], `${name} derived particle-weight set`);
    const realization = object(state.realizations?.distanceBandParticleStaticSvg, `${name} static SVG realization`);
    const priorVariant = prior.variants?.[name];
    if (!priorVariant) throw new Error(`${name} prior native weighting proof is unavailable`);

    if (selected.schema !== "axm.distance-band-particle-weight-set/v0.1" || selected.derived !== true || selected.rebuildable !== true) throw new Error(`${name} weighted-set boundary drifted`);
    if (selected.weightedSetHash !== priorVariant.weightSet.weightedSetHash
      || selected.particleSourceHash !== priorVariant.particleSourceHash
      || selected.distanceBandSourceHash !== priorVariant.bandSourceHash
      || selected.weightSourceHash !== priorVariant.weightSourceHash
      || state.particleSourceHash !== priorVariant.particleSourceHash) {
      throw new Error(`${name} current SVG graph no longer extends the retained native-weight proof`);
    }
    if (realization.derivedFromWeightedSetHash !== selected.weightedSetHash
      || realization.particleSourceHash !== state.particleSourceHash
      || realization.distanceBandSourceHash !== state.distanceBandSourceHash
      || realization.particleWeightSourceHash !== state.bandParticleWeightSourceHash
      || realization.bandGridHash !== selected.bandGridHash
      || realization.particleCount !== selected.particleCount) {
      throw new Error(`${name} static SVG lost retained/derived lineage`);
    }
    if (runtime.hashValue(realization.content) !== realization.artifactHash) throw new Error(`${name} donor SVG artifact hash drifted`);
    const svg = svgBytes(realization, `${name} static SVG realization`);

    const distanceGrid = object(state.signedMaskDistanceGrids?.[state.maskDistanceSource?.id], `${name} signed-distance grid`);
    const exactParams = realizationParams({ maxComparisons: distanceGrid.comparisonCount });
    const exact = donor.distanceBandParticleStaticSvgHand.execute(state, exactParams).state.realizations.distanceBandParticleStaticSvg;
    const roomy = donor.distanceBandParticleStaticSvgHand.execute(state, realizationParams()).state.realizations.distanceBandParticleStaticSvg;
    if (exact.artifactHash !== realization.artifactHash || roomy.artifactHash !== realization.artifactHash || exact.content !== realization.content || roomy.content !== realization.content) {
      throw new Error(`${name} sufficient SVG execution budgets changed derived realization`);
    }

    let particleBudgetFailure = null;
    let bandCellBudgetFailure = null;
    let comparisonBudgetFailure = null;
    try { donor.distanceBandParticleStaticSvgHand.execute(state, realizationParams({ maxParticles: PARTICLE_COUNT - 1 })); } catch (error) { particleBudgetFailure = String(error?.message || error); }
    try { donor.distanceBandParticleStaticSvgHand.execute(state, realizationParams({ maxBandCells: GRID_CELLS - 1 })); } catch (error) { bandCellBudgetFailure = String(error?.message || error); }
    try { donor.distanceBandParticleStaticSvgHand.execute(state, realizationParams({ maxComparisons: distanceGrid.comparisonCount - 1 })); } catch (error) { comparisonBudgetFailure = String(error?.message || error); }
    if (!particleBudgetFailure?.includes("distanceBandParticleSvg particle budget exceeded")) throw new Error(`${name} insufficient SVG particle budget did not fail loudly`);
    if (!bandCellBudgetFailure?.includes("distanceBandParticle band cell budget exceeded")) throw new Error(`${name} insufficient SVG band-cell budget did not fail loudly`);
    if (!comparisonBudgetFailure?.includes("maskDistance comparison budget exceeded")) throw new Error(`${name} insufficient SVG source-truth comparison budget did not fail loudly`);

    const tampered = structuredClone(state);
    const tamperedSet = tampered.bandWeightedParticleSets[weightSource.id];
    tamperedSet.samples[0].weight = tamperedSet.samples[0].weight > 0.5 ? 0.25 : 0.75;
    recomputeWeightedSummary(runtime, tamperedSet);
    let tamperFailure = null;
    try { donor.distanceBandParticleStaticSvgHand.execute(tampered, realizationParams()); } catch (error) { tamperFailure = String(error?.message || error); }
    if (!tamperFailure?.includes("distance-band particle SVG weighted set differs from source-truth rebuild")) throw new Error(`${name} self-consistent weighted-set tampering was not rejected`);

    const alternate = donor.distanceBandParticleStaticSvgHand.execute(state, realizationParams({
      width: 720,
      height: 460,
      padding: 32,
      minRadius: 0.8,
      maxRadius: 7.5,
      minOpacity: 0.03,
      maxOpacity: 0.78,
      pointColor: "#ffcc66",
      backgroundColor: "#10131a",
    })).state.realizations.distanceBandParticleStaticSvg;
    if (alternate.derivedFromWeightedSetHash !== selected.weightedSetHash || alternate.particleSourceHash !== state.particleSourceHash || alternate.artifactHash === realization.artifactHash) {
      throw new Error(`${name} disposable renderer-control boundary failed`);
    }

    variants[name] = {
      family: spec.family,
      sourceHash: priorVariant.sourceHash,
      maskSourceHash: priorVariant.maskSourceHash,
      distanceSourceHash: priorVariant.distanceSourceHash,
      bandSourceHash: priorVariant.bandSourceHash,
      particleSourceHash: state.particleSourceHash,
      weightSourceHash: state.bandParticleWeightSourceHash,
      weightSet: selected,
      weightSetBytes: stableBytes(selected),
      svg,
      realization,
      finalStateHash: human.finalStateHash,
      distanceComparisonCount: distanceGrid.comparisonCount,
      gates: {
        caller_neutral_replay: true,
        exact_budget_noncreative: true,
        roomy_budget_noncreative: true,
        insufficient_particle_budget_failed: particleBudgetFailure,
        insufficient_band_cell_budget_failed: bandCellBudgetFailure,
        insufficient_comparison_budget_failed: comparisonBudgetFailure,
        self_consistent_weight_tamper_failed: tamperFailure,
        alternate_renderer_preserved_weight_truth: true,
        alternate_renderer_artifact_differs: alternate.artifactHash !== realization.artifactHash,
      },
    };
  }

  if (variants.fbm.particleSourceHash !== variants.cellular.particleSourceHash) throw new Error("shared caller particle source changed across scalar-source families");
  if (variants.fbm.weightSet.weightedSetHash === variants.cellular.weightSet.weightedSetHash) throw new Error("distinct scalar-source families collapsed to one weighted-set identity");
  if (sha256(variants.fbm.svg) === sha256(variants.cellular.svg)) throw new Error("distinct weighted sets collapsed to byte-identical donor SVGs");

  const probeHtml = makeDistanceBandParticleSvgBrowserProbeHtml({ fbmSvg: variants.fbm.svg, cellularSvg: variants.cellular.svg });
  return {
    variants,
    probeHtml,
    observation: {
      schema: "axm.creative-render.vfx-distance-band-particle-svg-browser-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_revision: vfxRevision,
      donor_module_sha256: sha256(moduleBytes),
      runtime_module_sha256: sha256(runtimeBytes),
      graphs: {
        fbm: { id: donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.id, version: donor.DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.version },
        cellular: { id: donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.id, version: donor.CELLULAR_DISTANCE_BAND_PARTICLE_STATIC_SVG_GRAPH.version },
      },
      realization_hand: { id: donor.distanceBandParticleStaticSvgHand.id, version: donor.distanceBandParticleStaticSvgHand.version },
      shared_contract: {
        particle_count: PARTICLE_COUNT,
        grid_width: GRID_WIDTH,
        grid_height: GRID_HEIGHT,
        grid_cells: GRID_CELLS,
        weighted_set_schema: "axm.distance-band-particle-weight-set/v0.1",
        renderer: "axm.vfx.distance-band-particle-static-svg/v0.1",
        viewport: { width: WIDTH, height: HEIGHT },
        source_family_branching_in_realizer: false,
      },
      variants: Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
        family: row.family,
        source_hash: row.sourceHash,
        mask_source_hash: row.maskSourceHash,
        distance_source_hash: row.distanceSourceHash,
        band_source_hash: row.bandSourceHash,
        particle_source_hash: row.particleSourceHash,
        weight_source_hash: row.weightSourceHash,
        weighted_set_hash: row.weightSet.weightedSetHash,
        weighted_set_sha256: sha256(row.weightSetBytes),
        svg_sha256: sha256(row.svg),
        svg_bytes: row.svg.length,
        artifact_hash: row.realization.artifactHash,
        derived_from_weighted_set_hash: row.realization.derivedFromWeightedSetHash,
        min_weight: row.weightSet.minWeight,
        max_weight: row.weightSet.maxWeight,
        mean_weight: row.weightSet.meanWeight,
        comparison_count: row.distanceComparisonCount,
        gates: row.gates,
      }])),
      comparison: {
        particle_source_hash_identical: variants.fbm.particleSourceHash === variants.cellular.particleSourceHash,
        source_hashes_differ: variants.fbm.sourceHash !== variants.cellular.sourceHash,
        weighted_set_hashes_differ: variants.fbm.weightSet.weightedSetHash !== variants.cellular.weightSet.weightedSetHash,
        donor_svg_bytes_differ: sha256(variants.fbm.svg) !== sha256(variants.cellular.svg),
      },
      browser_probe: { width: WIDTH, height: HEIGHT, pixel_format: "RGBA8", network_required: false, html_sha256: sha256(probeHtml) },
      authority: {
        scalar_mask_distance_band_particle_weight_sources: "RETAINED_VFX_SOURCE_AUTHORITY",
        caller_particles: "CALLER_OWNED_RETAINED_SOURCE",
        weighted_particle_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
        svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
        renderer_controls: "DISPOSABLE_OBSERVER_CONTROLS",
        browser_probe: "DERIVED_REPLACEABLE_OBSERVER_BODY",
        browser_pixels: "NOT_OBSERVED_BY_THIS_FUNCTION",
      },
      truth_boundary: {
        browser_pixels_proven: false,
        aesthetic_quality_proven: false,
        particle_semantics_proven: false,
        physical_behavior_proven: false,
        animation_quality_proven: false,
        accessibility_proven: false,
        realtime_performance_proven: false,
        cross_browser_bitwise_determinism_proven: false,
      },
    },
  };
}
