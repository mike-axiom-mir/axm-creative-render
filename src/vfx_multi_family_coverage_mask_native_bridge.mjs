import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_MULTI_FAMILY_COVERAGE_MASK_NATIVE_RECEIPT";
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
  return { bytes, sha256: sha256(bytes) };
}

function finite01(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be finite and within 0..1`);
  return number;
}

function pointToScene(u, v) {
  return [(u - 0.5) * 1.8, (0.5 - v) * 1.8, 0];
}

function grayForCoverage(value) {
  return DISPLAY_MIN + Math.round(finite01(value, "coverage value") * DISPLAY_RANGE);
}

export function coverageMaskGridToAxmScene(grid) {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) throw new Error("coverage-mask native adapter requires a grid object");
  if (grid.schema !== "axm.coverage-mask-grid/v0.1") throw new Error("coverage-mask native adapter requires axm.coverage-mask-grid/v0.1");
  if (grid.derived !== true || grid.rebuildable !== true) throw new Error("coverage-mask native adapter accepts only derived rebuildable grids");
  if (!String(grid.fieldSourceHash || "").trim() || !String(grid.maskSourceHash || "").trim() || !String(grid.maskHash || "").trim()) {
    throw new Error("coverage-mask native adapter requires retained source, transfer and grid identities");
  }
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 4 || grid.height < 4 || grid.width > 128 || grid.height > 128) {
    throw new Error("coverage-mask native adapter requires a bounded 2D grid within 4..128 per axis");
  }
  if (!Array.isArray(grid.values) || grid.values.length !== grid.width * grid.height) throw new Error("coverage-mask native adapter value cardinality mismatch");
  const values = grid.values.map((value, index) => finite01(value, `coverage value[${index}]`));
  const actualMin = Math.min(...values);
  const actualMax = Math.max(...values);
  const actualMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const opaqueCells = values.filter((value) => value === 1).length;
  const transparentCells = values.filter((value) => value === 0).length;
  if (![grid.min, grid.max, grid.mean].every(Number.isFinite)) throw new Error("coverage-mask native adapter requires retained min/max/mean evidence");
  if (Math.abs(Number(grid.min) - actualMin) > 1e-6 || Math.abs(Number(grid.max) - actualMax) > 1e-6 || Math.abs(Number(grid.mean) - actualMean) > 1e-6) {
    throw new Error("coverage-mask native adapter summary evidence does not match retained values");
  }
  if (grid.opaqueCells !== opaqueCells || grid.transparentCells !== transparentCells) {
    throw new Error("coverage-mask native adapter retained binary-cell counts do not match values");
  }

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
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== grid.values.length * 2) throw new Error("coverage-mask native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-coverage-mask-grid-to-axm-scene/v1",
      input_schema: grid.schema,
      field_source_hash: grid.fieldSourceHash,
      mask_source_hash: grid.maskSourceHash,
      mask_hash: grid.maskHash,
      width: grid.width,
      height: grid.height,
      input_cells: grid.values.length,
      output_contract: "AXM_SCENE 1",
      output_triangles: triangles.length,
      geometry_mapping: "one derived coverage-mask cell -> one planar two-triangle square",
      display_transfer: "linear coverage 0..1 -> neutral grayscale 24..240",
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

export async function observeVisualEffectCoverageMaskFamiliesNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    mask: resolve(rootPath, "hand-lab/src/field-mask-operators.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const mask = await import(`${pathToFileURL(paths.mask).href}?sha=${sources.mask.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(mask.COVERAGE_MASK_HANDS) || !Array.isArray(mask.CELLULAR_COVERAGE_MASK_HANDS)
    || !mask.COVERAGE_MASK_GRAPH || !mask.CELLULAR_COVERAGE_MASK_GRAPH
    || typeof mask.makeCoverageMaskState !== "function" || typeof mask.makeCellularCoverageMaskState !== "function"
    || typeof mask.buildCoverageMaskGridHand?.execute !== "function" || typeof mask.sampleCoverageMask !== "function") {
    throw new Error("VFX multi-family coverage-mask donor is unavailable");
  }
  if (mask.COVERAGE_MASK_GRAPH.id !== "fx.field.coverage-mask2d" || mask.COVERAGE_MASK_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX fBm coverage-mask graph identity");
  }
  if (mask.CELLULAR_COVERAGE_MASK_GRAPH.id !== "fx.field.coverage-mask2d-cellular" || mask.CELLULAR_COVERAGE_MASK_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX cellular coverage-mask graph identity");
  }

  const sharedMask = {
    id: "creative-render-shared-coverage",
    threshold: 0.52,
    softness: 0.11,
    invert: false,
  };
  const specifications = {
    fbm: {
      hands: mask.COVERAGE_MASK_HANDS,
      graph: mask.COVERAGE_MASK_GRAPH,
      initial: mask.makeCoverageMaskState({
        field: { id: "creative-render-fbm-mask-field", seed: 991, frequency: 3.75, octaves: 4, lacunarity: 2, gain: 0.5, offset: [0.125, -0.2] },
        mask: sharedMask,
      }),
      sourceKey: "fieldSource",
      sourceHashKey: "fieldSourceHash",
      family: "fbm-value-noise-2d",
      requestKey: "fieldRequest",
      expectedSchema: "axm.scalar-field-source/v0.1",
    },
    cellular: {
      hands: mask.CELLULAR_COVERAGE_MASK_HANDS,
      graph: mask.CELLULAR_COVERAGE_MASK_GRAPH,
      initial: mask.makeCellularCoverageMaskState({
        field: { id: "creative-render-cellular-mask-field", seed: 991, frequency: 3.75, jitter: 0.8, offset: [0.125, -0.2], valueMode: "distance" },
        mask: sharedMask,
      }),
      sourceKey: "cellularFieldSource",
      sourceHashKey: "cellularFieldSourceHash",
      family: "cellular-nearest-feature-2d",
      requestKey: "cellularFieldRequest",
      expectedSchema: "axm.cellular-field-source/v0.1",
    },
  };

  const variants = {};
  for (const [name, spec] of Object.entries(specifications)) {
    const requestBytes = stableBytes({ source: spec.initial[spec.requestKey], mask: spec.initial.maskRequest });
    const execute = (callerKind) => runtime.executeHandGraph({
      registry: runtime.createHandRegistry(spec.hands),
      graph: spec.graph,
      initialState: spec.initial,
      context: { callerKind },
    });
    const human = execute("human");
    const machine = execute("machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${name} coverage-mask caller-neutral replay failed`);
    const finalState = human.finalState;
    if (stableBytes({ source: finalState[spec.requestKey], mask: finalState.maskRequest }).compare(requestBytes) !== 0) {
      throw new Error(`${name} coverage-mask caller request mutated`);
    }

    const source = finalState[spec.sourceKey];
    const sourceHash = finalState[spec.sourceHashKey];
    const maskSource = finalState.coverageMaskSource;
    const maskSourceHash = finalState.coverageMaskSourceHash;
    if (!source || source.schema !== spec.expectedSchema || runtime.hashValue(source) !== sourceHash) throw new Error(`${name} retained source identity drifted`);
    if (!maskSource || maskSource.schema !== "axm.coverage-mask-source/v0.1" || runtime.hashValue(maskSource) !== maskSourceHash) throw new Error(`${name} coverage-mask source identity drifted`);
    if (maskSource.fieldSourceHash !== sourceHash || maskSource.fieldId !== source.id) throw new Error(`${name} coverage-mask source lineage drifted`);
    if (maskSource.threshold !== sharedMask.threshold || maskSource.softness !== sharedMask.softness || maskSource.invert !== sharedMask.invert) {
      throw new Error(`${name} shared coverage transfer drifted`);
    }

    const grid = finalState.coverageMasks?.[maskSource.id];
    if (!grid || grid.schema !== "axm.coverage-mask-grid/v0.1" || grid.fieldSourceHash !== sourceHash || grid.maskSourceHash !== maskSourceHash) {
      throw new Error(`${name} coverage-mask grid lineage drifted`);
    }
    if (grid.width !== 48 || grid.height !== 32 || grid.values.length !== 1536 || grid.derived !== true || grid.rebuildable !== true) {
      throw new Error(`${name} bounded coverage-mask grid drifted`);
    }
    const expectedMaskHash = runtime.hashValue({
      schema: grid.schema,
      fieldSourceHash: grid.fieldSourceHash,
      maskSourceHash: grid.maskSourceHash,
      width: grid.width,
      height: grid.height,
      values: grid.values,
    });
    if (expectedMaskHash !== grid.maskHash) throw new Error(`${name} coverage-mask grid hash drifted`);

    const exact = mask.buildCoverageMaskGridHand.execute(finalState, { width: 48, height: 32, maxCells: 1536 }).state.coverageMasks[maskSource.id];
    const roomy = mask.buildCoverageMaskGridHand.execute(finalState, { width: 48, height: 32, maxCells: 16384 }).state.coverageMasks[maskSource.id];
    if (exact.maskHash !== grid.maskHash || roomy.maskHash !== grid.maskHash) throw new Error(`${name} sufficient maxCells changed derived coverage grid`);
    let insufficientFailure = null;
    try {
      mask.buildCoverageMaskGridHand.execute(finalState, { width: 48, height: 32, maxCells: 1535 });
    } catch (error) {
      insufficientFailure = String(error?.message || error);
    }
    if (!insufficientFailure?.includes("coverageMask cell budget exceeded")) throw new Error(`${name} insufficient maxCells did not fail loudly`);
    if (runtime.hashValue(finalState[spec.sourceKey]) !== sourceHash || runtime.hashValue(finalState.coverageMaskSource) !== maskSourceHash) {
      throw new Error(`${name} failed budget attempt rewrote retained source state`);
    }

    const samplePoints = [[0, 0], [0.25, 0.5], [0.5, 0.5], [0.75, 0.125], [1, 1]];
    const genericSamples = samplePoints.map(([u, v]) => ({ u, v, value: mask.sampleCoverageMask(grid, u, v) }));
    if (genericSamples.some((sample) => !Number.isFinite(sample.value) || sample.value < 0 || sample.value > 1)) {
      throw new Error(`${name} generic coverage-mask sampler failed`);
    }

    const adapted = coverageMaskGridToAxmScene(grid);
    variants[name] = {
      family: spec.family,
      requestBytes,
      source,
      sourceHash,
      sourceBytes: stableBytes(source),
      maskSource,
      maskSourceHash,
      maskSourceBytes: stableBytes(maskSource),
      grid,
      gridBytes: stableBytes(grid),
      adapted,
      genericSamples,
      finalStateHash: human.finalStateHash,
      insufficientFailure,
    };
  }

  if (variants.fbm.grid.schema !== variants.cellular.grid.schema) throw new Error("coverage source families do not share the generic mask-grid contract");
  if (variants.fbm.grid.width !== variants.cellular.grid.width || variants.fbm.grid.height !== variants.cellular.grid.height) {
    throw new Error("coverage source-family observation grids do not share resolution");
  }
  if (variants.fbm.maskSource.threshold !== variants.cellular.maskSource.threshold
    || variants.fbm.maskSource.softness !== variants.cellular.maskSource.softness
    || variants.fbm.maskSource.invert !== variants.cellular.maskSource.invert) {
    throw new Error("coverage transfer semantics differ across source families");
  }
  if (variants.fbm.sourceHash === variants.cellular.sourceHash || variants.fbm.maskSourceHash === variants.cellular.maskSourceHash || variants.fbm.grid.maskHash === variants.cellular.grid.maskHash) {
    throw new Error("distinct source families collapsed to identical retained/derived identities");
  }
  if (JSON.stringify(geometryOnly(variants.fbm.adapted.scene)) !== JSON.stringify(geometryOnly(variants.cellular.adapted.scene))) {
    throw new Error("generic coverage-mask adapter geometry changed by source family");
  }
  if (JSON.stringify(albedoOnly(variants.fbm.adapted.scene)) === JSON.stringify(albedoOnly(variants.cellular.adapted.scene))) {
    throw new Error("distinct coverage grids collapsed to identical observation albedo");
  }

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graphs: {
        fbm: { id: mask.COVERAGE_MASK_GRAPH.id, version: mask.COVERAGE_MASK_GRAPH.version },
        cellular: { id: mask.CELLULAR_COVERAGE_MASK_GRAPH.id, version: mask.CELLULAR_COVERAGE_MASK_GRAPH.version },
      },
      source_files: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, value.sha256])),
    },
    caller_authority: {
      caller_requests_mutated: false,
      human_machine_replay_identical_per_family: true,
      canonical_scalar_sources_remain_authoritative: true,
      coverage_transfer_sources_remain_authoritative: true,
      coverage_grids_are_canonical: false,
      native_scenes_are_canonical: false,
      consumer_semantics_assigned: false,
    },
    shared_transfer: {
      threshold: sharedMask.threshold,
      softness: sharedMask.softness,
      invert: sharedMask.invert,
      identical_across_source_families: true,
      source_lineage_remains_distinct: true,
    },
    shared_consumer_contract: {
      schema: "axm.coverage-mask-grid/v0.1",
      families: [variants.fbm.family, variants.cellular.family],
      width: 48,
      height: 32,
      cells: 1536,
      generic_sampler: "sampleCoverageMask",
      adapter: "axm.creative-render.vfx-coverage-mask-grid-to-axm-scene/v1",
      source_family_branching: false,
      geometry_identical_across_families: true,
      only_derived_observation_albedo_changes_with_coverage_values: true,
    },
    variants: Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
      family: row.family,
      request_sha256: sha256(row.requestBytes),
      source: { hash: row.sourceHash, bytes_sha256: sha256(row.sourceBytes), schema: row.source.schema },
      mask_source: { hash: row.maskSourceHash, bytes_sha256: sha256(row.maskSourceBytes), schema: row.maskSource.schema, field_source_hash: row.maskSource.fieldSourceHash },
      grid: { hash: row.grid.maskHash, bytes_sha256: sha256(row.gridBytes), schema: row.grid.schema, cells: row.grid.values.length, min: row.grid.min, max: row.grid.max, mean: row.grid.mean },
      generic_samples: row.genericSamples,
      working_set_budget: {
        exact_1536_matches_roomy_16384: true,
        insufficient_1535_failed_loudly: true,
        insufficient_error: row.insufficientFailure,
      },
      native_scene: { bytes_sha256: sha256(row.adapted.bytes), triangles: row.adapted.scene.triangles.length, adapter: row.adapted.observation },
      final_state_hash: row.finalStateHash,
    }])),
    comparison: {
      source_hashes_differ: true,
      mask_source_hashes_differ: true,
      mask_grid_hashes_differ: true,
      native_scene_bytes_differ: variants.fbm.adapted.bytes.compare(variants.cellular.adapted.bytes) !== 0,
      native_geometry_is_identical: true,
      native_albedo_differs: true,
    },
    replaceability: {
      same_generic_derived_mask_contract_can_feed_one_native_observer_for_both_source_families: true,
      observer_does_not_rewrite_donor_source_transfer_or_grid_truth: true,
      native_scene_and_pixels_remain_replaceable_observation_bodies: true,
    },
    truth_boundary: {
      proven: [
        "current pinned donor executes fBm and cellular coverage-mask graphs through its own Hand runtime",
        "the same explicit threshold/softness/invert transfer semantics are retained across both source families while source lineage remains distinct",
        "both families produce the same derived coverage-mask-grid contract and pass the same generic sampler/adapter without source-family branching",
        "sufficient maxCells budgets are non-creative and an insufficient budget fails loudly without rewriting retained source state",
        "derived coverage differences can reach a replaceable AXM_SCENE 1 observation body",
      ],
      not_proven: [
        "visual or aesthetic quality",
        "physical visibility, occlusion, smoke, dissolve, material, gameplay, UI, or product semantics",
        "that every existing VFX consumer accepts both source families",
        "real-time performance, GPU/browser equivalence, or cross-machine bitwise determinism",
      ],
    },
  };

  return { variants, receipt };
}
