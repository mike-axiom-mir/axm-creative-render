import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";

const WIDTH = 1000;
const HEIGHT = 600;

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

function svgBytes(realization, label) {
  const row = object(realization, label);
  if (row.mediaType !== "image/svg+xml") throw new Error(`${label} media type must be image/svg+xml`);
  const content = text(row.content, `${label}.content`);
  if (!content.includes("<svg") || !content.includes("<polyline")) throw new Error(`${label} must contain SVG electric path markup`);
  return Buffer.from(content, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function stateOptions(options = {}) {
  return {
    id: String(options.id ?? "creative-render-electric-modulation"),
    strength: options.strength ?? 1,
    floor: options.floor ?? 0.08,
    electric: options.electric ?? {
      seed: 20260916,
      source: { x: 0.08, y: 0.56 },
      target: { x: 0.92, y: 0.40 },
      controls: { branchEnergyScale: 0.68, glowScale: 1 },
    },
    composition: options.composition ?? {
      id: "creative-render-electric-composition",
      operation: "multiply",
      a: { id: "creative-render-electric-broad", seed: 771, frequency: 2.2, octaves: 4, lacunarity: 2, gain: 0.56, offset: [0.11, -0.19] },
      b: { id: "creative-render-electric-detail", seed: 9021, frequency: 7.1, octaves: 3, lacunarity: 1.9, gain: 0.43, offset: [-0.27, 0.21] },
    },
  };
}

function dataUri(bytes) {
  return `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
}

export function makeElectricSvgBrowserProbeHtml({ baseSvg, modulatedSvg }) {
  const base = Buffer.from(baseSvg);
  const modulated = Buffer.from(modulatedSvg);
  const baseUri = dataUri(base);
  const modulatedUri = dataUri(modulated);
  const baseHash = sha256(base);
  const modulatedHash = sha256(modulated);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>AXM electric SVG browser raster probe</title></head>
<body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const BASE_URI=${JSON.stringify(baseUri)};
const MODULATED_URI=${JSON.stringify(modulatedUri)};
const BASE_SVG_SHA256=${JSON.stringify(baseHash)};
const MODULATED_SVG_SHA256=${JSON.stringify(modulatedHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){
  const image=new Image();
  await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});
  const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');
  ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);
  return ctx.getImageData(0,0,WIDTH,HEIGHT).data;
}
async function main(){
  const [base,modulated]=await Promise.all([raster(BASE_URI),raster(MODULATED_URI)]);
  let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;
  for(let i=0;i<base.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(base[i+c]-modulated[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}
  const result={schema:'axm.creative-render.browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:base.length,base_svg_sha256:BASE_SVG_SHA256,modulated_svg_sha256:MODULATED_SVG_SHA256,base_rgba_fnv1a32:fnv1a32(base),modulated_rgba_fnv1a32:fnv1a32(modulated),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};
  document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';
}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parseElectricSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  let parsed;
  try { parsed = JSON.parse(match[1].trim()); } catch { throw new Error("browser probe result is not valid JSON"); }
  return object(parsed, "browser raster evidence");
}

export function verifyElectricSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  const width = integer(evidence.width, 1, 4096, "browser raster width");
  const height = integer(evidence.height, 1, 4096, "browser raster height");
  if (width !== WIDTH || height !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "browser raster pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "browser raster byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  text(evidence.base_svg_sha256, "base SVG sha256");
  text(evidence.modulated_svg_sha256, "modulated SVG sha256");
  text(evidence.base_rgba_fnv1a32, "base RGBA checksum");
  text(evidence.modulated_rgba_fnv1a32, "modulated RGBA checksum");
  const differentPixels = integer(evidence.different_pixels, 0, WIDTH * HEIGHT, "different pixel count");
  const differentChannels = integer(evidence.different_channels, 0, WIDTH * HEIGHT * 4, "different channel count");
  const sumAbsChannelDelta = integer(evidence.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, "absolute channel delta sum");
  const maxChannelDelta = integer(evidence.max_channel_delta, 0, 255, "maximum channel delta");
  if (expected.baseSvgSha256 && evidence.base_svg_sha256 !== expected.baseSvgSha256) throw new Error("browser evidence base SVG identity mismatch");
  if (expected.modulatedSvgSha256 && evidence.modulated_svg_sha256 !== expected.modulatedSvgSha256) throw new Error("browser evidence modulated SVG identity mismatch");
  if (expected.requireDifference !== false) {
    if (differentPixels < 1 || differentChannels < 1 || sumAbsChannelDelta < 1 || maxChannelDelta < 1) throw new Error("browser raster did not observe the declared non-zero modulation difference");
    if (evidence.base_rgba_fnv1a32 === evidence.modulated_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge for non-zero modulation");
  }
  return structuredClone(evidence);
}

export async function observeVisualEffectElectricModulatedSvg(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    electric: resolve(rootPath, "hand-lab/src/electric-hands.mjs"),
    modulation: resolve(rootPath, "hand-lab/src/electric-field-modulation.mjs"),
    modulatedSvg: resolve(rootPath, "hand-lab/src/electric-modulated-svg.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const electric = await import(`${pathToFileURL(paths.electric).href}?sha=${sources.electric.sha256}`);
  const modulation = await import(`${pathToFileURL(paths.modulation).href}?sha=${sources.modulation.sha256}`);
  const modulatedSvg = await import(`${pathToFileURL(paths.modulatedSvg).href}?sha=${sources.modulatedSvg.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (typeof electric.svgPreviewHand?.execute !== "function") throw new Error("VFX base electric SVG donor is unavailable");
  if (!Array.isArray(modulation.ELECTRIC_FIELD_MODULATION_HANDS) || !modulation.ELECTRIC_FIELD_MODULATION_GRAPH) throw new Error("VFX electric modulation donor is unavailable");
  if (!Array.isArray(modulatedSvg.ELECTRIC_MODULATED_SVG_HANDS) || !modulatedSvg.ELECTRIC_MODULATED_SVG_GRAPH || typeof modulatedSvg.makeElectricModulatedSvgState !== "function") throw new Error("VFX modulated electric SVG donor is unavailable");
  if (modulatedSvg.ELECTRIC_MODULATED_SVG_GRAPH.id !== "fx.electric-storm.modulated-svg" || modulatedSvg.ELECTRIC_MODULATED_SVG_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX modulated electric SVG graph identity");

  const opts = stateOptions(options);
  const executeSvg = (stateOpts = opts) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(modulatedSvg.ELECTRIC_MODULATED_SVG_HANDS),
    graph: modulatedSvg.ELECTRIC_MODULATED_SVG_GRAPH,
    initialState: modulatedSvg.makeElectricModulatedSvgState(stateOpts),
    context: { callerKind: "axm-creative-render" },
  });
  const executeModulation = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(modulation.ELECTRIC_FIELD_MODULATION_HANDS),
    graph: modulation.ELECTRIC_FIELD_MODULATION_GRAPH,
    initialState: modulation.makeElectricFieldModulationState(opts),
    context: { callerKind: "axm-creative-render" },
  });

  const first = executeSvg(), second = executeSvg();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("VFX modulated electric SVG repeat verification failed");
  const finalState = object(first.finalState, "VFX modulated electric SVG final state");
  const basePathsHash = text(finalState.electricBasePathsHash, "VFX retained base electric path hash");
  if (runtime.hashValue(finalState.paths) !== basePathsHash) throw new Error("VFX retained base paths drifted during SVG realization");
  const selected = object(finalState.modulatedElectricPathSets?.[opts.id], "VFX selected modulated electric path set");
  if (selected.schema !== "axm.electric-modulated-path-set/v0.1" || selected.derived !== true || selected.rebuildable !== true) throw new Error("VFX selected modulated electric path set lost derived/rebuildable boundary");
  if (selected.basePathsHash !== basePathsHash || runtime.hashValue(selected.paths) !== selected.pathSetHash) throw new Error("VFX selected modulated electric path lineage drifted");

  const realization = object(finalState.realizations?.electricModulatedSvg, "VFX modulated electric SVG realization");
  if (realization.renderer !== "axm.vfx.electric-modulated-svg/v0.1") throw new Error(`unexpected VFX modulated electric SVG renderer: ${String(realization.renderer)}`);
  if (realization.basePathsHash !== basePathsHash || realization.selectedPathSet?.pathSetHash !== selected.pathSetHash || realization.derivedFromSelectedPathSetHash !== selected.pathSetHash) throw new Error("VFX modulated SVG realization lost selected path lineage");
  if (realization.fieldCompositionSourceHash !== finalState.fieldCompositionSourceHash || realization.electricFieldModulationSourceHash !== finalState.electricFieldModulationSourceHash) throw new Error("VFX modulated SVG realization lost source lineage");

  const modulationOnly = executeModulation().finalState;
  const modulationOnlySelected = object(modulationOnly.modulatedElectricPathSets?.[opts.id], "VFX modulation-only selected path set");
  if (modulationOnly.electricBasePathsHash !== basePathsHash || modulationOnlySelected.pathSetHash !== selected.pathSetHash) throw new Error("VFX SVG selection changed the proven modulation identities");
  if (JSON.stringify(modulationOnly.paths) !== JSON.stringify(finalState.paths)) throw new Error("VFX SVG selection rewrote retained base paths");

  const baseResult = electric.svgPreviewHand.execute(structuredClone(finalState), {});
  const baseRealization = object(baseResult.state?.realizations?.svgPreview, "VFX base electric SVG realization");
  if (baseRealization.derivedFromTopologyHash !== basePathsHash) throw new Error("VFX base SVG donor lost retained base path identity");
  const baseSvg = svgBytes(baseRealization, "VFX base electric SVG realization");
  const modulatedSvgBytes = svgBytes(realization, "VFX modulated electric SVG realization");
  if (opts.strength > 0 && sha256(baseSvg) === sha256(modulatedSvgBytes)) throw new Error("non-zero VFX modulation produced byte-identical base and modulated SVG realizations");

  const zero = executeSvg({ ...opts, strength: 0 }).finalState;
  const zeroBase = object(electric.svgPreviewHand.execute(structuredClone(zero), {}).state?.realizations?.svgPreview, "VFX zero-strength base SVG realization");
  const zeroModulated = object(zero.realizations?.electricModulatedSvg, "VFX zero-strength modulated SVG realization");
  const zeroBaseBytes = svgBytes(zeroBase, "VFX zero-strength base SVG realization");
  const zeroModulatedBytes = svgBytes(zeroModulated, "VFX zero-strength modulated SVG realization");
  if (!zeroBaseBytes.equals(zeroModulatedBytes)) throw new Error("VFX zero-strength modulated SVG is not byte-identical to its ordinary SVG donor");
  if (!zeroBaseBytes.equals(baseSvg)) throw new Error("VFX zero-strength fixture unexpectedly changed retained base SVG bytes");

  const probeHtml = makeElectricSvgBrowserProbeHtml({ baseSvg, modulatedSvg: modulatedSvgBytes });
  return {
    baseSvg,
    modulatedSvg: modulatedSvgBytes,
    probeHtml,
    stateBytes: Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8"),
    observation: {
      schema: "axm.creative-render.vfx-electric-modulated-svg-observation/v1",
      donor: "axm-visual-effect-fabric",
      graph_id: modulatedSvg.ELECTRIC_MODULATED_SVG_GRAPH.id,
      graph_version: modulatedSvg.ELECTRIC_MODULATED_SVG_GRAPH.version,
      donor_graph_reused: true,
      existing_svg_donor_reused: true,
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      repeat_verification: "PASS",
      retained_base_paths_hash: basePathsHash,
      selected_modulated_path_set_hash: selected.pathSetHash,
      field_composition_source_hash: finalState.fieldCompositionSourceHash,
      electric_modulation_source_hash: finalState.electricFieldModulationSourceHash,
      factor_stats: structuredClone(selected.factorStats),
      modulation_contract_preserved_before_render_selection: true,
      base_svg: { renderer: "axm.vfx.electric-svg-preview/v0.1", sha256: sha256(baseSvg), bytes: baseSvg.length, derived_from_paths_hash: baseRealization.derivedFromTopologyHash },
      modulated_svg: { renderer: realization.renderer, sha256: sha256(modulatedSvgBytes), bytes: modulatedSvgBytes.length, derived_from_selected_path_set_hash: realization.derivedFromSelectedPathSetHash },
      zero_strength_equivalence: { status: "PASS", base_svg_sha256: sha256(zeroBaseBytes), modulated_svg_sha256: sha256(zeroModulatedBytes), byte_identical: true },
      browser_probe: { width: WIDTH, height: HEIGHT, pixel_format: "RGBA8", network_required: false, html_sha256: sha256(probeHtml) },
      authority: {
        base_electric_paths: "RETAINED_VFX_ELECTRIC_PATH_STATE",
        scalar_field_sources: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
        composition_source: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
        modulation_source: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE",
        modulated_path_set: "DERIVED_REBUILDABLE_VFX_BODY",
        svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES",
        browser_pixels: "NOT_OBSERVED_BY_THIS_FUNCTION",
      },
      truth_boundary: {
        browser_pixels_proven: false,
        aesthetic_quality_proven: false,
        readability_improvement_proven: false,
        physical_electricity_proven: false,
        gameplay_or_world_meaning_proven: false,
      },
    },
  };
}
