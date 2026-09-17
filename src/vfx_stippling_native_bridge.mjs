import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_STIPPLING_NATIVE_RECEIPT";
const VERSION = 1;
const FIXED_ALBEDO = [238, 238, 238];

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

function sceneCenter(position) {
  if (!Array.isArray(position) || position.length !== 2) throw new Error("stippling native adapter requires 2D point positions");
  const [x, y] = position.map(Number);
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error("stippling native adapter positions must remain inside normalized 0..1 space");
  }
  return [(x - 0.5) * 1.8, (0.5 - y) * 1.8, 0];
}

export function stipplingPointSetToAxmScene(pointSet, stipplingSource) {
  if (!pointSet || typeof pointSet !== "object" || Array.isArray(pointSet)) throw new Error("stippling native adapter requires a point-set object");
  if (!stipplingSource || typeof stipplingSource !== "object" || Array.isArray(stipplingSource)) throw new Error("stippling native adapter requires a retained stippling source");
  if (pointSet.schema !== "axm.stippling-point-set2d/v0.1" || pointSet.derived !== true || pointSet.rebuildable !== true) {
    throw new Error("stippling native adapter accepts only derived rebuildable v0.1 point sets");
  }
  if (stipplingSource.schema !== "axm.stippling-source2d/v0.1" || !String(pointSet.sourceHash || "").trim() || pointSet.sourceHash !== shaLikeOrValue(pointSet.sourceHash)) {
    throw new Error("stippling native adapter requires retained source identity");
  }
  if (pointSet.sourceHash !== stipplingSource.__sourceHash && stipplingSource.__sourceHash !== undefined) {
    throw new Error("stippling native adapter source hash lineage mismatch");
  }
  if (!String(pointSet.fieldSourceHash || "").trim() || !String(pointSet.pointSetHash || "").trim()) {
    throw new Error("stippling native adapter requires retained field and point-set hashes");
  }
  if (!Number.isInteger(pointSet.columns) || !Number.isInteger(pointSet.rows) || pointSet.columns < 2 || pointSet.rows < 2) {
    throw new Error("stippling native adapter requires a bounded grid");
  }
  if (!Number.isInteger(pointSet.candidatesPerCell) || pointSet.candidatesPerCell < 1 || !Number.isInteger(pointSet.candidateCount) || pointSet.candidateCount !== pointSet.columns * pointSet.rows * pointSet.candidatesPerCell) {
    throw new Error("stippling native adapter requires a consistent candidate universe");
  }
  if (!Array.isArray(pointSet.points) || pointSet.points.length !== pointSet.pointCount) {
    throw new Error("stippling native adapter requires an internally consistent point set");
  }
  const radiusCell = Number(stipplingSource.radiusCell);
  if (!Number.isFinite(radiusCell) || radiusCell < 0.02 || radiusCell > 0.48) {
    throw new Error("stippling native adapter requires retained positive bounded radiusCell");
  }

  const cellScale = Math.min(1 / pointSet.columns, 1 / pointSet.rows) * 1.8;
  const half = radiusCell * cellScale;
  const triangles = [];
  let previousCandidate = -1;
  const ordered = [...pointSet.points].sort((a, b) => a.index - b.index);
  ordered.forEach((point, index) => {
    if (!point || point.index !== index || !Number.isInteger(point.candidateIndex) || point.candidateIndex <= previousCandidate || point.candidateIndex >= pointSet.candidateCount) {
      throw new Error(`stippling native adapter point order/identity mismatch at index ${index}`);
    }
    previousCandidate = point.candidateIndex;
    const [cx, cy, cz] = sceneCenter(point.position);
    const a = [cx - half, cy - half, cz];
    const b = [cx + half, cy - half, cz];
    const c = [cx + half, cy + half, cz];
    const d = [cx - half, cy + half, cz];
    triangles.push(
      { vertices: [a, b, c], albedo: [...FIXED_ALBEDO] },
      { vertices: [a, c, d], albedo: [...FIXED_ALBEDO] },
    );
  });

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== pointSet.pointCount * 2) throw new Error("stippling native adapter triangle count drifted");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-stippling-point-set-to-axm-scene/v1",
      field_source_hash: pointSet.fieldSourceHash,
      stippling_source_hash: pointSet.sourceHash,
      point_set_hash: pointSet.pointSetHash,
      input_candidate_count: pointSet.candidateCount,
      input_point_count: pointSet.pointCount,
      retained_radius_cell: radiusCell,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: scene.triangles.length,
      positions_and_constant_radius_only: true,
      style_is_fixed: true,
      consumer_semantics_assigned: false,
      adapter_policy: "each accepted derived stipple point becomes one fixed-albedo two-triangle square at its retained derived position using the retained treatment radius; canonical VFX field/treatment sources are not rewritten",
    },
  };
}

