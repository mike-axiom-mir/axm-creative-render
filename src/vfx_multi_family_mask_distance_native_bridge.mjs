import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_MULTI_FAMILY_MASK_DISTANCE_NATIVE_RECEIPT";
const VERSION = 1;
const DISPLAY_LIMIT = 0.25;
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

function finiteDistance(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > Math.SQRT2 + 1e-6) {
    throw new Error(`${label} must be finite and within the normalized-domain diagonal`);
  }
  return number;
}

function pointToScene(u, v) {
  return [(u - 0.5) * 1.8, (0.5 - v) * 1.8, 0];
}

function grayForSignedDistance(value) {
  const bounded = Math.max(-DISPLAY_LIMIT, Math.min(DISPLAY_LIMIT, finiteDistance(value, "signed distance")));
  const normalized = (bounded + DISPLAY_LIMIT) / (DISPLAY_LIMIT * 2);
  return DISPLAY_MIN + Math.round(normalized * DISPLAY_RANGE);
}

export function signedMaskDistanceGridToAxmScene(grid) {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) throw new Error("mask-distance native adapter requires a grid object");
  if (grid.schema !== "axm.signed-mask-distance-grid/v0.1") throw new Error("mask-distance native adapter requires axm.signed-mask-distance-grid/v0.1");
  if (grid.derived !== true || grid.rebuildable !== true) throw new Error("mask-distance native adapter accepts only derived rebuildable grids");
  for (const key of ["distanceSourceHash", "maskSourceHash", "maskHash", "distanceGridHash"]) {
    if (!String(grid[key] || "").trim()) throw new Error(`mask-distance native adapter requires ${key}`);
  }
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || grid.width > 128 || grid.height > 128) {
    throw new Error("mask-distance native adapter requires a bounded 2D grid within 2..128 per axis");
  }
  if (!Array.isArray(grid.values) || grid.values.length !== grid.width * grid.height) throw new Error("mask-distance native adapter value cardinality mismatch");
  const values = grid.values.map((value, index) => finiteDistance(value, `distance value[${index}]`));
  const actualMin = Math.min(...values);
  const actualMax = Math.max(...values);
  const actualMaxAbs = Math.max(...values.map(Math.abs));
  const insideCells = values.filter((value) => value >= 0).length;
  const outsideCells = values.length - insideCells;
  if (![grid.min, grid.max, grid.maxAbs].every(Number.isFinite)) throw new Error("mask-distance native adapter requires retained min/max/maxAbs evidence");
  if (Math.abs(Number(grid.min) - actualMin) > 1e-6 || Math.abs(Number(grid.max) - actualMax) > 1e-6 || Math.abs(Number(grid.maxAbs) - actualMaxAbs) > 1e-6) {
    throw new Error("mask-distance native adapter summary evidence does not match retained values");
  }
  if (grid.insideCells !== insideCells || grid.outsideCells !== outsideCells || insideCells + outsideCells !== values.length) {
    throw new Error("mask-distance native adapter retained class counts do not match values");
  }
  if (!Number.isInteger(grid.comparisonCount) || grid.comparisonCount < 0) throw new Error("mask-distance native adapter requires bounded comparison-count evidence");

  const triangles = [];
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const index = row * grid.width + column;
      const shade = grayForSignedDistance(values[index]);
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
  if (parseScene(bytes.toString("utf8")).triangles.length !== grid.values.length * 2) throw new Error("mask-distance native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-signed-mask-distance-grid-to-axm-scene/v1",
      input_schema: grid.schema,
      distance_source_hash: grid.distanceSourceHash,
      mask_source_hash: grid.maskSourceHash,
      mask_hash: grid.maskHash,
      distance_grid_hash: grid.distanceGridHash,
      width: grid.width,
      height: grid.height,
      input_cells: values.length,
      output_contract: "AXM_SCENE 1",
      output_triangles: triangles.length,
      geometry_mapping: "one derived signed-distance cell -> one planar two-triangle square",
      display_transfer: "signed normalized-domain distance clipped to -0.25..0.25 -> neutral grayscale 24..240",
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

function gridHash(runtime, grid) {
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

function maskHash(runtime, mask) {
  return runtime.hashValue({
    schema: mask.schema,
    fieldSourceHash: mask.fieldSourceHash,
    maskSourceHash: mask.maskSourceHash,
    width: mask.width,
    height: mask.height,
    values: mask.values,
  });
}

export async function observeVisualEffectMaskDistanceFamiliesNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    distance: resolve(rootPath, "hand-lab/src/mask-distance-field2d.mjs"),
    mask: resolve(rootPath, "hand-lab/src/field-mask-operators.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const distance = await import(`${pathToFileURL(paths.distance).href}?sha=${sources.distance.sha256}`);
  const mask = await import(`${pathToFileURL(paths.mask).href}?sha=${sources.mask.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(distance.MASK_DISTANCE_FIELD_HANDS) || !Array.isArray(distance.CELLULAR_MASK_DISTANCE_FIELD_HANDS)
    || !distance.MASK_DISTANCE_FIELD_GRAPH || !distance.CELLULAR_MASK_DISTANCE_FIELD_GRAPH
    || typeof distance.makeMaskDistanceState !== "function" || typeof distance.makeCellularMaskDistanceState !== "function"
    || typeof distance.buildSignedMaskDistanceGridHand?.execute !== "function" || typeof distance.sampleSignedMaskDistanceGrid !== "function"
    || typeof mask.buildCoverageMaskGridHand?.execute !== "function") {
    throw new Error("VFX multi-family mask-distance donor is unavailable");
  }
  if (distance.MASK_DISTANCE_FIELD_GRAPH.id !== "fx.field.mask-distance2d" || distance.MASK_DISTANCE_FIELD_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX fBm mask-distance graph identity");
  if (distance.CELLULAR_MASK_DISTANCE_FIELD_GRAPH.id !== "fx.field.mask-distance2d-cellular" || distance.CELLULAR_MASK_DISTANCE_FIELD_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX cellular mask-distance graph identity");

  const sharedMask = { id: "creative-render-distance-mask", threshold: 0.5, softness: 0.1, invert: false };
  const sharedDistance = { id: "creative-render-mask-distance", maskId: sharedMask.id, isoLevel: 0.5 };
  const specifications = {
    fbm: {
      family: "fbm-value-noise-2d",
      hands: distance.MASK_DISTANCE_FIELD_HANDS,
      graph: distance.MASK_DISTANCE_FIELD_GRAPH,
      initial: distance.makeMaskDistanceState({
        field: { id: "creative-render-distance-field", seed: 211, frequency: 4.1, octaves: 5, lacunarity: 2, gain: 0.54, offset: [0.07, -0.13] },
        mask: sharedMask,
        distance: sharedDistance,
      }),
      requestKey: "fieldRequest",
      sourceKey: "fieldSource",
      sourceHashKey: "fieldSourceHash",
      sourceSchema: "axm.scalar-field-source/v0.1",
    },
    cellular: {
      family: "cellular-nearest-feature-2d",
      hands: distance.CELLULAR_MASK_DISTANCE_FIELD_HANDS,
      graph: distance.CELLULAR_MASK_DISTANCE_FIELD_GRAPH,
      initial: distance.makeCellularMaskDistanceState({
        field: { id: "creative-render-distance-field", seed: 211, frequency: 4.1, jitter: 0.86, offset: [0.07, -0.13], valueMode: "distance" },
        mask: sharedMask,
        distance: sharedDistance,
      }),
      requestKey: "cellularFieldRequest",
      sourceKey: "cellularFieldSource",
      sourceHashKey: "cellularFieldSourceHash",
      sourceSchema: "axm.cellular-field-source/v0.1",
    },
  };

  const variants = {};
  for (const [name, spec] of Object.entries(specifications)) {
    const requestBytes = stableBytes({ field: spec.initial[spec.requestKey], mask: spec.initial.maskRequest, distance: spec.initial.maskDistanceRequest });
    const registry = runtime.createHandRegistry(spec.hands);
    const execute = (callerKind) => runtime.executeHandGraph({ registry, graph: spec.graph, initialState: spec.initial, context: { callerKind } });
    const human = execute("human");
    const machine = execute("machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${name} mask-distance caller-neutral replay failed`);
    const state = human.finalState;
    if (stableBytes({ field: state[spec.requestKey], mask: state.maskRequest, distance: state.maskDistanceRequest }).compare(requestBytes) !== 0) throw new Error(`${name} mask-distance caller request mutated`);

    const source = state[spec.sourceKey];
    const sourceHash = state[spec.sourceHashKey];
    const maskSource = state.coverageMaskSource;
    const maskSourceHash = state.coverageMaskSourceHash;
    const distanceSource = state.maskDistanceSource;
    const distanceSourceHash = state.maskDistanceSourceHash;
    const coverageGrid = state.coverageMasks?.[maskSource?.id];
    const grid = state.signedMaskDistanceGrids?.[distanceSource?.id];
    if (!source || source.schema !== spec.sourceSchema || runtime.hashValue(source) !== sourceHash) throw new Error(`${name} retained scalar source identity drifted`);
    if (!maskSource || maskSource.schema !== "axm.coverage-mask-source/v0.1" || runtime.hashValue(maskSource) !== maskSourceHash || maskSource.fieldSourceHash !== sourceHash) throw new Error(`${name} retained mask source lineage drifted`);
    if (!distanceSource || distanceSource.schema !== "axm.mask-distance-source/v0.1" || runtime.hashValue(distanceSource) !== distanceSourceHash || distanceSource.maskSourceHash !== maskSourceHash || distanceSource.isoLevel !== sharedDistance.isoLevel) throw new Error(`${name} retained distance source lineage drifted`);
    if (!coverageGrid || coverageGrid.schema !== "axm.coverage-mask-grid/v0.1" || coverageGrid.maskSourceHash !== maskSourceHash || coverageGrid.fieldSourceHash !== sourceHash) throw new Error(`${name} derived coverage grid lineage drifted`);
    if (!grid || grid.schema !== "axm.signed-mask-distance-grid/v0.1" || grid.distanceSourceHash !== distanceSourceHash || grid.maskSourceHash !== maskSourceHash || grid.maskHash !== coverageGrid.maskHash || grid.derived !== true || grid.rebuildable !== true) throw new Error(`${name} signed-distance grid lineage drifted`);
    if (grid.width !== 48 || grid.height !== 32 || grid.values.length !== 1536 || gridHash(runtime, grid) !== grid.distanceGridHash) throw new Error(`${name} signed-distance grid identity drifted`);
    if (grid.insideCells < 1 || grid.outsideCells < 1 || grid.comparisonCount !== 2 * grid.insideCells * grid.outsideCells) throw new Error(`${name} fixture no longer exercises both signed-distance classes`);

    const exact = distance.buildSignedMaskDistanceGridHand.execute(state, { maxCells: 1536, maxComparisons: grid.comparisonCount }).state.signedMaskDistanceGrids[distanceSource.id];
    const roomy = distance.buildSignedMaskDistanceGridHand.execute(state, { maxCells: 4096, maxComparisons: 8388608 }).state.signedMaskDistanceGrids[distanceSource.id];
    if (exact.distanceGridHash !== grid.distanceGridHash || roomy.distanceGridHash !== grid.distanceGridHash) throw new Error(`${name} sufficient execution budgets changed distance-grid truth`);

    let cellBudgetFailure = null;
    let comparisonBudgetFailure = null;
    try { distance.buildSignedMaskDistanceGridHand.execute(state, { maxCells: 1535, maxComparisons: 8388608 }); } catch (error) { cellBudgetFailure = String(error?.message || error); }
    try { distance.buildSignedMaskDistanceGridHand.execute(state, { maxCells: 1536, maxComparisons: grid.comparisonCount - 1 }); } catch (error) { comparisonBudgetFailure = String(error?.message || error); }
    if (!cellBudgetFailure?.includes("maskDistance cell budget exceeded")) throw new Error(`${name} insufficient cell budget did not fail loudly`);
    if (!comparisonBudgetFailure?.includes("maskDistance comparison budget exceeded")) throw new Error(`${name} insufficient comparison budget did not fail loudly`);

    const lowerMaskState = mask.buildCoverageMaskGridHand.execute(state, { width: 24, height: 16, maxCells: 384 }).state;
    const lowerGrid = distance.buildSignedMaskDistanceGridHand.execute(lowerMaskState, { maxCells: 384, maxComparisons: 8388608 }).state.signedMaskDistanceGrids[distanceSource.id];
    if (runtime.hashValue(lowerMaskState.maskDistanceSource) !== distanceSourceHash || lowerGrid.distanceSourceHash !== distanceSourceHash) throw new Error(`${name} rebuild resolution rewrote retained distance source`);
    if (lowerGrid.distanceGridHash === grid.distanceGridHash || lowerGrid.width !== 24 || lowerGrid.height !== 16) throw new Error(`${name} rebuild resolution did not remain separately derived`);

    const tampered = structuredClone(state);
    const tamperedMask = tampered.coverageMasks[maskSource.id];
    tamperedMask.values[0] = Number(((tamperedMask.values[0] + 0.137) % 1).toFixed(6));
    tamperedMask.maskHash = maskHash(runtime, tamperedMask);
    let tamperFailure = null;
    try { distance.buildSignedMaskDistanceGridHand.execute(tampered, { maxCells: 1536, maxComparisons: 8388608 }); } catch (error) { tamperFailure = String(error?.message || error); }
    if (!tamperFailure?.includes("differs from source-truth rebuild")) throw new Error(`${name} self-consistent derived-mask tampering was not rejected by source-truth rebuild`);
    if (runtime.hashValue(state[spec.sourceKey]) !== sourceHash || runtime.hashValue(state.coverageMaskSource) !== maskSourceHash || runtime.hashValue(state.maskDistanceSource) !== distanceSourceHash) throw new Error(`${name} failed challenges rewrote retained source state`);

    const samplePoints = [[0, 0], [0.25, 0.5], [0.5, 0.5], [0.75, 0.125], [1, 1]];
    const genericSamples = samplePoints.map(([u, v]) => ({ u, v, value: distance.sampleSignedMaskDistanceGrid(grid, u, v) }));
    if (genericSamples.some((sample) => !Number.isFinite(sample.value))) throw new Error(`${name} generic signed-distance sampler failed`);

    const adapted = signedMaskDistanceGridToAxmScene(grid);
    variants[name] = {
      family: spec.family,
      requestBytes,
      source, sourceHash, sourceBytes: stableBytes(source),
      maskSource, maskSourceHash, maskSourceBytes: stableBytes(maskSource),
      distanceSource, distanceSourceHash, distanceSourceBytes: stableBytes(distanceSource),
      coverageGrid, coverageGridBytes: stableBytes(coverageGrid),
      grid, gridBytes: stableBytes(grid),
      adapted,
      genericSamples,
      finalStateHash: human.finalStateHash,
      lowerResolution: { width: lowerGrid.width, height: lowerGrid.height, distanceGridHash: lowerGrid.distanceGridHash, sameDistanceSourceHash: lowerGrid.distanceSourceHash === distanceSourceHash },
      cellBudgetFailure,
      comparisonBudgetFailure,
      tamperFailure,
    };
  }

  if (variants.fbm.grid.schema !== variants.cellular.grid.schema) throw new Error("source families do not share the generic signed-distance-grid contract");
  if (variants.fbm.distanceSource.isoLevel !== variants.cellular.distanceSource.isoLevel || variants.fbm.maskSource.threshold !== variants.cellular.maskSource.threshold || variants.fbm.maskSource.softness !== variants.cellular.maskSource.softness) throw new Error("shared mask/distance treatment drifted across source families");
  if (variants.fbm.sourceHash === variants.cellular.sourceHash || variants.fbm.maskSourceHash === variants.cellular.maskSourceHash || variants.fbm.grid.distanceGridHash === variants.cellular.grid.distanceGridHash) throw new Error("distinct source families collapsed to identical retained/derived identities");
  if (JSON.stringify(geometryOnly(variants.fbm.adapted.scene)) !== JSON.stringify(geometryOnly(variants.cellular.adapted.scene))) throw new Error("generic signed-distance adapter geometry changed by source family");
  if (JSON.stringify(albedoOnly(variants.fbm.adapted.scene)) === JSON.stringify(albedoOnly(variants.cellular.adapted.scene))) throw new Error("distinct signed-distance grids collapsed to identical observation albedo");

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      files: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, value.sha256])),
      graphs: {
        fbm: { id: distance.MASK_DISTANCE_FIELD_GRAPH.id, version: distance.MASK_DISTANCE_FIELD_GRAPH.version },
        cellular: { id: distance.CELLULAR_MASK_DISTANCE_FIELD_GRAPH.id, version: distance.CELLULAR_MASK_DISTANCE_FIELD_GRAPH.version },
      },
    },
    shared_contract: {
      mask: sharedMask,
      distance: sharedDistance,
      derived_schema: "axm.signed-mask-distance-grid/v0.1",
      generic_sampler: "sampleSignedMaskDistanceGrid",
      source_family_branching: false,
    },
    variants: Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
      family: row.family,
      request_sha256: sha256(row.requestBytes),
      source: { hash: row.sourceHash, bytes_sha256: sha256(row.sourceBytes), schema: row.source.schema },
      mask_source: { hash: row.maskSourceHash, bytes_sha256: sha256(row.maskSourceBytes) },
      distance_source: { hash: row.distanceSourceHash, bytes_sha256: sha256(row.distanceSourceBytes) },
      coverage_grid: { hash: row.coverageGrid.maskHash, bytes_sha256: sha256(row.coverageGridBytes) },
      distance_grid: { hash: row.grid.distanceGridHash, bytes_sha256: sha256(row.gridBytes), min: row.grid.min, max: row.grid.max, max_abs: row.grid.maxAbs, inside_cells: row.grid.insideCells, outside_cells: row.grid.outsideCells, comparisons: row.grid.comparisonCount },
      generic_samples: row.genericSamples,
      lower_resolution_rebuild: row.lowerResolution,
      gates: {
        caller_neutral_replay: true,
        sufficient_budgets_noncreative: true,
        insufficient_cell_budget_failed: row.cellBudgetFailure,
        insufficient_comparison_budget_failed: row.comparisonBudgetFailure,
        self_consistent_derived_mask_tamper_failed: row.tamperFailure,
      },
      native_scene: { bytes_sha256: sha256(row.adapted.bytes), triangles: row.adapted.scene.triangles.length, adapter: row.adapted.observation },
    }])),
    comparison: {
      source_hashes_differ: variants.fbm.sourceHash !== variants.cellular.sourceHash,
      distance_grid_hashes_differ: variants.fbm.grid.distanceGridHash !== variants.cellular.grid.distanceGridHash,
      native_geometry_identical: true,
      native_albedo_differs: true,
      native_scene_bytes_differ: sha256(variants.fbm.adapted.bytes) !== sha256(variants.cellular.adapted.bytes),
    },
    authority: {
      canonical_scalar_sources_remain_authoritative: true,
      coverage_transfer_sources_remain_authoritative: true,
      mask_distance_sources_remain_authoritative: true,
      derived_grids_are_canonical: false,
      native_scenes_are_canonical: false,
      consumer_semantics_assigned: false,
      source_truth_rebuild_rejects_derived_mask_tampering: true,
    },
    truth_boundary: {
      proven: "two retained scalar-source families can feed one source-honest coverage-to-signed-distance contract and one source-family-neutral native observer while preserving source authority and bounded execution evidence",
      not_proven: ["continuous analytic signed distance", "physical surface distance", "outline or glow quality", "aesthetic quality", "accessibility", "GPU or browser equivalence", "real-time performance", "cross-machine bitwise determinism"],
    },
  };

  return { receipt, variants };
}
