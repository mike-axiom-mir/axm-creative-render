import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_CONTOURS_NATIVE_RECEIPT";
const VERSION = 1;
const FIXED_ALBEDO = [238, 238, 238];
const FIXED_HALF_WIDTH = 0.0045;

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

function pointToScene(position) {
  if (!Array.isArray(position) || position.length !== 2) throw new Error("contour native adapter requires 2D endpoints");
  const [u, v] = position.map(Number);
  if (![u, v].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1) {
    throw new Error("contour native adapter endpoints must remain inside normalized 0..1 space");
  }
  return [(u - 0.5) * 1.8, (0.5 - v) * 1.8, 0];
}

export function contourSegmentSetToAxmScene(segmentSet) {
  if (!segmentSet || typeof segmentSet !== "object" || Array.isArray(segmentSet)) {
    throw new Error("contour native adapter requires a segment-set object");
  }
  if (segmentSet.schema !== "axm.contour-segment-set2d/v0.1" || segmentSet.derived !== true || segmentSet.rebuildable !== true) {
    throw new Error("contour native adapter accepts only derived rebuildable v0.1 segment sets");
  }
  if (!String(segmentSet.sourceHash || "").trim() || !String(segmentSet.fieldSourceHash || "").trim() || !String(segmentSet.segmentSetHash || "").trim()) {
    throw new Error("contour native adapter requires retained source, field and segment-set identities");
  }
  if (!Number.isInteger(segmentSet.columns) || !Number.isInteger(segmentSet.rows) || segmentSet.columns < 2 || segmentSet.rows < 2) {
    throw new Error("contour native adapter requires a bounded cell grid");
  }
  if (!Array.isArray(segmentSet.levels) || segmentSet.levels.length < 1 || !Array.isArray(segmentSet.segments) || segmentSet.segments.length !== segmentSet.segmentCount) {
    throw new Error("contour native adapter requires an internally consistent segment set");
  }

  const triangles = [];
  const ordered = [...segmentSet.segments].sort((a, b) => a.index - b.index);
  ordered.forEach((segment, index) => {
    if (!segment || segment.index !== index || !Number.isInteger(segment.levelIndex) || segment.levelIndex < 0 || segment.levelIndex >= segmentSet.levels.length) {
      throw new Error(`contour native adapter segment identity mismatch at index ${index}`);
    }
    if (Number(segment.level) !== Number(segmentSet.levels[segment.levelIndex])) {
      throw new Error(`contour native adapter segment level lineage mismatch at index ${index}`);
    }
    const start = pointToScene(segment.start);
    const end = pointToScene(segment.end);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 1e-9 || !(Number(segment.length) > 0)) {
      throw new Error(`contour native adapter rejects zero-length segment ${index}`);
    }
    const nx = (-dy / length) * FIXED_HALF_WIDTH;
    const ny = (dx / length) * FIXED_HALF_WIDTH;
    const a = [start[0] + nx, start[1] + ny, 0];
    const b = [end[0] + nx, end[1] + ny, 0];
    const c = [end[0] - nx, end[1] - ny, 0];
    const d = [start[0] - nx, start[1] - ny, 0];
    triangles.push(
      { vertices: [a, b, c], albedo: [...FIXED_ALBEDO] },
      { vertices: [a, c, d], albedo: [...FIXED_ALBEDO] },
    );
  });

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== segmentSet.segmentCount * 2) throw new Error("contour native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-contour-segment-set-to-axm-scene/v1",
      field_source_hash: segmentSet.fieldSourceHash,
      contour_source_hash: segmentSet.sourceHash,
      segment_set_hash: segmentSet.segmentSetHash,
      input_segment_count: segmentSet.segmentCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: scene.triangles.length,
      endpoints_only: true,
      fixed_width: FIXED_HALF_WIDTH * 2,
      style_is_fixed: true,
      consumer_semantics_assigned: false,
      adapter_policy: "each positive-length derived contour segment becomes one fixed-width fixed-albedo two-triangle strip; canonical VFX field and contour sources are not rewritten",
    },
  };
}

function sourceWithoutLevels(source) {
  const copy = structuredClone(source);
  delete copy.levels;
  return copy;
}

