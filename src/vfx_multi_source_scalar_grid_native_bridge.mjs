import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_MULTI_SOURCE_SCALAR_GRID_NATIVE_RECEIPT";
const VERSION = 1;
const DISPLAY_MIN = 32;
const DISPLAY_RANGE = 223;

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
  return { bytes, sha256: sha256(bytes) };
}

function finite01(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be finite and within 0..1`);
  return number;
}

function scalarGridHashPayload(grid) {
  return {
    schema: grid.schema,
    sourceHash: grid.sourceHash,
    width: grid.width,
    height: grid.height,
    values: grid.values,
  };
}

function pointToScene(u, v) {
  return [(u - 0.5) * 1.8, (0.5 - v) * 1.8, 0];
}

function grayForValue(value) {
  return DISPLAY_MIN + Math.round(finite01(value, "scalar grid value") * DISPLAY_RANGE);
}

export function scalarGridToAxmScene(grid) {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) throw new Error("scalar-grid native adapter requires a grid object");
  if (grid.schema !== "axm.scalar-field-grid/v0.1") throw new Error("scalar-grid native adapter requires axm.scalar-field-grid/v0.1");
  if (grid.derived !== true || grid.rebuildable !== true) throw new Error("scalar-grid native adapter accepts only derived rebuildable grids");
  if (!String(grid.sourceHash || "").trim() || !String(grid.fieldHash || "").trim()) throw new Error("scalar-grid native adapter requires retained source and field identities");
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || grid.width > 128 || grid.height > 128) {
    throw new Error("scalar-grid native adapter requires a bounded 2D grid within 2..128 per axis");
  }
  if (!Array.isArray(grid.values) || grid.values.length !== grid.width * grid.height) throw new Error("scalar-grid native adapter value cardinality mismatch");
  const values = grid.values.map((value, index) => finite01(value, `scalar grid value[${index}]`));
  const actualMin = Math.min(...values);
  const actualMax = Math.max(...values);
  const actualMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (![grid.min, grid.max, grid.mean].every(Number.isFinite)) throw new Error("scalar-grid native adapter requires retained min/max/mean evidence");
  if (Math.abs(Number(grid.min) - actualMin) > 1e-6 || Math.abs(Number(grid.max) - actualMax) > 1e-6 || Math.abs(Number(grid.mean) - actualMean) > 1e-6) {
    throw new Error("scalar-grid native adapter summary evidence does not match retained values");
  }

  const triangles = [];
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const index = row * grid.width + column;
      const shade = grayForValue(values[index]);
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
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== grid.values.length * 2) throw new Error("scalar-grid native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-scalar-grid-to-axm-scene/v1",
      input_schema: grid.schema,
      source_hash: grid.sourceHash,
      field_hash: grid.fieldHash,
      width: grid.width,
      height: grid.height,
      input_cells: grid.values.length,
      output_contract: "AXM_SCENE 1",
      output_triangles: triangles.length,
      geometry_mapping: "one derived scalar-grid cell -> one planar two-triangle square",
      display_transfer: "linear scalar 0..1 -> neutral grayscale 32..255",
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

export async function observeVisualEffectScalarGridFamiliesNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    fbm: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
    cellular: resolve(rootPath, "hand-lab/src/cellular-field2d.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const fbm = await import(`${pathToFileURL(paths.fbm).href}?sha=${sources.fbm.sha256}`);
  const cellular = await import(`${pathToFileURL(paths.cellular).href}?sha=${sources.cellular.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(fbm.SCALAR_FIELD_HANDS) || !fbm.SCALAR_FIELD_FBM_GRAPH || typeof fbm.makeScalarFieldState !== "function" || typeof fbm.sampleScalarGrid !== "function") throw new Error("VFX fBm scalar-field donor is unavailable");
  if (!Array.isArray(cellular.CELLULAR_FIELD_HANDS) || !cellular.CELLULAR_FIELD_GRAPH || typeof cellular.makeCellularFieldState !== "function") throw new Error("VFX cellular scalar-field donor is unavailable");
  if (fbm.SCALAR_FIELD_FBM_GRAPH.id !== "fx.field.fbm2d" || fbm.SCALAR_FIELD_FBM_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX fBm graph identity");
  if (cellular.CELLULAR_FIELD_GRAPH.id !== "fx.field.cellular-nearest2d" || cellular.CELLULAR_FIELD_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX cellular graph identity");

  const fbmRequest = {
    id: "creative-render-fbm-source",
    seed: 7331,
    frequency: 4.25,
    octaves: 4,
    lacunarity: 2,
    gain: 0.5,
    offset: [0.125, -0.25],
  };
  const cellularRequest = {
    id: "creative-render-cellular-source",
    seed: 7331,
    frequency: 4.25,
    jitter: 0.82,
    offset: [0.125, -0.25],
    valueMode: "distance",
  };

  const specifications = {
    fbm: {
      hands: fbm.SCALAR_FIELD_HANDS,
      graph: fbm.SCALAR_FIELD_FBM_GRAPH,
      initial: fbm.makeScalarFieldState(fbmRequest),
      sourceKey: "fieldSource",
      sourceHashKey: "fieldSourceHash",
      normalizeHand: fbm.normalizeScalarFieldRequestHand,
      buildHand: fbm.buildScalarFieldGridHand,
      insufficientError: "fieldGrid cell budget exceeded",
      family: "fbm-value-noise-2d",
    },
    cellular: {
      hands: cellular.CELLULAR_FIELD_HANDS,
      graph: cellular.CELLULAR_FIELD_GRAPH,
      initial: cellular.makeCellularFieldState(cellularRequest),
      sourceKey: "cellularFieldSource",
      sourceHashKey: "cellularFieldSourceHash",
      normalizeHand: cellular.normalizeCellularFieldRequestHand,
      buildHand: cellular.buildCellularFieldGridHand,
      insufficientError: "cellularGrid cell budget exceeded",
      family: "cellular-nearest-feature-2d",
    },
  };

  const variants = {};
  for (const [name, spec] of Object.entries(specifications)) {
    const requestKey = name === "fbm" ? "fieldRequest" : "cellularFieldRequest";
    const requestBytes = stableBytes(spec.initial[requestKey]);
    const execute = (callerKind) => runtime.executeHandGraph({
      registry: runtime.createHandRegistry(spec.hands),
      graph: spec.graph,
      initialState: spec.initial,
      context: { callerKind },
    });
    const human = execute("human");
    const machine = execute("machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${name} scalar-grid caller-neutral repeat failed`);
    const finalState = human.finalState;
    if (stableBytes(finalState[requestKey]).compare(requestBytes) !== 0) throw new Error(`${name} scalar-grid request mutated`);

    const source = finalState[spec.sourceKey];
    const sourceHash = finalState[spec.sourceHashKey];
    if (!source || runtime.hashValue(source) !== sourceHash) throw new Error(`${name} scalar source identity drifted`);
    const grid = finalState.scalarFields?.[source.id];
    if (!grid || grid.schema !== "axm.scalar-field-grid/v0.1" || grid.sourceHash !== sourceHash || grid.derived !== true || grid.rebuildable !== true) throw new Error(`${name} scalar grid lineage drifted`);
    if (grid.width !== 48 || grid.height !== 32 || grid.values.length !== 1536) throw new Error(`${name} scalar grid bounded default working set drifted`);
    if (runtime.hashValue(scalarGridHashPayload(grid)) !== grid.fieldHash) throw new Error(`${name} scalar grid fieldHash drifted`);

    const normalized = spec.normalizeHand.execute(spec.initial).state;
    const exact = spec.buildHand.execute(normalized, { width: 48, height: 32, maxCells: 1536 }).state.scalarFields[source.id];
    const roomy = spec.buildHand.execute(normalized, { width: 48, height: 32, maxCells: 16384 }).state.scalarFields[source.id];
    if (exact.fieldHash !== grid.fieldHash || roomy.fieldHash !== grid.fieldHash) throw new Error(`${name} sufficient maxCells changed derived grid`);
    let insufficientFailure = null;
    try {
      spec.buildHand.execute(normalized, { width: 48, height: 32, maxCells: 1535 });
    } catch (error) {
      insufficientFailure = String(error?.message || error);
    }
    if (!insufficientFailure?.includes(spec.insufficientError)) throw new Error(`${name} insufficient maxCells did not fail loudly`);
    if (runtime.hashValue(normalized[spec.sourceKey]) !== sourceHash) throw new Error(`${name} failed budget attempt rewrote canonical source`);

    const samplePoints = [[0, 0], [0.25, 0.5], [0.5, 0.5], [0.75, 0.125], [1, 1]];
    const genericSamples = samplePoints.map(([u, v]) => ({ u, v, value: fbm.sampleScalarGrid(grid, u, v) }));
    if (genericSamples.some((sample) => !Number.isFinite(sample.value) || sample.value < 0 || sample.value > 1)) throw new Error(`${name} generic scalar-grid sampler failed`);

    const adapted = scalarGridToAxmScene(grid);
    variants[name] = {
      family: spec.family,
      requestBytes,
      source,
      sourceHash,
      sourceBytes: stableBytes(source),
      grid,
      gridBytes: stableBytes(grid),
      adapted,
      genericSamples,
      finalStateHash: human.finalStateHash,
      insufficientFailure,
    };
  }

  if (variants.fbm.grid.schema !== variants.cellular.grid.schema) throw new Error("source families do not share the generic scalar-grid contract");
  if (variants.fbm.grid.width !== variants.cellular.grid.width || variants.fbm.grid.height !== variants.cellular.grid.height) throw new Error("source-family observation grids do not share resolution");
  if (JSON.stringify(geometryOnly(variants.fbm.adapted.scene)) !== JSON.stringify(geometryOnly(variants.cellular.adapted.scene))) throw new Error("generic scalar-grid adapter geometry changed by source family");
  if (JSON.stringify(albedoOnly(variants.fbm.adapted.scene)) === JSON.stringify(albedoOnly(variants.cellular.adapted.scene))) throw new Error("distinct scalar source families collapsed to identical observation albedo");
  if (variants.fbm.grid.fieldHash === variants.cellular.grid.fieldHash || variants.fbm.adapted.bytes.compare(variants.cellular.adapted.bytes) === 0) throw new Error("distinct scalar source families collapsed to identical derived observation identities");

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graphs: {
        fbm: { id: fbm.SCALAR_FIELD_FBM_GRAPH.id, version: fbm.SCALAR_FIELD_FBM_GRAPH.version },
        cellular: { id: cellular.CELLULAR_FIELD_GRAPH.id, version: cellular.CELLULAR_FIELD_GRAPH.version },
      },
      source_files: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, value.sha256])),
    },
    caller_authority: {
      caller_requests_mutated: false,
      human_machine_replay_identical_per_family: true,
      canonical_source_remains_authoritative: true,
      generic_scalar_grids_are_canonical: false,
      native_scenes_are_canonical: false,
      consumer_semantics_assigned: false,
    },
    shared_consumer_contract: {
      schema: "axm.scalar-field-grid/v0.1",
      families: [variants.fbm.family, variants.cellular.family],
      width: 48,
      height: 32,
      cells: 1536,
      generic_sampler: "sampleScalarGrid",
      adapter: "axm.creative-render.vfx-scalar-grid-to-axm-scene/v1",
      source_family_branching: false,
      geometry_identical_across_families: true,
      only_derived_observation_albedo_changes_with_grid_values: true,
    },
    variants: Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
      family: row.family,
      request_sha256: sha256(row.requestBytes),
      source: { hash: row.sourceHash, bytes_sha256: sha256(row.sourceBytes), schema: row.source.schema },
      grid: { hash: row.grid.fieldHash, bytes_sha256: sha256(row.gridBytes), schema: row.grid.schema, width: row.grid.width, height: row.grid.height, cells: row.grid.values.length, min: row.grid.min, max: row.grid.max, mean: row.grid.mean },
      generic_samples: row.genericSamples,
      working_set_budget: { exact_1536_matches_roomy_16384: true, insufficient_1535_failed_loudly: true, insufficient_error: row.insufficientFailure },
      native_scene: { bytes_sha256: sha256(row.adapted.bytes), triangles: row.adapted.scene.triangles.length, adapter: row.adapted.observation },
      final_state_hash: row.finalStateHash,
    } ])),
    comparison: {
      source_hashes_differ: variants.fbm.sourceHash !== variants.cellular.sourceHash,
      grid_hashes_differ: variants.fbm.grid.fieldHash !== variants.cellular.grid.fieldHash,
      native_scene_bytes_differ: variants.fbm.adapted.bytes.compare(variants.cellular.adapted.bytes) !== 0,
      native_geometry_is_identical: true,
      native_albedo_differs: true,
    },
    replaceability: {
      same_generic_derived_grid_contract_can_feed_one_native_observer_for_both_source_families: true,
      observer_does_not_rewrite_donor_source_or_grid_truth: true,
      native_scene_and_pixels_remain_replaceable_observation_bodies: true,
    },
    truth_boundary: {
      proven: "two current VFX continuous scalar source families independently produce the same generic derived scalar-grid contract, the existing generic grid sampler accepts both, and one source-family-neutral Creative Render adapter can turn either grid into a replaceable native Render Fabric observation body",
      not_proven: ["aesthetic quality", "physical meaning", "semantic equivalence between source families", "contour/halftone consumer compatibility", "GPU equivalence", "real-time performance", "cross-machine bitwise determinism"],
    },
  };

  return { variants, receipt };
}
