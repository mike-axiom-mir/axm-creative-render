import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_MULTI_FAMILY_DISTANCE_BAND_PARTICLE_WEIGHT_NATIVE_RECEIPT";
const VERSION = 1;
const DISPLAY_MIN = 24;
const DISPLAY_RANGE = 216;
const PARTICLE_HALF_SIZE = 0.022;

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function finiteUnit(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be finite within [0,1]`);
  return number;
}

function pointToScene(u, v) {
  return [(u - 0.5) * 1.8, (0.5 - v) * 1.8, 0];
}

function grayForWeight(value) {
  return DISPLAY_MIN + Math.round(finiteUnit(value, "particle weight") * DISPLAY_RANGE);
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function summarizeWeights(samples) {
  const weights = samples.map((sample, index) => finiteUnit(sample.weight, `samples[${index}].weight`));
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const meanWeight = weights.reduce((sum, value) => sum + value, 0) / weights.length;
  return {
    minWeight: round6(minWeight),
    maxWeight: round6(maxWeight),
    meanWeight: round6(meanWeight),
    zeroWeightCount: weights.filter((value) => value === 0).length,
    fullWeightCount: weights.filter((value) => value === 1).length,
  };
}

export function distanceBandParticleWeightSetToAxmScene(weightSet) {
  if (!weightSet || typeof weightSet !== "object" || Array.isArray(weightSet)) throw new Error("distance-band particle native adapter requires a weight-set object");
  if (weightSet.schema !== "axm.distance-band-particle-weight-set/v0.1") throw new Error("distance-band particle native adapter requires axm.distance-band-particle-weight-set/v0.1");
  if (weightSet.derived !== true || weightSet.rebuildable !== true) throw new Error("distance-band particle native adapter accepts only derived rebuildable weight sets");
  for (const key of ["weightSourceHash", "particleSourceHash", "distanceBandSourceHash", "bandGridHash", "weightedSetHash"]) {
    if (!String(weightSet[key] || "").trim()) throw new Error(`distance-band particle native adapter requires ${key}`);
  }
  if (!Number.isInteger(weightSet.particleCount) || weightSet.particleCount < 1 || weightSet.particleCount > 4096) throw new Error("distance-band particle native adapter requires particleCount within 1..4096");
  if (!Array.isArray(weightSet.samples) || weightSet.samples.length !== weightSet.particleCount) throw new Error("distance-band particle native adapter sample cardinality mismatch");

  const ids = new Set();
  const samples = weightSet.samples.map((sample, index) => {
    if (!sample || typeof sample !== "object") throw new Error(`samples[${index}] must be an object`);
    const particleId = String(sample.particleId || "").trim();
    if (!particleId) throw new Error(`samples[${index}].particleId must be non-empty`);
    if (ids.has(particleId)) throw new Error(`duplicate weighted particle id: ${particleId}`);
    ids.add(particleId);
    return {
      particleId,
      x: finiteUnit(sample.x, `samples[${index}].x`),
      y: finiteUnit(sample.y, `samples[${index}].y`),
      weight: finiteUnit(sample.weight, `samples[${index}].weight`),
    };
  });

  const summary = summarizeWeights(samples);
  for (const key of ["minWeight", "maxWeight", "meanWeight"]) {
    if (!Number.isFinite(weightSet[key]) || Math.abs(Number(weightSet[key]) - summary[key]) > 1e-6) throw new Error(`distance-band particle native adapter retained ${key} summary does not match samples`);
  }
  if (weightSet.zeroWeightCount !== summary.zeroWeightCount || weightSet.fullWeightCount !== summary.fullWeightCount) throw new Error("distance-band particle native adapter retained weight counts do not match samples");

  const triangles = [];
  for (const sample of samples) {
    const [cx, cy] = pointToScene(sample.x, sample.y);
    const albedoShade = grayForWeight(sample.weight);
    const albedo = [albedoShade, albedoShade, albedoShade];
    const a = [cx - PARTICLE_HALF_SIZE, cy - PARTICLE_HALF_SIZE, 0];
    const b = [cx + PARTICLE_HALF_SIZE, cy - PARTICLE_HALF_SIZE, 0];
    const c = [cx + PARTICLE_HALF_SIZE, cy + PARTICLE_HALF_SIZE, 0];
    const d = [cx - PARTICLE_HALF_SIZE, cy + PARTICLE_HALF_SIZE, 0];
    triangles.push(
      { vertices: [a, b, c], albedo: [...albedo] },
      { vertices: [a, c, d], albedo: [...albedo] },
    );
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  if (parseScene(bytes.toString("utf8")).triangles.length !== samples.length * 2) throw new Error("distance-band particle native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-distance-band-particle-weight-set-to-axm-scene/v1",
      input_schema: weightSet.schema,
      weight_source_hash: weightSet.weightSourceHash,
      particle_source_hash: weightSet.particleSourceHash,
      distance_band_source_hash: weightSet.distanceBandSourceHash,
      band_grid_hash: weightSet.bandGridHash,
      weighted_set_hash: weightSet.weightedSetHash,
      input_particles: samples.length,
      output_contract: "AXM_SCENE 1",
      output_triangles: triangles.length,
      geometry_mapping: "one derived weighted particle -> one fixed-size planar two-triangle square at retained source position",
      display_transfer: "derived neutral weight 0..1 -> neutral grayscale 24..240",
      source_family_branching: false,
      consumer_semantics_assigned: false,
      opacity_size_emission_gameplay_semantics_assigned: false,
      canonical_source_rewritten: false,
      derived: true,
      replaceable: true,
    },
  };
}

function geometryOnly(scene) {
  return scene.triangles.map((triangle) => triangle.vertices);
}

function albedoOnly(scene) {
  return scene.triangles.map((triangle) => triangle.albedo);
}

function bandGridHash(runtime, grid) {
  return runtime.hashValue({
    schema: grid.schema,
    bandSourceHash: grid.bandSourceHash,
    distanceSourceHash: grid.distanceSourceHash,
    distanceGridHash: grid.distanceGridHash,
    width: grid.width,
    height: grid.height,
    values: grid.values,
  });
}

function weightedSetHash(runtime, set) {
  return runtime.hashValue({
    schema: set.schema,
    weightSourceHash: set.weightSourceHash,
    particleSourceHash: set.particleSourceHash,
    distanceBandSourceHash: set.distanceBandSourceHash,
    bandGridHash: set.bandGridHash,
    particleCount: set.particleCount,
    samples: set.samples,
  });
}

function graphWithResolution(graph, width, height, maxParticles, maxBandCells, maxComparisons) {
  return {
    ...graph,
    stages: graph.stages.map((stage) => {
      if (stage.hand === "fx.field.coverage-mask-grid-build") return { ...stage, params: { width, height, maxCells: Math.max(width * height, 16) } };
      if (stage.hand === "fx.field.mask-distance-grid-build") return { ...stage, params: { maxCells: maxBandCells, maxComparisons } };
      if (stage.hand === "fx.field.mask-distance-band-grid-build") return { ...stage, params: { maxCells: maxBandCells, maxComparisons } };
      if (stage.hand === "fx.particle.distance-band-weight-build") return { ...stage, params: { maxParticles, maxBandCells, maxComparisons } };
      return stage;
    }),
  };
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

export async function observeVisualEffectDistanceBandParticleWeightFamiliesNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    particles: resolve(rootPath, "hand-lab/src/distance-band-particle-weights.mjs"),
    band: resolve(rootPath, "hand-lab/src/mask-distance-band2d.mjs"),
    distance: resolve(rootPath, "hand-lab/src/mask-distance-field2d.mjs"),
    mask: resolve(rootPath, "hand-lab/src/field-mask-operators.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const particleModule = await import(`${pathToFileURL(paths.particles).href}?sha=${sources.particles.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_HANDS)
    || !Array.isArray(particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_HANDS)
    || !particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH
    || !particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH
    || typeof particleModule.makeDistanceBandParticleWeightState !== "function"
    || typeof particleModule.makeCellularDistanceBandParticleWeightState !== "function"
    || typeof particleModule.buildDistanceBandParticleWeightSetHand?.execute !== "function") {
    throw new Error("VFX multi-family distance-band particle-weight donor is unavailable");
  }
  if (particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.id !== "fx.particle.distance-band-weight2d" || particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX fBm distance-band particle-weight graph identity");
  if (particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.id !== "fx.particle.distance-band-weight2d-cellular" || particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX cellular distance-band particle-weight graph identity");

  const particles = particleFixture();
  const sharedMask = { id: "creative-render-particle-mask", threshold: 0.5, softness: 0.1, invert: false };
  const sharedDistance = { id: "creative-render-particle-distance", maskId: sharedMask.id, isoLevel: 0.5 };
  const sharedBand = { id: "creative-render-particle-band", distanceId: sharedDistance.id, innerWidth: 0.1, outerWidth: 0.15, softness: 0.03 };
  const sharedWeight = { id: "creative-render-weighted-particles", bandId: sharedBand.id, exponent: 1.3 };
  const specifications = {
    fbm: {
      family: "fbm-value-noise-2d",
      hands: particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_HANDS,
      graph: particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH,
      initial: particleModule.makeDistanceBandParticleWeightState(particles, {
        field: { id: "creative-render-particle-field", seed: 317, frequency: 4.35, octaves: 5, lacunarity: 2, gain: 0.53, offset: [0.09, -0.17] },
        mask: sharedMask,
        distance: sharedDistance,
        band: sharedBand,
        weight: sharedWeight,
      }),
      requestKey: "fieldRequest",
      sourceKey: "fieldSource",
      sourceHashKey: "fieldSourceHash",
      sourceSchema: "axm.scalar-field-source/v0.1",
    },
    cellular: {
      family: "cellular-nearest-feature-2d",
      hands: particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_HANDS,
      graph: particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH,
      initial: particleModule.makeCellularDistanceBandParticleWeightState(particles, {
        field: { id: "creative-render-particle-field", seed: 317, frequency: 4.35, jitter: 0.84, offset: [0.09, -0.17], valueMode: "distance" },
        mask: sharedMask,
        distance: sharedDistance,
        band: sharedBand,
        weight: sharedWeight,
      }),
      requestKey: "cellularFieldRequest",
      sourceKey: "cellularFieldSource",
      sourceHashKey: "cellularFieldSourceHash",
      sourceSchema: "axm.cellular-field-source/v0.1",
    },
  };

  const variants = {};
  for (const [name, spec] of Object.entries(specifications)) {
    const requestBytes = stableBytes({
      field: spec.initial[spec.requestKey],
      mask: spec.initial.maskRequest,
      distance: spec.initial.maskDistanceRequest,
      band: spec.initial.distanceBandRequest,
      weight: spec.initial.bandParticleWeightRequest,
      particles: spec.initial.particles,
    });
    const registry = runtime.createHandRegistry(spec.hands);
    const execute = (callerKind, graph = spec.graph) => runtime.executeHandGraph({ registry, graph, initialState: spec.initial, context: { callerKind } });
    const human = execute("human");
    const machine = execute("machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${name} distance-band particle caller-neutral replay failed`);
    const state = human.finalState;
    if (stableBytes({
      field: state[spec.requestKey],
      mask: state.maskRequest,
      distance: state.maskDistanceRequest,
      band: state.distanceBandRequest,
      weight: state.bandParticleWeightRequest,
      particles: state.particles,
    }).compare(requestBytes) !== 0) throw new Error(`${name} distance-band particle caller request/source particles mutated`);

    const source = state[spec.sourceKey];
    const sourceHash = state[spec.sourceHashKey];
    const maskSource = state.coverageMaskSource;
    const maskSourceHash = state.coverageMaskSourceHash;
    const distanceSource = state.maskDistanceSource;
    const distanceSourceHash = state.maskDistanceSourceHash;
    const bandSource = state.distanceBandSource;
    const bandSourceHash = state.distanceBandSourceHash;
    const particleSourceHash = state.particleSourceHash;
    const weightSource = state.bandParticleWeightSource;
    const weightSourceHash = state.bandParticleWeightSourceHash;
    const distanceGrid = state.signedMaskDistanceGrids?.[distanceSource?.id];
    const bandGrid = state.distanceBandGrids?.[bandSource?.id];
    const weightSet = state.bandWeightedParticleSets?.[weightSource?.id];

    if (!source || source.schema !== spec.sourceSchema || runtime.hashValue(source) !== sourceHash) throw new Error(`${name} retained scalar source identity drifted`);
    if (!maskSource || maskSource.schema !== "axm.coverage-mask-source/v0.1" || runtime.hashValue(maskSource) !== maskSourceHash || maskSource.fieldSourceHash !== sourceHash) throw new Error(`${name} retained mask source lineage drifted`);
    if (!distanceSource || distanceSource.schema !== "axm.mask-distance-source/v0.1" || runtime.hashValue(distanceSource) !== distanceSourceHash || distanceSource.maskSourceHash !== maskSourceHash) throw new Error(`${name} retained distance source lineage drifted`);
    if (!bandSource || bandSource.schema !== "axm.mask-distance-band-source/v0.1" || runtime.hashValue(bandSource) !== bandSourceHash || bandSource.distanceSourceHash !== distanceSourceHash) throw new Error(`${name} retained band source lineage drifted`);
    if (runtime.hashValue(state.particles) !== particleSourceHash || particleSourceHash !== runtime.hashValue(particles) || state.particles[0]?.tag !== "caller-source-metadata-preserved") throw new Error(`${name} retained particle source identity drifted`);
    if (!weightSource || weightSource.schema !== "axm.distance-band-particle-weight-source/v0.1" || runtime.hashValue(weightSource) !== weightSourceHash) throw new Error(`${name} retained particle-weight source identity drifted`);
    if (weightSource.particleSourceHash !== particleSourceHash || weightSource.distanceBandSourceHash !== bandSourceHash || weightSource.bandId !== bandSource.id || weightSource.particleCount !== particles.length || weightSource.weightTransform !== "band-coverage-power-v0.1" || weightSource.exponent !== sharedWeight.exponent) throw new Error(`${name} retained particle-weight source semantics drifted`);
    if (!distanceGrid || !Number.isInteger(distanceGrid.comparisonCount) || distanceGrid.comparisonCount < 1) throw new Error(`${name} signed-distance rebuild evidence unavailable`);
    if (!bandGrid || bandGrid.schema !== "axm.distance-band-grid/v0.1" || bandGrid.bandSourceHash !== bandSourceHash || bandGrid.width !== 48 || bandGrid.height !== 32 || bandGrid.values.length !== 1536 || bandGrid.bandGridHash !== bandGridHash(runtime, bandGrid)) throw new Error(`${name} distance-band grid identity drifted`);
    if (!weightSet || weightSet.schema !== "axm.distance-band-particle-weight-set/v0.1" || weightSet.derived !== true || weightSet.rebuildable !== true) throw new Error(`${name} derived particle-weight set boundary drifted`);
    if (weightSet.weightSourceHash !== weightSourceHash || weightSet.particleSourceHash !== particleSourceHash || weightSet.distanceBandSourceHash !== bandSourceHash || weightSet.bandGridHash !== bandGrid.bandGridHash || weightSet.particleCount !== particles.length || weightSet.weightedSetHash !== weightedSetHash(runtime, weightSet)) throw new Error(`${name} particle-weight set lineage/identity drifted`);
    if (weightSet.samples.length !== particles.length || weightSet.samples.some((sample, index) => sample.particleId !== particles[index].id || sample.x !== particles[index].x || sample.y !== particles[index].y || !Number.isFinite(sample.weight) || sample.weight < 0 || sample.weight > 1)) throw new Error(`${name} particle-weight samples no longer preserve retained source positions`);

    const exact = particleModule.buildDistanceBandParticleWeightSetHand.execute(state, {
      maxParticles: particles.length,
      maxBandCells: 1536,
      maxComparisons: distanceGrid.comparisonCount,
    }).state.bandWeightedParticleSets[weightSource.id];
    const roomy = particleModule.buildDistanceBandParticleWeightSetHand.execute(state, {
      maxParticles: 4096,
      maxBandCells: 4096,
      maxComparisons: 8388608,
    }).state.bandWeightedParticleSets[weightSource.id];
    if (exact.weightedSetHash !== weightSet.weightedSetHash || roomy.weightedSetHash !== weightSet.weightedSetHash) throw new Error(`${name} sufficient execution budgets changed particle-weight truth`);

    let particleBudgetFailure = null;
    let bandCellBudgetFailure = null;
    let comparisonBudgetFailure = null;
    try { particleModule.buildDistanceBandParticleWeightSetHand.execute(state, { maxParticles: particles.length - 1, maxBandCells: 1536, maxComparisons: 8388608 }); } catch (error) { particleBudgetFailure = String(error?.message || error); }
    try { particleModule.buildDistanceBandParticleWeightSetHand.execute(state, { maxParticles: 4096, maxBandCells: 1535, maxComparisons: 8388608 }); } catch (error) { bandCellBudgetFailure = String(error?.message || error); }
    try { particleModule.buildDistanceBandParticleWeightSetHand.execute(state, { maxParticles: 4096, maxBandCells: 1536, maxComparisons: distanceGrid.comparisonCount - 1 }); } catch (error) { comparisonBudgetFailure = String(error?.message || error); }
    if (!particleBudgetFailure?.includes("distanceBandParticle particle budget exceeded")) throw new Error(`${name} insufficient particle budget did not fail loudly`);
    if (!bandCellBudgetFailure?.includes("distanceBandParticle band cell budget exceeded")) throw new Error(`${name} insufficient band-grid budget did not fail loudly`);
    if (!comparisonBudgetFailure?.includes("maskDistance comparison budget exceeded")) throw new Error(`${name} insufficient source-truth comparison budget did not fail loudly`);

    const lowerGraph = graphWithResolution(spec.graph, 24, 16, 4096, 384, 8388608);
    const lowerState = execute("machine", lowerGraph).finalState;
    const lowerWeightSource = lowerState.bandParticleWeightSource;
    const lowerBandGrid = lowerState.distanceBandGrids[lowerState.distanceBandSource.id];
    const lowerWeightSet = lowerState.bandWeightedParticleSets[lowerWeightSource.id];
    if (runtime.hashValue(lowerWeightSource) !== weightSourceHash || lowerState.particleSourceHash !== particleSourceHash || lowerState.distanceBandSourceHash !== bandSourceHash) throw new Error(`${name} sampling-resolution rebuild rewrote retained particle-weight/source truth`);
    if (lowerBandGrid.width !== 24 || lowerBandGrid.height !== 16 || lowerBandGrid.bandGridHash === bandGrid.bandGridHash) throw new Error(`${name} sampling-resolution rebuild did not remain separately derived`);
    if (lowerWeightSet.weightSourceHash !== weightSourceHash || lowerWeightSet.bandGridHash !== lowerBandGrid.bandGridHash) throw new Error(`${name} lower-resolution particle weights lost retained source lineage`);

    const tampered = structuredClone(state);
    const tamperedGrid = tampered.distanceBandGrids[bandSource.id];
    tamperedGrid.values[0] = tamperedGrid.values[0] > 0.5 ? 0.25 : 0.75;
    tamperedGrid.bandGridHash = bandGridHash(runtime, tamperedGrid);
    let tamperFailure = null;
    try { particleModule.buildDistanceBandParticleWeightSetHand.execute(tampered, { maxParticles: 4096, maxBandCells: 4096, maxComparisons: 8388608 }); } catch (error) { tamperFailure = String(error?.message || error); }
    if (!tamperFailure?.includes("distance-band particle grid differs from source-truth rebuild")) throw new Error(`${name} self-consistent derived band-grid tampering was not rejected`);
    if (runtime.hashValue(state[spec.sourceKey]) !== sourceHash || runtime.hashValue(state.coverageMaskSource) !== maskSourceHash || runtime.hashValue(state.maskDistanceSource) !== distanceSourceHash || runtime.hashValue(state.distanceBandSource) !== bandSourceHash || runtime.hashValue(state.particles) !== particleSourceHash || runtime.hashValue(state.bandParticleWeightSource) !== weightSourceHash) throw new Error(`${name} failed challenges rewrote retained source state`);

    const adapted = distanceBandParticleWeightSetToAxmScene(weightSet);
    variants[name] = {
      family: spec.family,
      requestBytes,
      source, sourceHash, sourceBytes: stableBytes(source),
      maskSource, maskSourceHash, maskSourceBytes: stableBytes(maskSource),
      distanceSource, distanceSourceHash, distanceSourceBytes: stableBytes(distanceSource),
      bandSource, bandSourceHash, bandSourceBytes: stableBytes(bandSource),
      particles: state.particles, particleSourceHash, particleBytes: stableBytes(state.particles),
      weightSource, weightSourceHash, weightSourceBytes: stableBytes(weightSource),
      distanceGrid, bandGrid, bandGridBytes: stableBytes(bandGrid),
      weightSet, weightSetBytes: stableBytes(weightSet),
      adapted,
      finalStateHash: human.finalStateHash,
      lowerResolution: {
        width: lowerBandGrid.width,
        height: lowerBandGrid.height,
        bandGridHash: lowerBandGrid.bandGridHash,
        weightedSetHash: lowerWeightSet.weightedSetHash,
        sameWeightSourceHash: runtime.hashValue(lowerWeightSource) === weightSourceHash,
        sameParticleSourceHash: lowerState.particleSourceHash === particleSourceHash,
      },
      particleBudgetFailure,
      bandCellBudgetFailure,
      comparisonBudgetFailure,
      tamperFailure,
    };
  }

  if (variants.fbm.weightSet.schema !== variants.cellular.weightSet.schema) throw new Error("source families do not share the generic particle-weight-set contract");
  if (variants.fbm.particleSourceHash !== variants.cellular.particleSourceHash) throw new Error("shared caller particle source drifted across source families");
  if (variants.fbm.weightSource.weightTransform !== variants.cellular.weightSource.weightTransform || variants.fbm.weightSource.exponent !== variants.cellular.weightSource.exponent) throw new Error("shared particle-weight treatment drifted across source families");
  if (variants.fbm.sourceHash === variants.cellular.sourceHash || variants.fbm.bandSourceHash === variants.cellular.bandSourceHash || variants.fbm.weightSet.weightedSetHash === variants.cellular.weightSet.weightedSetHash) throw new Error("distinct source families collapsed to identical retained/derived identities");
  if (JSON.stringify(variants.fbm.weightSet.samples.map((sample) => sample.weight)) === JSON.stringify(variants.cellular.weightSet.samples.map((sample) => sample.weight))) throw new Error("distinct source families collapsed to identical particle weights");
  if (JSON.stringify(geometryOnly(variants.fbm.adapted.scene)) !== JSON.stringify(geometryOnly(variants.cellular.adapted.scene))) throw new Error("source family leaked into weighted-particle observation geometry");
  if (JSON.stringify(albedoOnly(variants.fbm.adapted.scene)) === JSON.stringify(albedoOnly(variants.cellular.adapted.scene))) throw new Error("distinct particle weights collapsed to identical observation albedo");

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      files: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, value.sha256])),
      graphs: {
        fbm: { id: particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.id, version: particleModule.DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.version },
        cellular: { id: particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.id, version: particleModule.CELLULAR_DISTANCE_BAND_PARTICLE_WEIGHT_GRAPH.version },
      },
    },
    shared_contract: {
      mask: sharedMask,
      distance: sharedDistance,
      band: sharedBand,
      weight: sharedWeight,
      particle_count: particles.length,
      derived_schema: "axm.distance-band-particle-weight-set/v0.1",
      weight_transform: "band-coverage-power-v0.1",
      source_family_branching: false,
    },
    variants: Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
      family: row.family,
      request_sha256: sha256(row.requestBytes),
      source: { hash: row.sourceHash, bytes_sha256: sha256(row.sourceBytes), schema: row.source.schema },
      mask_source: { hash: row.maskSourceHash, bytes_sha256: sha256(row.maskSourceBytes) },
      distance_source: { hash: row.distanceSourceHash, bytes_sha256: sha256(row.distanceSourceBytes), comparisons: row.distanceGrid.comparisonCount },
      band_source: { hash: row.bandSourceHash, bytes_sha256: sha256(row.bandSourceBytes) },
      particle_source: { hash: row.particleSourceHash, bytes_sha256: sha256(row.particleBytes), count: row.particles.length },
      weight_source: { hash: row.weightSourceHash, bytes_sha256: sha256(row.weightSourceBytes), transform: row.weightSource.weightTransform, exponent: row.weightSource.exponent },
      band_grid: { hash: row.bandGrid.bandGridHash, bytes_sha256: sha256(row.bandGridBytes), width: row.bandGrid.width, height: row.bandGrid.height },
      weighted_set: {
        hash: row.weightSet.weightedSetHash,
        bytes_sha256: sha256(row.weightSetBytes),
        particle_count: row.weightSet.particleCount,
        min_weight: row.weightSet.minWeight,
        max_weight: row.weightSet.maxWeight,
        mean_weight: row.weightSet.meanWeight,
        zero_weight_count: row.weightSet.zeroWeightCount,
        full_weight_count: row.weightSet.fullWeightCount,
      },
      lower_resolution_rebuild: row.lowerResolution,
      gates: {
        caller_neutral_replay: true,
        retained_particle_source_unchanged: true,
        sufficient_budgets_noncreative: true,
        insufficient_particle_budget_failed: row.particleBudgetFailure,
        insufficient_band_cell_budget_failed: row.bandCellBudgetFailure,
        insufficient_comparison_budget_failed: row.comparisonBudgetFailure,
        self_consistent_derived_band_tamper_failed: row.tamperFailure,
      },
      native_scene: { bytes_sha256: sha256(row.adapted.bytes), triangles: row.adapted.scene.triangles.length, adapter: row.adapted.observation },
    }])),
    comparison: {
      particle_source_hash_identical: variants.fbm.particleSourceHash === variants.cellular.particleSourceHash,
      source_hashes_differ: variants.fbm.sourceHash !== variants.cellular.sourceHash,
      band_source_hashes_differ: variants.fbm.bandSourceHash !== variants.cellular.bandSourceHash,
      weighted_set_hashes_differ: variants.fbm.weightSet.weightedSetHash !== variants.cellular.weightSet.weightedSetHash,
      weight_samples_differ: JSON.stringify(variants.fbm.weightSet.samples.map((sample) => sample.weight)) !== JSON.stringify(variants.cellular.weightSet.samples.map((sample) => sample.weight)),
      native_geometry_identical: true,
      native_albedo_differs: true,
      native_scene_bytes_differ: sha256(variants.fbm.adapted.bytes) !== sha256(variants.cellular.adapted.bytes),
    },
    authority: {
      canonical_scalar_sources_remain_authoritative: true,
      coverage_transfer_sources_remain_authoritative: true,
      mask_distance_sources_remain_authoritative: true,
      mask_distance_band_sources_remain_authoritative: true,
      caller_particle_source_remains_authoritative: true,
      particle_weight_sources_remain_authoritative: true,
      derived_band_grids_are_canonical: false,
      derived_particle_weight_sets_are_canonical: false,
      native_scenes_are_canonical: false,
      consumer_semantics_assigned: false,
      source_truth_rebuild_rejects_derived_band_tampering: true,
    },
    truth_boundary: {
      proven: "two retained scalar-source families can feed one source-honest distance-band particle-weight contract over the same caller-owned particle positions, and one source-family-neutral replaceable native observer can carry the derived neutral weights into renderer evidence without absorbing opacity, size, emission, gameplay, UI, or world semantics",
      not_proven: ["particle aesthetics", "edge-spark or mote quality", "opacity or size semantics", "emission behavior", "animation feel", "compositing quality", "anti-aliasing quality", "accessibility", "GPU or browser equivalence", "real-time performance", "cross-machine bitwise determinism"],
    },
  };

  return { receipt, variants };
}
