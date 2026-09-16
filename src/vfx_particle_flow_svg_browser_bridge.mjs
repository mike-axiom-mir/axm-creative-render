import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";

const WIDTH = 640;
const HEIGHT = 420;
const MAX_PARTICLES = 256;
const MAX_SAMPLES = 8192;

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

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function revision(value, label) {
  const textValue = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(textValue)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return textValue;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function sourceParticles() {
  return [
    { id: "seed-a0", x: 0.16, y: 0.22, userData: { group: "a", ordinal: 0, meaning: "caller-owned-untyped" } },
    { id: "seed-a1", x: 0.31, y: 0.28, userData: { group: "a", ordinal: 1, meaning: "caller-owned-untyped" } },
    { id: "seed-a2", x: 0.47, y: 0.24, userData: { group: "a", ordinal: 2, meaning: "caller-owned-untyped" } },
    { id: "seed-a3", x: 0.65, y: 0.30, userData: { group: "a", ordinal: 3, meaning: "caller-owned-untyped" } },
    { id: "seed-b0", x: 0.20, y: 0.52, userData: { group: "b", ordinal: 0, meaning: "caller-owned-untyped" } },
    { id: "seed-b1", x: 0.37, y: 0.57, userData: { group: "b", ordinal: 1, meaning: "caller-owned-untyped" } },
    { id: "seed-b2", x: 0.55, y: 0.50, userData: { group: "b", ordinal: 2, meaning: "caller-owned-untyped" } },
    { id: "seed-b3", x: 0.76, y: 0.58, userData: { group: "b", ordinal: 3, meaning: "caller-owned-untyped" } },
    { id: "seed-c0", x: 0.18, y: 0.79, userData: { group: "c", ordinal: 0, meaning: "caller-owned-untyped" } },
    { id: "seed-c1", x: 0.36, y: 0.73, userData: { group: "c", ordinal: 1, meaning: "caller-owned-untyped" } },
    { id: "seed-c2", x: 0.58, y: 0.80, userData: { group: "c", ordinal: 2, meaning: "caller-owned-untyped" } },
    { id: "seed-c3", x: 0.82, y: 0.72, userData: { group: "c", ordinal: 3, meaning: "caller-owned-untyped" } },
  ];
}

function stateOptions(stepSize) {
  return {
    id: "creative-render-flow-advected-particles",
    steps: 12,
    stepSize,
    field: { id: "creative-render-particle-flow-field", seed: 7013, frequency: 4.25, octaves: 5, lacunarity: 2, gain: 0.5, offset: [0.17, -0.11] },
    flow: { id: "creative-render-particle-flow", mode: "tangent", sampleStep: 0.015625, strength: 1.15 },
  };
}

function svgBytes(realization, label) {
  const row = object(realization, label);
  if (row.mediaType !== "image/svg+xml") throw new Error(`${label} media type must be image/svg+xml`);
  if (row.renderer !== "axm.vfx.particle-flow-static-svg/v0.1") throw new Error(`${label} renderer drifted`);
  const content = text(row.content, `${label}.content`);
  if (!content.includes("<svg") || !content.includes("<polyline") || !content.includes('data-layer="starts"') || !content.includes('data-layer="ends"')) {
    throw new Error(`${label} must contain trajectory plus start/end SVG inspection markup`);
  }
  return Buffer.from(content, "utf8");
}

function selectedParticleSet(state, id, label) {
  const selected = object(state.flowAdvectedParticleSets?.[id], label);
  if (selected.schema !== "axm.flow-advected-particle-set/v0.1" || selected.derived !== true || selected.rebuildable !== true) {
    throw new Error(`${label} lost derived/rebuildable boundary`);
  }
  integer(selected.particleCount, 1, MAX_PARTICLES, `${label}.particleCount`);
  integer(selected.sampleCount, 2, MAX_SAMPLES, `${label}.sampleCount`);
  if (!Array.isArray(selected.particles) || selected.particles.length !== selected.particleCount) throw new Error(`${label} particle cardinality drifted`);
  if (!Array.isArray(selected.trajectories) || selected.trajectories.length !== selected.particleCount) throw new Error(`${label} trajectory cardinality drifted`);
  return selected;
}

function verifySourceAuthority(runtime, callerParticles, state, selected, { exactNoop = false } = {}) {
  const particleHash = runtime.hashValue(callerParticles);
  if (runtime.hashValue(state.particles) !== particleHash || state.particleSourceHash !== particleHash || selected.particleSourceHash !== particleHash) {
    throw new Error("VFX particle-flow canonical particle source identity drifted");
  }
  if (runtime.hashValue(state.fieldSource) !== state.fieldSourceHash || selected.scalarSourceHash !== state.fieldSourceHash) throw new Error("VFX scalar source lineage drifted");
  if (runtime.hashValue(state.flowSource) !== state.flowSourceHash || selected.flowSourceHash !== state.flowSourceHash) throw new Error("VFX vector-flow source lineage drifted");
  if (runtime.hashValue(state.particleFlowSource) !== state.particleFlowSourceHash || selected.advectionSourceHash !== state.particleFlowSourceHash) throw new Error("VFX advection source lineage drifted");
  if (selected.particles.length !== callerParticles.length) throw new Error("derived particle cardinality changed");
  let moved = 0;
  for (let index = 0; index < callerParticles.length; index += 1) {
    const source = callerParticles[index];
    const candidate = selected.particles[index];
    const trajectory = selected.trajectories[index];
    if (source.id !== candidate?.id || source.id !== trajectory?.id) throw new Error(`particle identity/order drifted at ${index}`);
    const sourceMetadata = structuredClone(source); delete sourceMetadata.x; delete sourceMetadata.y;
    const candidateMetadata = structuredClone(candidate); delete candidateMetadata.x; delete candidateMetadata.y;
    if (JSON.stringify(sourceMetadata) !== JSON.stringify(candidateMetadata)) throw new Error(`particle metadata drifted for ${source.id}`);
    if (!Array.isArray(trajectory.points) || trajectory.points.length < 2) throw new Error(`trajectory missing for ${source.id}`);
    const first = trajectory.points[0], last = trajectory.points.at(-1);
    if (first.x !== source.x || first.y !== source.y) throw new Error(`trajectory start lost canonical seed ${source.id}`);
    if (last.x !== candidate.x || last.y !== candidate.y) throw new Error(`trajectory end lost derived particle ${source.id}`);
    const same = source.x === candidate.x && source.y === candidate.y;
    if (!same) moved += 1;
    if (exactNoop && !same) throw new Error(`zero-step realization moved ${source.id}`);
  }
  if (moved !== selected.movedParticleCount) throw new Error("moved-particle evidence drifted");
  return { particleHash, moved };
}

function dataUri(bytes) {
  return `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
}

export function makeParticleFlowSvgBrowserProbeHtml({ zeroSvg, activeSvg }) {
  const zero = Buffer.from(zeroSvg), active = Buffer.from(activeSvg);
  const zeroUri = dataUri(zero), activeUri = dataUri(active);
  const zeroHash = sha256(zero), activeHash = sha256(active);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AXM particle-flow SVG browser raster probe</title></head><body><pre id="result">PENDING</pre><script>
const WIDTH=${WIDTH},HEIGHT=${HEIGHT};
const ZERO_URI=${JSON.stringify(zeroUri)},ACTIVE_URI=${JSON.stringify(activeUri)};
const ZERO_SVG_SHA256=${JSON.stringify(zeroHash)},ACTIVE_SVG_SHA256=${JSON.stringify(activeHash)};
function fnv1a32(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
async function raster(uri){const image=new Image();await new Promise((ok,fail)=>{image.onload=ok;image.onerror=()=>fail(new Error('SVG image decode failed'));image.src=uri;});const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas2D unavailable');ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(image,0,0,WIDTH,HEIGHT);return ctx.getImageData(0,0,WIDTH,HEIGHT).data;}
async function main(){const [zero,active]=await Promise.all([raster(ZERO_URI),raster(ACTIVE_URI)]);let differentPixels=0,differentChannels=0,sumAbsChannelDelta=0,maxChannelDelta=0;for(let i=0;i<zero.length;i+=4){let pixelDiff=false;for(let c=0;c<4;c++){const delta=Math.abs(zero[i+c]-active[i+c]);if(delta){pixelDiff=true;differentChannels++;sumAbsChannelDelta+=delta;if(delta>maxChannelDelta)maxChannelDelta=delta;}}if(pixelDiff)differentPixels++;}const result={schema:'axm.creative-render.particle-flow-browser-svg-raster-evidence/v1',width:WIDTH,height:HEIGHT,pixel_count:WIDTH*HEIGHT,rgba_bytes:zero.length,zero_svg_sha256:ZERO_SVG_SHA256,active_svg_sha256:ACTIVE_SVG_SHA256,zero_rgba_fnv1a32:fnv1a32(zero),active_rgba_fnv1a32:fnv1a32(active),different_pixels:differentPixels,different_channels:differentChannels,sum_abs_channel_delta:sumAbsChannelDelta,max_channel_delta:maxChannelDelta};document.getElementById('result').textContent=JSON.stringify(result);document.body.dataset.axmDone='true';}
main().catch((error)=>{document.getElementById('result').textContent=JSON.stringify({schema:'axm.creative-render.particle-flow-browser-svg-raster-error/v1',error:String(error&&error.message||error)});document.body.dataset.axmError='true';});
</script></body></html>`;
  return Buffer.from(html, "utf8");
}

export function parseParticleFlowSvgBrowserProbeDump(bytes) {
  const source = Buffer.from(bytes).toString("utf8");
  const match = source.match(/<pre id="result">([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("browser probe dump is missing #result evidence");
  try { return object(JSON.parse(match[1].trim()), "browser raster evidence"); }
  catch { throw new Error("browser probe result is not valid JSON"); }
}

export function verifyParticleFlowSvgBrowserRasterEvidence(value, expected = {}) {
  const evidence = object(value, "browser raster evidence");
  if (evidence.schema !== "axm.creative-render.particle-flow-browser-svg-raster-evidence/v1") throw new Error(`unexpected browser raster evidence schema: ${String(evidence.schema)}`);
  if (integer(evidence.width, 1, 4096, "browser raster width") !== WIDTH || integer(evidence.height, 1, 4096, "browser raster height") !== HEIGHT) throw new Error(`browser raster dimensions must remain ${WIDTH}x${HEIGHT}`);
  if (integer(evidence.pixel_count, 1, WIDTH * HEIGHT, "pixel count") !== WIDTH * HEIGHT) throw new Error("browser raster pixel count drifted");
  if (integer(evidence.rgba_bytes, 4, WIDTH * HEIGHT * 4, "RGBA byte count") !== WIDTH * HEIGHT * 4) throw new Error("browser raster RGBA byte count drifted");
  text(evidence.zero_svg_sha256, "zero SVG sha256"); text(evidence.active_svg_sha256, "active SVG sha256");
  text(evidence.zero_rgba_fnv1a32, "zero RGBA checksum"); text(evidence.active_rgba_fnv1a32, "active RGBA checksum");
  const differentPixels = integer(evidence.different_pixels, 0, WIDTH * HEIGHT, "different pixel count");
  const differentChannels = integer(evidence.different_channels, 0, WIDTH * HEIGHT * 4, "different channel count");
  const sum = integer(evidence.sum_abs_channel_delta, 0, WIDTH * HEIGHT * 4 * 255, "absolute channel delta sum");
  const max = integer(evidence.max_channel_delta, 0, 255, "maximum channel delta");
  if (expected.zeroSvgSha256 && evidence.zero_svg_sha256 !== expected.zeroSvgSha256) throw new Error("browser evidence zero SVG identity mismatch");
  if (expected.activeSvgSha256 && evidence.active_svg_sha256 !== expected.activeSvgSha256) throw new Error("browser evidence active SVG identity mismatch");
  if (differentPixels < 1 || differentChannels < 1 || sum < 1 || max < 1) throw new Error("browser raster did not observe active particle-flow difference");
  if (evidence.zero_rgba_fnv1a32 === evidence.active_rgba_fnv1a32) throw new Error("browser raster checksums did not diverge");
  return structuredClone(evidence);
}

export async function observeVisualEffectParticleFlowStaticSvg(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    flow: resolve(rootPath, "hand-lab/src/field-flow-operators.mjs"),
    advection: resolve(rootPath, "hand-lab/src/particle-flow-advection.mjs"),
    svg: resolve(rootPath, "hand-lab/src/particle-flow-static-svg.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const donor = await import(`${pathToFileURL(paths.svg).href}?sha=${sources.svg.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(donor.PARTICLE_FLOW_STATIC_SVG_HANDS) || !donor.PARTICLE_FLOW_STATIC_SVG_GRAPH || typeof donor.makeParticleFlowStaticSvgState !== "function") throw new Error("VFX particle-flow SVG donor is unavailable");
  if (donor.PARTICLE_FLOW_STATIC_SVG_GRAPH.id !== "fx.particle.flow-advected-static-svg" || donor.PARTICLE_FLOW_STATIC_SVG_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX particle-flow SVG graph identity");
  const expectedHands = ["fx.particle.flow-advection-source-normalize", "fx.particle.flow-advection-build", "fx.particle.flow-static-svg-realize"];
  if (JSON.stringify(donor.PARTICLE_FLOW_STATIC_SVG_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) throw new Error("unexpected VFX particle-flow SVG Hand boundary");

  const callerParticles = sourceParticles();
  const callerBytes = stableBytes(callerParticles);
  const activeStepSize = finite(options.activeStepSize ?? 0.035, "active particle-flow step size");
  if (activeStepSize <= 0 || activeStepSize > 0.25) throw new Error("active particle-flow step size must be within (0, 0.25]");
  const execute = (stepSize, callerKind) => runtime.executeHandGraph({ registry: runtime.createHandRegistry(donor.PARTICLE_FLOW_STATIC_SVG_HANDS), graph: donor.PARTICLE_FLOW_STATIC_SVG_GRAPH, initialState: donor.makeParticleFlowStaticSvgState(callerParticles, stateOptions(stepSize)), context: { callerKind } });
  const zeroHuman = execute(0, "human"), zeroMachine = execute(0, "machine"), activeHuman = execute(activeStepSize, "human"), activeMachine = execute(activeStepSize, "machine");
  if (zeroHuman.finalStateHash !== zeroMachine.finalStateHash || activeHuman.finalStateHash !== activeMachine.finalStateHash) throw new Error("VFX particle-flow SVG caller-neutral repeat verification failed");
  const zeroState = object(zeroHuman.finalState, "zero particle-flow SVG state"), activeState = object(activeHuman.finalState, "active particle-flow SVG state");
  const id = stateOptions(0).id;
  const zeroSet = selectedParticleSet(zeroState, id, "zero particle set"), activeSet = selectedParticleSet(activeState, id, "active particle set");
  const zeroAuthority = verifySourceAuthority(runtime, callerParticles, zeroState, zeroSet, { exactNoop: true });
  const activeAuthority = verifySourceAuthority(runtime, callerParticles, activeState, activeSet);
  if (zeroAuthority.moved !== 0 || zeroSet.maxStepDistance !== 0 || zeroSet.clampedStepCount !== 0) throw new Error("zero-step particle flow did not remain exact no-op");
  if (!(activeAuthority.moved > 0) || !(activeSet.maxStepDistance > 0)) throw new Error("active particle flow did not produce bounded motion");
  if (zeroState.particleSourceHash !== activeState.particleSourceHash || zeroState.fieldSourceHash !== activeState.fieldSourceHash || zeroState.flowSourceHash !== activeState.flowSourceHash) throw new Error("retained source identity changed across zero/active challenge");
  if (zeroState.particleFlowSourceHash === activeState.particleFlowSourceHash || zeroSet.particleSetHash === activeSet.particleSetHash) throw new Error("explicit step-size choice did not change derived identities");

  const zeroRealization = object(zeroState.realizations?.particleFlowStaticSvg, "zero SVG realization"), activeRealization = object(activeState.realizations?.particleFlowStaticSvg, "active SVG realization");
  for (const [state, set, realization, label] of [[zeroState, zeroSet, zeroRealization, "zero"], [activeState, activeSet, activeRealization, "active"]]) {
    if (realization.derivedFromParticleSetHash !== set.particleSetHash) throw new Error(`${label} SVG lost selected particle-set identity`);
    if (realization.particleSourceHash !== state.particleSourceHash || realization.scalarSourceHash !== state.fieldSourceHash || realization.flowSourceHash !== state.flowSourceHash || realization.advectionSourceHash !== state.particleFlowSourceHash) throw new Error(`${label} SVG lost retained source lineage`);
    if (realization.particleCount !== set.particleCount || realization.sampleCount !== set.sampleCount || realization.width !== WIDTH || realization.height !== HEIGHT) throw new Error(`${label} SVG realization shape drifted`);
  }
  const zeroSvg = svgBytes(zeroRealization, "zero SVG realization"), activeSvg = svgBytes(activeRealization, "active SVG realization");
  if (sha256(zeroSvg) === sha256(activeSvg)) throw new Error("active particle flow produced byte-identical donor SVG realization");
  const probeHtml = makeParticleFlowSvgBrowserProbeHtml({ zeroSvg, activeSvg });
  return {
    sourceParticlesBytes: callerBytes,
    zeroStateBytes: stableBytes(zeroState),
    activeStateBytes: stableBytes(activeState),
    zeroSvg,
    activeSvg,
    probeHtml,
    observation: {
      schema: "axm.creative-render.vfx-particle-flow-svg-browser-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_revision: vfxRevision,
      graph_id: donor.PARTICLE_FLOW_STATIC_SVG_GRAPH.id,
      graph_version: donor.PARTICLE_FLOW_STATIC_SVG_GRAPH.version,
      hand_ids: expectedHands,
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      caller_neutral_repeat_verification: "PASS",
      retained_sources: { particle_source_hash: zeroState.particleSourceHash, scalar_source_hash: zeroState.fieldSourceHash, flow_source_hash: zeroState.flowSourceHash },
      zero: { step_size: 0, advection_source_hash: zeroState.particleFlowSourceHash, particle_set_hash: zeroSet.particleSetHash, moved_particle_count: zeroSet.movedParticleCount, max_step_distance: zeroSet.maxStepDistance, particle_count: zeroSet.particleCount, sample_count: zeroSet.sampleCount, svg_sha256: sha256(zeroSvg), svg_bytes: zeroSvg.length, derived_from_particle_set_hash: zeroRealization.derivedFromParticleSetHash },
      active: { step_size: activeStepSize, advection_source_hash: activeState.particleFlowSourceHash, particle_set_hash: activeSet.particleSetHash, moved_particle_count: activeSet.movedParticleCount, max_step_distance: activeSet.maxStepDistance, particle_count: activeSet.particleCount, sample_count: activeSet.sampleCount, svg_sha256: sha256(activeSvg), svg_bytes: activeSvg.length, derived_from_particle_set_hash: activeRealization.derivedFromParticleSetHash },
      browser_probe: { width: WIDTH, height: HEIGHT, pixel_format: "RGBA8", network_required: false, html_sha256: sha256(probeHtml) },
      authority: { caller_particles: "CALLER_CANONICAL_PARTICLE_SOURCE", vfx_sources: "RETAINED_VFX_SCALAR_VECTOR_AND_ADVECTION_SOURCES", particle_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS", svg_realizations: "DERIVED_REPLACEABLE_VFX_BODIES", browser_pixels: "NOT_OBSERVED_BY_THIS_FUNCTION" },
      truth_boundary: { browser_pixels_proven: false, aesthetic_quality_proven: false, readability_proven: false, physical_transport_proven: false, animation_quality_proven: false, consumer_acceptance_proven: false },
    },
  };
}