function requestWithoutLevels(request) {
  const copy = structuredClone(request);
  delete copy.levels;
  return copy;
}

export async function observeVisualEffectContoursNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    contours: resolve(rootPath, "hand-lab/src/contour-field2d.mjs"),
    fieldOperators: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)]),
  ));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const contours = await import(`${pathToFileURL(paths.contours).href}?sha=${sources.contours.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(contours.CONTOUR_FIELD2D_HANDS) || !contours.CONTOUR_FIELD2D_GRAPH || typeof contours.makeContourFieldState !== "function") {
    throw new Error("VFX donor contour graph is unavailable");
  }
  if (contours.CONTOUR_FIELD2D_GRAPH.id !== "fx.stylize.field-contours2d-static-svg" || contours.CONTOUR_FIELD2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX contour graph identity");
  }
  const expectedHands = [
    "fx.field.fbm-source-normalize",
    "fx.stylize.contour2d-source-normalize",
    "fx.stylize.contour2d-segment-set-build",
    "fx.stylize.contour2d-static-svg-realize",
  ];
  if (JSON.stringify(contours.CONTOUR_FIELD2D_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX contour Hand boundary");
  }

  const common = {
    fieldId: "creative-render-contour-field",
    seed: 2468,
    frequency: 3.25,
    octaves: 4,
    lacunarity: 2,
    gain: 0.5,
    offset: [0, 0],
    id: "creative-render-contours",
  };
  const choices = {
    baseline: { ...common, levels: [0.35, 0.5, 0.65] },
    shifted: { ...common, levels: [0.3, 0.55, 0.75] },
  };

  const handById = new Map(contours.CONTOUR_FIELD2D_HANDS.map((hand) => [hand.id, hand]));
  const normalizeFieldHand = handById.get("fx.field.fbm-source-normalize");
  const normalizeContourHand = handById.get("fx.stylize.contour2d-source-normalize");
  const buildHand = handById.get("fx.stylize.contour2d-segment-set-build");
  if (!normalizeFieldHand || !normalizeContourHand || !buildHand) throw new Error("VFX contour direct proof Hands are unavailable");

  const execute = (state, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(contours.CONTOUR_FIELD2D_HANDS),
    graph: contours.CONTOUR_FIELD2D_GRAPH,
    initialState: state,
    context: { callerKind },
  });

  const variants = {};
  for (const [name, choice] of Object.entries(choices)) {
    const initialState = contours.makeContourFieldState(choice);
    const fieldRequestBytes = stableBytes(initialState.fieldRequest);
    const contourRequestBytes = stableBytes(initialState.contourRequest);
    const human = execute(initialState, "human");
    const machine = execute(initialState, "machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`VFX contour caller-neutral repeat verification failed for ${name}`);

    const finalState = human.finalState;
    if (stableBytes(finalState.fieldRequest).compare(fieldRequestBytes) !== 0) throw new Error(`VFX contour field request mutated for ${name}`);
    if (stableBytes(finalState.contourRequest).compare(contourRequestBytes) !== 0) throw new Error(`VFX contour treatment request mutated for ${name}`);

    const fieldSource = finalState.fieldSource;
    const fieldSourceHash = finalState.fieldSourceHash;
    const contourSource = finalState.contourSource;
    const contourSourceHash = finalState.contourSourceHash;
    const segmentSet = finalState.contourSegmentSets?.[contourSource?.id];
    const realization = finalState.realizations?.contourStaticSvg;
    if (!fieldSource || runtime.hashValue(fieldSource) !== fieldSourceHash) throw new Error(`VFX contour field source hash drifted for ${name}`);
    if (!contourSource || runtime.hashValue(contourSource) !== contourSourceHash || contourSource.fieldSourceHash !== fieldSourceHash) {
      throw new Error(`VFX contour source lineage drifted for ${name}`);
    }
    if (!segmentSet || segmentSet.schema !== "axm.contour-segment-set2d/v0.1" || segmentSet.sourceHash !== contourSourceHash || segmentSet.fieldSourceHash !== fieldSourceHash || segmentSet.derived !== true || segmentSet.rebuildable !== true) {
      throw new Error(`VFX contour derived segment-set boundary drifted for ${name}`);
    }
    if (segmentSet.columns !== 48 || segmentSet.rows !== 32 || segmentSet.levels.length !== 3 || segmentSet.cellLevelProbes !== 4608 || segmentSet.segmentCount < 2) {
      throw new Error(`VFX contour bounded default working set drifted for ${name}`);
    }
    if (!realization || realization.schema !== "axm.static-svg-realization/v0.1" || realization.kind !== "field-contours2d" || realization.sourceHash !== contourSourceHash || realization.fieldSourceHash !== fieldSourceHash || realization.segmentSetHash !== segmentSet.segmentSetHash || realization.derived !== true || realization.replaceable !== true) {
      throw new Error(`VFX contour SVG lineage drifted for ${name}`);
    }

    const normalizedField = normalizeFieldHand.execute(contours.makeContourFieldState(choice));
    const normalizedContour = normalizeContourHand.execute(normalizedField.state);
    const exactProbeBudget = buildHand.execute(normalizedContour.state, { columns: 48, rows: 32, maxCellLevelProbes: 4608, maxSegments: 32768 }).state.contourSegmentSets[contourSource.id];
    const roomyProbeBudget = buildHand.execute(normalizedContour.state, { columns: 48, rows: 32, maxCellLevelProbes: 65536, maxSegments: 32768 }).state.contourSegmentSets[contourSource.id];
    if (exactProbeBudget.segmentSetHash !== roomyProbeBudget.segmentSetHash || roomyProbeBudget.segmentSetHash !== segmentSet.segmentSetHash) {
      throw new Error(`VFX contour sufficient probe budget changed derived segments for ${name}`);
    }
    const exactSegmentBudget = buildHand.execute(normalizedContour.state, { columns: 48, rows: 32, maxCellLevelProbes: 4608, maxSegments: segmentSet.segmentCount }).state.contourSegmentSets[contourSource.id];
    if (exactSegmentBudget.segmentSetHash !== segmentSet.segmentSetHash) throw new Error(`VFX contour exact segment budget changed derived segments for ${name}`);

    let probeBudgetFailure = null;
    try {
      buildHand.execute(normalizedContour.state, { columns: 48, rows: 32, maxCellLevelProbes: 4607, maxSegments: 32768 });
    } catch (error) {
      probeBudgetFailure = String(error?.message || error);
    }
    if (!probeBudgetFailure?.includes("contour cell-level probe budget exceeded")) throw new Error(`VFX contour insufficient probe budget did not fail loudly for ${name}`);

    let segmentBudgetFailure = null;
    try {
      buildHand.execute(normalizedContour.state, { columns: 48, rows: 32, maxCellLevelProbes: 4608, maxSegments: segmentSet.segmentCount - 1 });
    } catch (error) {
      segmentBudgetFailure = String(error?.message || error);
    }
    if (!segmentBudgetFailure?.includes("contour segment budget exceeded")) throw new Error(`VFX contour insufficient segment budget did not fail loudly for ${name}`);
    if (runtime.hashValue(normalizedContour.state.fieldSource) !== fieldSourceHash || runtime.hashValue(normalizedContour.state.contourSource) !== contourSourceHash) {
      throw new Error(`VFX contour failed budget attempt rewrote retained sources for ${name}`);
    }

    const adapted = contourSegmentSetToAxmScene(segmentSet);
    variants[name] = {
      fieldRequestBytes,
      contourRequestBytes,
      fieldSource,
      fieldSourceHash,
      fieldSourceBytes: stableBytes(fieldSource),
      contourSource,
      contourSourceHash,
      contourSourceBytes: stableBytes(contourSource),
      segmentSet,
      segmentSetBytes: stableBytes(segmentSet),
      svgBytes: Buffer.from(realization.content, "utf8"),
      stateBytes: stableBytes(finalState),
      adapted,
      finalStateHash: human.finalStateHash,
      probeBudgetFailure,
      segmentBudgetFailure,
      realization,
    };
  }

  if (variants.baseline.fieldSourceHash !== variants.shifted.fieldSourceHash || variants.baseline.fieldSourceBytes.compare(variants.shifted.fieldSourceBytes) !== 0) {
    throw new Error("contour level choice rewrote canonical scalar-field source");
  }
  if (JSON.stringify(requestWithoutLevels(JSON.parse(variants.baseline.contourRequestBytes))) !== JSON.stringify(requestWithoutLevels(JSON.parse(variants.shifted.contourRequestBytes)))) {
    throw new Error("contour proof fixture changed treatment request fields other than explicit levels");
  }
  if (JSON.stringify(sourceWithoutLevels(variants.baseline.contourSource)) !== JSON.stringify(sourceWithoutLevels(variants.shifted.contourSource))) {
    throw new Error("contour retained source fields beyond levels changed");
  }
  if (variants.baseline.contourSourceHash === variants.shifted.contourSourceHash || variants.baseline.segmentSet.segmentSetHash === variants.shifted.segmentSet.segmentSetHash) {
    throw new Error("explicit contour level choice did not produce distinct retained treatment and derived segment identities");
  }
  if (variants.baseline.adapted.bytes.compare(variants.shifted.adapted.bytes) === 0) {
    throw new Error("explicit contour level choice did not reach distinct native scene bytes");
  }

  const row = (variant) => ({
    field_source: { hash: variant.fieldSourceHash, bytes_sha256: sha256(variant.fieldSourceBytes) },
    contour_source: { hash: variant.contourSourceHash, bytes_sha256: sha256(variant.contourSourceBytes), levels: variant.contourSource.levels },
    segment_set: { hash: variant.segmentSet.segmentSetHash, bytes_sha256: sha256(variant.segmentSetBytes), segment_count: variant.segmentSet.segmentCount, cell_level_probes: variant.segmentSet.cellLevelProbes },
    donor_svg: { bytes_sha256: sha256(variant.svgBytes), artifact_hash: variant.realization.artifactHash, field_source_hash: variant.realization.fieldSourceHash, contour_source_hash: variant.realization.sourceHash, segment_set_hash: variant.realization.segmentSetHash, derived: variant.realization.derived, replaceable: variant.realization.replaceable },
    native_scene: { bytes_sha256: sha256(variant.adapted.bytes), triangle_count: variant.adapted.scene.triangles.length, adapter: variant.adapted.observation },
    final_state: { bytes_sha256: sha256(variant.stateBytes), hash: variant.finalStateHash },
    working_set_budget: {
      exact_4608_probes_matches_roomy_65536: true,
      exact_segment_count_matches_roomy_32768: true,
      insufficient_4607_probes_failed_loudly: true,
      insufficient_probe_error: variant.probeBudgetFailure,
      insufficient_segment_count_minus_one_failed_loudly: true,
      insufficient_segment_error: variant.segmentBudgetFailure,
    },
  });

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: contours.CONTOUR_FIELD2D_GRAPH.id,
      graph_version: contours.CONTOUR_FIELD2D_GRAPH.version,
      hand_ids: expectedHands,
      source_sha256: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, value.sha256])),
    },
    caller_authority: {
      explicit_choice: "contourRequest.levels",
      scalar_field_source_held_exactly_constant: true,
      other_contour_fields_held_constant: true,
      caller_requests_mutated: false,
      canonical_field_source_remains_authoritative: true,
      canonical_contour_source_remains_authoritative: true,
      segment_sets_are_canonical: false,
      donor_svg_is_canonical: false,
      native_scene_is_canonical: false,
      consumer_semantics_assigned: false,
    },
    variants: { baseline: row(variants.baseline), shifted: row(variants.shifted) },
    comparison: {
      field_source_hash_equal: true,
      contour_source_hashes_differ: true,
      segment_set_hashes_differ: true,
      native_scene_bytes_differ: true,
      fixed_native_style: true,
    },
    replaceability: {
      same_derived_segment_set_can_feed_donor_svg_and_native_scene_realizations: true,
      donor_svg_and_native_scene_do_not_rewrite_field_or_contour_truth: true,
    },
    authority: "caller-authored field and contour-level requests plus normalized donor sources remain authoritative; contour segment sets are derived/rebuildable",
    truth_boundary: "native strips only observe derived contour endpoints with fixed width/style; pixel difference can prove propagation, not contour quality, semantic meaning, physical correctness, accessibility or performance",
  };

  return { receipt, variants };
}