function shaLikeOrValue(value) {
  return String(value || "").trim();
}

function sourceWithoutValueMode(source) {
  const copy = structuredClone(source);
  delete copy.valueMode;
  delete copy.__sourceHash;
  return copy;
}

function requestWithoutValueMode(request) {
  const copy = structuredClone(request);
  delete copy.valueMode;
  return copy;
}

export async function observeVisualEffectStipplingNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    stippling: resolve(rootPath, "hand-lab/src/stippling-field2d.mjs"),
    fieldOperators: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const stippling = await import(`${pathToFileURL(paths.stippling).href}?sha=${sources.stippling.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(stippling.STIPPLING_FIELD2D_HANDS) || !stippling.STIPPLING_FIELD2D_GRAPH || typeof stippling.makeStipplingFieldState !== "function") {
    throw new Error("VFX donor stippling graph is unavailable");
  }
  if (stippling.STIPPLING_FIELD2D_GRAPH.id !== "fx.stylize.field-stippling2d-static-svg" || stippling.STIPPLING_FIELD2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX stippling graph identity");
  }
  const expectedHands = [
    "fx.field.fbm-source-normalize",
    "fx.stylize.stippling2d-source-normalize",
    "fx.stylize.stippling2d-point-set-build",
    "fx.stylize.stippling2d-static-svg-realize",
  ];
  if (JSON.stringify(stippling.STIPPLING_FIELD2D_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX stippling Hand boundary");
  }

  const common = {
    fieldId: "creative-render-stippling-field",
    seed: 2468,
    frequency: 3.25,
    octaves: 4,
    lacunarity: 2,
    gain: 0.5,
    offset: [0, 0],
    id: "creative-render-stippling",
    patternSeed: 13579,
    minDensity: 0.04,
    maxDensity: 0.96,
    responsePower: 1,
    jitterCell: 0.42,
    radiusCell: 0.12,
  };
  const choices = {
    normal: { ...common, valueMode: "normal" },
    invert: { ...common, valueMode: "invert" },
  };

  const handById = new Map(stippling.STIPPLING_FIELD2D_HANDS.map((hand) => [hand.id, hand]));
  const buildHand = handById.get("fx.stylize.stippling2d-point-set-build");
  const normalizeFieldHand = handById.get("fx.field.fbm-source-normalize");
  const normalizeStipplingHand = handById.get("fx.stylize.stippling2d-source-normalize");
  if (!buildHand || !normalizeFieldHand || !normalizeStipplingHand) throw new Error("VFX stippling direct proof Hands are unavailable");

  const execute = (state, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(stippling.STIPPLING_FIELD2D_HANDS),
    graph: stippling.STIPPLING_FIELD2D_GRAPH,
    initialState: state,
    context: { callerKind },
  });

  const variants = {};
  for (const [name, choice] of Object.entries(choices)) {
    const initialState = stippling.makeStipplingFieldState(choice);
    const fieldRequestBytes = stableBytes(initialState.fieldRequest);
    const treatmentRequestBytes = stableBytes(initialState.stipplingRequest);
    const human = execute(initialState, "human");
    const machine = execute(initialState, "machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`VFX stippling caller-neutral repeat verification failed for ${name}`);

    const finalState = human.finalState;
    if (stableBytes(finalState.fieldRequest).compare(fieldRequestBytes) !== 0) throw new Error(`VFX stippling field request mutated for ${name}`);
    if (stableBytes(finalState.stipplingRequest).compare(treatmentRequestBytes) !== 0) throw new Error(`VFX stippling treatment request mutated for ${name}`);

    const fieldSource = finalState.fieldSource;
    const fieldSourceHash = finalState.fieldSourceHash;
    const stipplingSource = finalState.stipplingSource;
    const stipplingSourceHash = finalState.stipplingSourceHash;
    const pointSet = finalState.stipplingPointSets?.[stipplingSource?.id];
    const realization = finalState.realizations?.stipplingStaticSvg;
    if (!fieldSource || runtime.hashValue(fieldSource) !== fieldSourceHash) throw new Error(`VFX stippling field source hash drifted for ${name}`);
    if (!stipplingSource || runtime.hashValue(stipplingSource) !== stipplingSourceHash || stipplingSource.fieldSourceHash !== fieldSourceHash) {
      throw new Error(`VFX stippling treatment source lineage drifted for ${name}`);
    }
    if (!pointSet || pointSet.schema !== "axm.stippling-point-set2d/v0.1" || pointSet.sourceHash !== stipplingSourceHash || pointSet.fieldSourceHash !== fieldSourceHash || pointSet.derived !== true || pointSet.rebuildable !== true) {
      throw new Error(`VFX stippling derived point-set boundary drifted for ${name}`);
    }
    if (pointSet.columns !== 40 || pointSet.rows !== 28 || pointSet.candidatesPerCell !== 2 || pointSet.candidateCount !== 2240 || pointSet.pointCount < 1) {
      throw new Error(`VFX stippling bounded default candidate grid drifted for ${name}`);
    }
    if (!realization || realization.schema !== "axm.static-svg-realization/v0.1" || realization.kind !== "field-stippling2d" || realization.sourceHash !== stipplingSourceHash || realization.fieldSourceHash !== fieldSourceHash || realization.pointSetHash !== pointSet.pointSetHash || realization.derived !== true || realization.replaceable !== true) {
      throw new Error(`VFX stippling SVG lineage drifted for ${name}`);
    }

    const normalizedField = normalizeFieldHand.execute(stippling.makeStipplingFieldState(choice));
    const normalizedStippling = normalizeStipplingHand.execute(normalizedField.state);
    const exactBudget = buildHand.execute(normalizedStippling.state, { columns: 40, rows: 28, candidatesPerCell: 2, maxCandidates: 2240 }).state.stipplingPointSets[stipplingSource.id];
    const roomyBudget = buildHand.execute(normalizedStippling.state, { columns: 40, rows: 28, candidatesPerCell: 2, maxCandidates: 16384 }).state.stipplingPointSets[stipplingSource.id];
    if (exactBudget.pointSetHash !== roomyBudget.pointSetHash || roomyBudget.pointSetHash !== pointSet.pointSetHash) {
      throw new Error(`VFX stippling sufficient working-set budget changed derived points for ${name}`);
    }
    let budgetFailure = null;
    try {
      buildHand.execute(normalizedStippling.state, { columns: 40, rows: 28, candidatesPerCell: 2, maxCandidates: 2239 });
    } catch (error) {
      budgetFailure = String(error?.message || error);
    }
    if (!budgetFailure?.includes("stippling candidate budget exceeded")) throw new Error(`VFX stippling insufficient budget did not fail loudly for ${name}`);
    if (runtime.hashValue(normalizedStippling.state.fieldSource) !== fieldSourceHash || runtime.hashValue(normalizedStippling.state.stipplingSource) !== stipplingSourceHash) {
      throw new Error(`VFX stippling failed budget attempt rewrote retained sources for ${name}`);
    }

    const sourceForAdapter = { ...stipplingSource, __sourceHash: stipplingSourceHash };
    const adapted = stipplingPointSetToAxmScene(pointSet, sourceForAdapter);
    variants[name] = {
      fieldRequestBytes,
      treatmentRequestBytes,
      fieldSource,
      fieldSourceHash,
      fieldSourceBytes: stableBytes(fieldSource),
      stipplingSource,
      stipplingSourceHash,
      stipplingSourceBytes: stableBytes(stipplingSource),
      pointSet,
      pointSetBytes: stableBytes(pointSet),
      svgBytes: Buffer.from(realization.content, "utf8"),
      stateBytes: stableBytes(finalState),
      adapted,
      finalStateHash: human.finalStateHash,
      budgetFailure,
      realization,
    };
  }

  if (variants.normal.fieldSourceHash !== variants.invert.fieldSourceHash || variants.normal.fieldSourceBytes.compare(variants.invert.fieldSourceBytes) !== 0) {
    throw new Error("stippling valueMode choice rewrote canonical scalar-field source");
  }
  if (JSON.stringify(requestWithoutValueMode(JSON.parse(variants.normal.treatmentRequestBytes))) !== JSON.stringify(requestWithoutValueMode(JSON.parse(variants.invert.treatmentRequestBytes)))) {
    throw new Error("stippling proof fixture changed treatment request fields other than explicit valueMode");
  }
  if (JSON.stringify(sourceWithoutValueMode(variants.normal.stipplingSource)) !== JSON.stringify(sourceWithoutValueMode(variants.invert.stipplingSource))) {
    throw new Error("stippling proof fixture changed retained treatment fields other than explicit valueMode");
  }
  if (variants.normal.stipplingSourceHash === variants.invert.stipplingSourceHash || variants.normal.pointSet.pointSetHash === variants.invert.pointSet.pointSetHash) {
    throw new Error("stippling explicit valueMode choice did not change retained treatment/derived point identities");
  }

  const normalCandidates = variants.normal.pointSet.points.map((point) => point.candidateIndex);
  const invertCandidates = variants.invert.pointSet.points.map((point) => point.candidateIndex);
  const shared = new Set(normalCandidates.filter((candidate) => new Set(invertCandidates).has(candidate)));
  if (variants.normal.pointSet.pointCount === variants.invert.pointSet.pointCount && normalCandidates.every((candidate, index) => candidate === invertCandidates[index])) {
    throw new Error("stippling explicit valueMode choice did not change accepted candidate geography");
  }
  if (variants.normal.adapted.bytes.compare(variants.invert.adapted.bytes) === 0) {
    throw new Error("stippling distinct derived point sets did not change native observation scene bytes");
  }

  const receiptVariants = Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
    field_request_sha256: sha256(row.fieldRequestBytes),
    treatment_request_sha256: sha256(row.treatmentRequestBytes),
    field_source: { schema: row.fieldSource.schema, hash: row.fieldSourceHash, bytes_sha256: sha256(row.fieldSourceBytes) },
    stippling_source: {
      schema: row.stipplingSource.schema,
      hash: row.stipplingSourceHash,
      bytes_sha256: sha256(row.stipplingSourceBytes),
      value_mode: row.stipplingSource.valueMode,
      pattern_seed: row.stipplingSource.patternSeed,
      min_density: row.stipplingSource.minDensity,
      max_density: row.stipplingSource.maxDensity,
      response_power: row.stipplingSource.responsePower,
      jitter_cell: row.stipplingSource.jitterCell,
      radius_cell: row.stipplingSource.radiusCell,
    },
    point_set: {
      schema: row.pointSet.schema,
      hash: row.pointSet.pointSetHash,
      bytes_sha256: sha256(row.pointSetBytes),
      columns: row.pointSet.columns,
      rows: row.pointSet.rows,
      candidates_per_cell: row.pointSet.candidatesPerCell,
      candidate_count: row.pointSet.candidateCount,
      point_count: row.pointSet.pointCount,
      derived: row.pointSet.derived,
      rebuildable: row.pointSet.rebuildable,
    },
    working_set_budget: {
      exact_2240_matches_roomy_16384: true,
      insufficient_2239_failed_loudly: true,
      insufficient_2239_error: row.budgetFailure,
    },
    donor_svg: {
      schema: row.realization.schema,
      renderer: row.realization.renderer,
      bytes_sha256: sha256(row.svgBytes),
      field_source_hash: row.realization.fieldSourceHash,
      stippling_source_hash: row.realization.sourceHash,
      point_set_hash: row.realization.pointSetHash,
      derived: row.realization.derived,
      replaceable: row.realization.replaceable,
    },
    native_scene: { bytes_sha256: sha256(row.adapted.bytes), adapter: row.adapted.observation },
    final_state_sha256: sha256(row.stateBytes),
    caller_neutral_final_state_hash: row.finalStateHash,
  }]));

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: stippling.STIPPLING_FIELD2D_GRAPH.id,
      graph_version: stippling.STIPPLING_FIELD2D_GRAPH.version,
      hand_ids: expectedHands,
      files: {
        "hand-lab/src/hand-runtime.mjs": sources.runtime.sha256,
        "hand-lab/src/stippling-field2d.mjs": sources.stippling.sha256,
        "hand-lab/src/field-operators.mjs": sources.fieldOperators.sha256,
      },
    },
    caller_authority: {
      explicit_choice: "stipplingRequest.valueMode",
      scalar_field_source_held_exactly_constant: true,
      other_treatment_fields_held_constant: true,
      caller_requests_mutated: false,
      caller_neutral_repeat_verification: "PASS",
      canonical_field_source_remains_authoritative: true,
      canonical_stippling_source_remains_authoritative: true,
      point_sets_are_canonical: false,
      donor_svg_is_canonical: false,
      native_scene_is_canonical: false,
      consumer_semantics_assigned: false,
    },
    variants: receiptVariants,
    comparison: {
      candidate_universe_count: 2240,
      accepted_point_counts: { normal: variants.normal.pointSet.pointCount, invert: variants.invert.pointSet.pointCount },
      shared_accepted_candidate_count: shared.size,
      accepted_candidate_geography_differs: true,
      native_scene_bytes_differ: true,
      fixed_native_style: true,
    },
    replaceability: {
      same_derived_point_set_can_feed_donor_svg_and_native_scene_realizations: true,
      donor_svg_and_native_scene_do_not_rewrite_field_or_treatment_truth: true,
    },
    authority: "caller field/treatment requests and normalized VFX scalar-field/stippling sources are authoritative; point sets are derived/rebuildable and SVG/native scene/render bodies remain replaceable observations",
    truth_boundary: {
      proven: "current VFX field-stippling graph execution, caller-neutral replay, exact scalar-field retention across an explicit normal/invert treatment choice, deterministic seeded candidate acceptance, bounded derived point-set lineage, sufficient-budget non-creativity, loud insufficient-budget failure, donor-SVG lineage and native scene eligibility from the same derived point sets",
      not_proven: [
        "blue-noise or optimal stippling distribution",
        "print or physical ink behavior",
        "circle-equivalent native rasterization",
        "anti-aliasing quality",
        "aesthetic quality",
        "accessibility suitability",
        "consumer/product meaning",
        "real-time/device performance",
        "GPU/browser equivalence",
        "cross-machine bitwise determinism",
      ],
    },
  };

  return {
    normalFieldSourceBytes: variants.normal.fieldSourceBytes,
    invertFieldSourceBytes: variants.invert.fieldSourceBytes,
    normalStipplingSourceBytes: variants.normal.stipplingSourceBytes,
    invertStipplingSourceBytes: variants.invert.stipplingSourceBytes,
    normalPointSetBytes: variants.normal.pointSetBytes,
    invertPointSetBytes: variants.invert.pointSetBytes,
    normalSvgBytes: variants.normal.svgBytes,
    invertSvgBytes: variants.invert.svgBytes,
    normalStateBytes: variants.normal.stateBytes,
    invertStateBytes: variants.invert.stateBytes,
    normalSceneBytes: variants.normal.adapted.bytes,
    invertSceneBytes: variants.invert.adapted.bytes,
    receipt,
  };
}
