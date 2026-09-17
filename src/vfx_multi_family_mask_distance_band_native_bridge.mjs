import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_MULTI_FAMILY_MASK_DISTANCE_BAND_NATIVE_RECEIPT";
const VERSION = 1;
const DISPLAY_MIN = 24;
const DISPLAY_RANGE = 216;

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

function finiteCoverage(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be finite within [0,1]`);
  return number;
}

function pointToScene(u, v) {
  return [(u - 0.5) * 1.8, (0.5 - v) * 1.8, 0];
}

function grayForCoverage(value) {
  return DISPLAY_MIN + Math.round(finiteCoverage(value, "band coverage") * DISPLAY_RANGE);
}

export function distanceBandGridToAxmScene(grid) {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) throw new Error("distance-band native adapter requires a grid object");
  if (grid.schema !== "axm.distance-band-grid/v0.1") throw new Error("distance-band native adapter requires axm.distance-band-grid/v0.1");
  if (grid.derived !== true || grid.rebuildable !== true) throw new Error("distance-band native adapter accepts only derived rebuildable grids");
  for (const key of ["bandSourceHash", "distanceSourceHash", "distanceGridHash", "bandGridHash"]) {
    if (!String(grid[key] || "").trim()) throw new Error(`distance-band native adapter requires ${key}`);
  }
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || grid.width > 128 || grid.height > 128) {
    throw new Error("distance-band native adapter requires a bounded 2D grid within 2..128 per axis");
  }
  if (!Array.isArray(grid.values) || grid.values.length !== grid.width * grid.height) throw new Error("distance-band native adapter value cardinality mismatch");

  const values = grid.values.map((value, index) => finiteCoverage(value, `band value[${index}]`));
  const actualMin = Math.min(...values);
  const actualMax = Math.max(...values);
  const actualMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const fullCells = values.filter((value) => value === 1).length;
  const zeroCells = values.filter((value) => value === 0).length;
  if (![grid.min, grid.max, grid.mean].every(Number.isFinite)) throw new Error("distance-band native adapter requires retained min/max/mean evidence");
  if (Math.abs(Number(grid.min) - actualMin) > 1e-6 || Math.abs(Number(grid.max) - actualMax) > 1e-6 || Math.abs(Number(grid.mean) - actualMean) > 1e-6) {
    throw new Error("distance-band native adapter summary evidence does not match retained values");
  }
  if (grid.fullCells !== fullCells || grid.zeroCells !== zeroCells) throw new Error("distance-band native adapter retained cell counts do not match values");

  const triangles = [];
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const index = row * grid.width + column;
      const shade = grayForCoverage(values[index]);
      const albedo = [shade, shade, shade];
      const u0 = column / grid.width;
      const u1 = (column + 1) / grid.width;
      const v0 = row / grid.height;
      const v1 = (row + 1) / grid.height;
      const a = pointToScene(u0, v0);
      const b = pointToScene(u1, v0);
      const c = pointToScene(u1, v1);
      const d = pointToScene(u0, v1);
      triangles.push(
        { vertices: [a, b, c], albedo: [...albedo] },
        { vertices: [a, c, d], albedo: [...albedo] },
      );
    }
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  if (parseScene(bytes.toString("utf8")).triangles.length !== values.length * 2) throw new Error("distance-band native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-distance-band-grid-to-axm-scene/v1",
      input_schema: grid.schema,
      band_source_hash: grid.bandSourceHash,
      distance_source_hash: grid.distanceSourceHash,
      distance_grid_hash: grid.distanceGridHash,
      band_grid_hash: grid.bandGridHash,
      width: grid.width,
      height: grid.height,
      input_cells: values.length,
      output_contract: "AXM_SCENE 1",
      output_triangles: triangles.length,
      geometry_mapping: "one derived distance-band cell -> one planar two-triangle square",
      display_transfer: "derived neutral coverage 0..1 -> neutral grayscale 24..240",
      source_family_branching: false,
      consumer_semantics_assigned: false,
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

function distanceGridHash(runtime, grid) {
  return runtime.hashValue({
    schema: grid.schema,
    distanceSourceHash: grid.distanceSourceHash,
    maskSourceHash: grid.maskSourceHash,
    maskHash: grid.maskHash,
    width: grid.width,
    height: grid.height,
    values: grid.values,
  });
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

export async function observeVisualEffectMaskDistanceBandFamiliesNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    band: resolve(rootPath, "hand-lab/src/mask-distance-band2d.mjs"),
    distance: resolve(rootPath, "hand-lab/src/mask-distance-field2d.mjs"),
    mask: resolve(rootPath, "hand-lab/src/field-mask-operators.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const band = await import(`${pathToFileURL(paths.band).href}?sha=${sources.band.sha256}`);
  const distance = await import(`${pathToFileURL(paths.distance).href}?sha=${sources.distance.sha256}`);
  const mask = await import(`${pathToFileURL(paths.mask).href}?sha=${sources.mask.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(band.MASK_DISTANCE_BAND_HANDS) || !Array.isArray(band.CELLULAR_MASK_DISTANCE_BAND_HANDS)
    || !band.MASK_DISTANCE_BAND_GRAPH || !band.CELLULAR_MASK_DISTANCE_BAND_GRAPH
    || typeof band.makeMaskDistanceBandState !== "function" || typeof band.makeCellularMaskDistanceBandState !== "function"
    || typeof band.buildMaskDistanceBandGridHand?.execute !== "function" || typeof band.sampleMaskDistanceBandGrid !== "function"
    || typeof band.bandCoverageFromSignedDistance !== "function"
    || typeof distance.buildSignedMaskDistanceGridHand?.execute !== "function"
    || typeof mask.buildCoverageMaskGridHand?.execute !== "function") {
    throw new Error("VFX multi-family mask-distance-band donor is unavailable");
  }
  if (band.MASK_DISTANCE_BAND_GRAPH.id !== "fx.field.mask-distance-band2d" || band.MASK_DISTANCE_BAND_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX fBm mask-distance-band graph identity");
  if (band.CELLULAR_MASK_DISTANCE_BAND_GRAPH.id !== "fx.field.mask-distance-band2d-cellular" || band.CELLULAR_MASK_DISTANCE_BAND_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX cellular mask-distance-band graph identity");

  const sharedMask = { id: "creative-render-band-mask", threshold: 0.5, softness: 0.1, invert: false };
  const sharedDistance = { id: "creative-render-band-distance", maskId: sharedMask.id, isoLevel: 0.5 };
  const sharedBand = { id: "creative-render-distance-band", distanceId: sharedDistance.id, innerWidth: 0.05, outerWidth: 0.1, softness: 0.03 };
  const specifications = {
    fbm: {
      family: "fbm-value-noise-2d",
      hands: band.MASK_DISTANCE_BAND_HANDS,
      graph: band.MASK_DISTANCE_BAND_GRAPH,
      initial: band.makeMaskDistanceBandState({
        field: { id: "creative-render-band-field", seed: 317, frequency: 4.35, octaves: 5, lacunarity: 2, gain: 0.53, offset: [0.09, -0.17] },
        mask: sharedMask,
        distance: sharedDistance,
        band: sharedBand,
      }),
      requestKey: "fieldRequest",
      sourceKey: "fieldSource",
      sourceHashKey: "fieldSourceHash",
      sourceSchema: "axm.scalar-field-source/v0.1",
    },
    cellular: {
      family: "cellular-nearest-feature-2d",
      hands: band.CELLULAR_MASK_DISTANCE_BAND_HANDS,
      graph: band.CELLULAR_MASK_DISTANCE_BAND_GRAPH,
      initial: band.makeCellularMaskDistanceBandState({
        field: { id: "creative-render-band-field", seed: 317, frequency: 4.35, jitter: 0.84, offset: [0.09, -0.17], valueMode: "distance" },
        mask: sharedMask,
        distance: sharedDistance,
        band: sharedBand,
      }),
      requestKey: "cellularFieldRequest",
      sourceKey: "cellularFieldSource",
      sourceHashKey: "cellularFieldSourceHash",
      sourceSchema: "axm.cellular-field-source/v0.1",
    },
  };

  const variants = {};
  for (const [name, spec] of Object.entries(specifications)) {
    const requestBytes = stableBytes({ field: spec.initial[spec.requestKey], mask: spec.initial.maskRequest, distance: spec.initial.maskDistanceRequest, band: spec.initial.distanceBandRequest });
    const registry = runtime.createHandRegistry(spec.hands);
    const execute = (callerKind) => runtime.executeHandGraph({ registry, graph: spec.graph, initialState: spec.initial, context: { callerKind } });
    const human = execute("human");
    const machine = execute("machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${name} mask-distance-band caller-neutral replay failed`);
    const state = human.finalState;
    if (stableBytes({ field: state[spec.requestKey], mask: state.maskRequest, distance: state.maskDistanceRequest, band: state.distanceBandRequest }).compare(requestBytes) !== 0) throw new Error(`${name} mask-distance-band caller request mutated`);

    const source = state[spec.sourceKey];
    const sourceHash = state[spec.sourceHashKey];
    const maskSource = state.coverageMaskSource;
    const maskSourceHash = state.coverageMaskSourceHash;
    const distanceSource = state.maskDistanceSource;
    const distanceSourceHash = state.maskDistanceSourceHash;
    const bandSource = state.distanceBandSource;
    const bandSourceHash = state.distanceBandSourceHash;
    const coverageGrid = state.coverageMasks?.[maskSource?.id];
    const distanceGrid = state.signedMaskDistanceGrids?.[distanceSource?.id];
    const grid = state.distanceBandGrids?.[bandSource?.id];

    if (!source || source.schema !== spec.sourceSchema || runtime.hashValue(source) !== sourceHash) throw new Error(`${name} retained scalar source identity drifted`);
    if (!maskSource || maskSource.schema !== "axm.coverage-mask-source/v0.1" || runtime.hashValue(maskSource) !== maskSourceHash || maskSource.fieldSourceHash !== sourceHash) throw new Error(`${name} retained mask source lineage drifted`);
    if (!distanceSource || distanceSource.schema !== "axm.mask-distance-source/v0.1" || runtime.hashValue(distanceSource) !== distanceSourceHash || distanceSource.maskSourceHash !== maskSourceHash) throw new Error(`${name} retained distance source lineage drifted`);
    if (!bandSource || bandSource.schema !== "axm.mask-distance-band-source/v0.1" || runtime.hashValue(bandSource) !== bandSourceHash || bandSource.distanceSourceHash !== distanceSourceHash) throw new Error(`${name} retained band source lineage drifted`);
    if (bandSource.innerWidth !== sharedBand.innerWidth || bandSource.outerWidth !== sharedBand.outerWidth || bandSource.softness !== sharedBand.softness) throw new Error(`${name} retained band treatment drifted`);
    if (!coverageGrid || coverageGrid.schema !== "axm.coverage-mask-grid/v0.1" || coverageGrid.maskSourceHash !== maskSourceHash) throw new Error(`${name} coverage grid lineage drifted`);
    if (!distanceGrid || distanceGrid.schema !== "axm.signed-mask-distance-grid/v0.1" || distanceGrid.distanceSourceHash !== distanceSourceHash || distanceGrid.distanceGridHash !== distanceGridHash(runtime, distanceGrid)) throw new Error(`${name} signed-distance grid identity drifted`);
    if (!grid || grid.schema !== "axm.distance-band-grid/v0.1" || grid.bandSourceHash !== bandSourceHash || grid.distanceSourceHash !== distanceSourceHash || grid.distanceGridHash !== distanceGrid.distanceGridHash || grid.derived !== true || grid.rebuildable !== true) throw new Error(`${name} distance-band grid lineage drifted`);
    if (grid.width !== 48 || grid.height !== 32 || grid.values.length !== 1536 || bandGridHash(runtime, grid) !== grid.bandGridHash) throw new Error(`${name} distance-band grid identity drifted`);

    const positiveProbe = band.bandCoverageFromSignedDistance(bandSource, 0.08);
    const negativeProbe = band.bandCoverageFromSignedDistance(bandSource, -0.08);
    if (!(negativeProbe > positiveProbe)) throw new Error(`${name} asymmetric inner/outer band treatment is no longer observable`);

    const exact = band.buildMaskDistanceBandGridHand.execute(state, { maxCells: 1536, maxComparisons: distanceGrid.comparisonCount }).state.distanceBandGrids[bandSource.id];
    const roomy = band.buildMaskDistanceBandGridHand.execute(state, { maxCells: 4096, maxComparisons: 8388608 }).state.distanceBandGrids[bandSource.id];
    if (exact.bandGridHash !== grid.bandGridHash || roomy.bandGridHash !== grid.bandGridHash) throw new Error(`${name} sufficient execution budgets changed distance-band truth`);

    let cellBudgetFailure = null;
    let comparisonBudgetFailure = null;
    try { band.buildMaskDistanceBandGridHand.execute(state, { maxCells: 1535, maxComparisons: 8388608 }); } catch (error) { cellBudgetFailure = String(error?.message || error); }
    try { band.buildMaskDistanceBandGridHand.execute(state, { maxCells: 1536, maxComparisons: distanceGrid.comparisonCount - 1 }); } catch (error) { comparisonBudgetFailure = String(error?.message || error); }
    if (!cellBudgetFailure?.includes("maskDistanceBand cell budget exceeded")) throw new Error(`${name} insufficient band cell budget did not fail loudly`);
    if (!comparisonBudgetFailure?.includes("maskDistance comparison budget exceeded")) throw new Error(`${name} insufficient truth-rebuild comparison budget did not fail loudly`);

    const lowerMaskState = mask.buildCoverageMaskGridHand.execute(state, { width: 24, height: 16, maxCells: 384 }).state;
    const lowerDistanceState = distance.buildSignedMaskDistanceGridHand.execute(lowerMaskState, { maxCells: 384, maxComparisons: 8388608 }).state;
    const lowerBandState = band.buildMaskDistanceBandGridHand.execute(lowerDistanceState, { maxCells: 384, maxComparisons: 8388608 }).state;
    const lowerGrid = lowerBandState.distanceBandGrids[bandSource.id];
    if (runtime.hashValue(lowerBandState.distanceBandSource) !== bandSourceHash || lowerGrid.bandSourceHash !== bandSourceHash) throw new Error(`${name} rebuild resolution rewrote retained band source`);
    if (lowerGrid.bandGridHash === grid.bandGridHash || lowerGrid.width !== 24 || lowerGrid.height !== 16) throw new Error(`${name} rebuild resolution did not remain separately derived`);

    const tampered = structuredClone(state);
    const tamperedDistance = tampered.signedMaskDistanceGrids[distanceSource.id];
    const originalValue = Number(tamperedDistance.values[0]);
    tamperedDistance.values[0] = Number((originalValue + (originalValue >= 0 ? -0.031 : 0.031)).toFixed(6));
    tamperedDistance.distanceGridHash = distanceGridHash(runtime, tamperedDistance);
    let tamperFailure = null;
    try { band.buildMaskDistanceBandGridHand.execute(tampered, { maxCells: 1536, maxComparisons: 8388608 }); } catch (error) { tamperFailure = String(error?.message || error); }
    if (!tamperFailure?.includes("differs from source-truth rebuild")) throw new Error(`${name} self-consistent derived distance tampering was not rejected`);
    if (runtime.hashValue(state[spec.sourceKey]) !== sourceHash || runtime.hashValue(state.coverageMaskSource) !== maskSourceHash || runtime.hashValue(state.maskDistanceSource) !== distanceSourceHash || runtime.hashValue(state.distanceBandSource) !== bandSourceHash) throw new Error(`${name} failed challenges rewrote retained source state`);

    const samplePoints = [[0, 0], [0.25, 0.5], [0.5, 0.5], [0.75, 0.125], [1, 1]];
    const genericSamples = samplePoints.map(([u, v]) => ({ u, v, value: band.sampleMaskDistanceBandGrid(grid, u, v) }));
    if (genericSamples.some((sample) => !Number.isFinite(sample.value) || sample.value < 0 || sample.value > 1)) throw new Error(`${name} generic distance-band sampler failed`);

    const adapted = distanceBandGridToAxmScene(grid);
    variants[name] = {
      family: spec.family,
      requestBytes,
      source, sourceHash, sourceBytes: stableBytes(source),
      maskSource, maskSourceHash, maskSourceBytes: stableBytes(maskSource),
      distanceSource, distanceSourceHash, distanceSourceBytes: stableBytes(distanceSource),
      bandSource, bandSourceHash, bandSourceBytes: stableBytes(bandSource),
      coverageGrid, coverageGridBytes: stableBytes(coverageGrid),
      distanceGrid, distanceGridBytes: stableBytes(distanceGrid),
      grid, gridBytes: stableBytes(grid),
      adapted,
      genericSamples,
      asymmetryProbe: { positive_0_08: positiveProbe, negative_0_08: negativeProbe },
      finalStateHash: human.finalStateHash,
      lowerResolution: { width: lowerGrid.width, height: lowerGrid.height, bandGridHash: lowerGrid.bandGridHash, sameBandSourceHash: lowerGrid.bandSourceHash === bandSourceHash },
      cellBudgetFailure,
      comparisonBudgetFailure,
      tamperFailure,
    };
  }

  if (variants.fbm.grid.schema !== variants.cellular.grid.schema) throw new Error("source families do not share the generic distance-band-grid contract");
  if (variants.fbm.bandSource.innerWidth !== variants.cellular.bandSource.innerWidth || variants.fbm.bandSource.outerWidth !== variants.cellular.bandSource.outerWidth || variants.fbm.bandSource.softness !== variants.cellular.bandSource.softness) throw new Error("shared distance-band treatment drifted across source families");
  if (variants.fbm.sourceHash === variants.cellular.sourceHash || variants.fbm.grid.bandGridHash === variants.cellular.grid.bandGridHash) throw new Error("distinct source families collapsed to identical retained/derived identities");
  if (JSON.stringify(geometryOnly(variants.fbm.adapted.scene)) !== JSON.stringify(geometryOnly(variants.cellular.adapted.scene))) throw new Error("generic distance-band adapter geometry changed by source family");
  if (JSON.stringify(albedoOnly(variants.fbm.adapted.scene)) === JSON.stringify(albedoOnly(variants.cellular.adapted.scene))) throw new Error("distinct distance-band grids collapsed to identical observation albedo");

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      files: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, value.sha256])),
      graphs: {
        fbm: { id: band.MASK_DISTANCE_BAND_GRAPH.id, version: band.MASK_DISTANCE_BAND_GRAPH.version },
        cellular: { id: band.CELLULAR_MASK_DISTANCE_BAND_GRAPH.id, version: band.CELLULAR_MASK_DISTANCE_BAND_GRAPH.version },
      },
    },
    shared_contract: {
      mask: sharedMask,
      distance: sharedDistance,
      band: sharedBand,
      derived_schema: "axm.distance-band-grid/v0.1",
      generic_sampler: "sampleMaskDistanceBandGrid",
      source_family_branching: false,
    },
    variants: Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
      family: row.family,
      request_sha256: sha256(row.requestBytes),
      source: { hash: row.sourceHash, bytes_sha256: sha256(row.sourceBytes), schema: row.source.schema },
      mask_source: { hash: row.maskSourceHash, bytes_sha256: sha256(row.maskSourceBytes) },
      distance_source: { hash: row.distanceSourceHash, bytes_sha256: sha256(row.distanceSourceBytes) },
      band_source: { hash: row.bandSourceHash, bytes_sha256: sha256(row.bandSourceBytes) },
      coverage_grid: { hash: row.coverageGrid.maskHash, bytes_sha256: sha256(row.coverageGridBytes) },
      distance_grid: { hash: row.distanceGrid.distanceGridHash, bytes_sha256: sha256(row.distanceGridBytes), comparisons: row.distanceGrid.comparisonCount },
      band_grid: { hash: row.grid.bandGridHash, bytes_sha256: sha256(row.gridBytes), min: row.grid.min, max: row.grid.max, mean: row.grid.mean, full_cells: row.grid.fullCells, zero_cells: row.grid.zeroCells },
      asymmetry_probe: row.asymmetryProbe,
      generic_samples: row.genericSamples,
      lower_resolution_rebuild: row.lowerResolution,
      gates: {
        caller_neutral_replay: true,
        sufficient_budgets_noncreative: true,
        insufficient_cell_budget_failed: row.cellBudgetFailure,
        insufficient_comparison_budget_failed: row.comparisonBudgetFailure,
        self_consistent_derived_distance_tamper_failed: row.tamperFailure,
      },
      native_scene: { bytes_sha256: sha256(row.adapted.bytes), triangles: row.adapted.scene.triangles.length, adapter: row.adapted.observation },
    }])),
    comparison: {
      source_hashes_differ: variants.fbm.sourceHash !== variants.cellular.sourceHash,
      band_grid_hashes_differ: variants.fbm.grid.bandGridHash !== variants.cellular.grid.bandGridHash,
      native_geometry_identical: true,
      native_albedo_differs: true,
      native_scene_bytes_differ: sha256(variants.fbm.adapted.bytes) !== sha256(variants.cellular.adapted.bytes),
    },
    authority: {
      canonical_scalar_sources_remain_authoritative: true,
      coverage_transfer_sources_remain_authoritative: true,
      mask_distance_sources_remain_authoritative: true,
      mask_distance_band_sources_remain_authoritative: true,
      derived_grids_are_canonical: false,
      native_scenes_are_canonical: false,
      consumer_semantics_assigned: false,
      source_truth_rebuild_rejects_derived_distance_tampering: true,
    },
    truth_boundary: {
      proven: "two retained scalar-source families can feed one source-honest asymmetric mask-distance-band contract and one source-family-neutral native observer while preserving source authority, rebuildability and bounded execution evidence",
      not_proven: ["continuous analytic morphology", "physical surface distance", "outline or glow quality", "aesthetic quality", "accessibility", "anti-aliasing quality", "GPU or browser equivalence", "real-time performance", "cross-machine bitwise determinism"],
    },
  };

  return { receipt, variants };
}
