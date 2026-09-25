import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_HATCHING_NATIVE_RECEIPT";
const VERSION = 1;
const FIXED_ALBEDO = [238, 238, 238];
const FIXED_HALF_WIDTH = 0.0035;

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

function scenePoint(point) {
  if (!Array.isArray(point) || point.length !== 2) throw new Error("hatching native adapter requires 2D endpoints");
  const [x, y] = point.map(Number);
  if (![x, y].every(Number.isFinite)) throw new Error("hatching native adapter requires finite endpoints");
  return [(x - 0.5) * 1.8, (0.5 - y) * 1.8, 0];
}

export function hatchingStrokeSetToAxmScene(strokeSet) {
  if (!strokeSet || typeof strokeSet !== "object" || Array.isArray(strokeSet)) throw new Error("hatching native adapter requires a stroke-set object");
  if (strokeSet.schema !== "axm.hatching-stroke-set2d/v0.1" || strokeSet.derived !== true || strokeSet.rebuildable !== true) {
    throw new Error("hatching native adapter accepts only derived rebuildable v0.1 stroke sets");
  }
  for (const [label, value] of [["hatching source", strokeSet.sourceHash], ["field source", strokeSet.fieldSourceHash], ["flow source", strokeSet.flowSourceHash], ["stroke set", strokeSet.strokeSetHash]]) {
    if (!String(value || "").trim()) throw new Error(`hatching native adapter requires retained ${label} hash`);
  }
  if (!Number.isInteger(strokeSet.columns) || !Number.isInteger(strokeSet.rows) || strokeSet.columns < 2 || strokeSet.rows < 2) {
    throw new Error("hatching native adapter requires a bounded grid");
  }
  if (!Array.isArray(strokeSet.strokes) || strokeSet.strokes.length !== strokeSet.strokeCount || strokeSet.strokeCount !== strokeSet.columns * strokeSet.rows) {
    throw new Error("hatching native adapter requires an internally consistent stroke set");
  }

  const triangles = [];
  const ordered = [...strokeSet.strokes].sort((a, b) => a.index - b.index);
  ordered.forEach((stroke, index) => {
    if (!stroke || stroke.index !== index || stroke.column !== index % strokeSet.columns || stroke.row !== Math.floor(index / strokeSet.columns)) {
      throw new Error(`hatching native adapter stroke order/identity mismatch at index ${index}`);
    }
    const from = scenePoint(stroke.from);
    const to = scenePoint(stroke.to);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !Number.isFinite(length)) throw new Error(`hatching native adapter requires positive finite stroke length at ${index}`);
    const nx = (-dy / length) * FIXED_HALF_WIDTH;
    const ny = (dx / length) * FIXED_HALF_WIDTH;
    const a = [from[0] + nx, from[1] + ny, 0];
    const b = [to[0] + nx, to[1] + ny, 0];
    const c = [to[0] - nx, to[1] - ny, 0];
    const d = [from[0] - nx, from[1] - ny, 0];
    triangles.push(
      { vertices: [a, b, c], albedo: [...FIXED_ALBEDO] },
      { vertices: [a, c, d], albedo: [...FIXED_ALBEDO] },
    );
  });

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== strokeSet.strokeCount * 2) throw new Error("hatching native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-hatching-stroke-set-to-axm-scene/v1",
      field_source_hash: strokeSet.fieldSourceHash,
      flow_source_hash: strokeSet.flowSourceHash,
      hatching_source_hash: strokeSet.sourceHash,
      stroke_set_hash: strokeSet.strokeSetHash,
      input_stroke_count: strokeSet.strokeCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: scene.triangles.length,
      output_sha256: sha256(bytes),
      endpoints_only: true,
      fixed_half_width: FIXED_HALF_WIDTH,
      style_is_fixed: true,
      consumer_semantics_assigned: false,
      adapter_policy: "each positive-length derived hatch stroke becomes one fixed-width fixed-albedo two-triangle strip from retained derived endpoints; source field/flow/treatment state is never rewritten",
    },
  };
}

function withoutValueMode(value) {
  const copy = structuredClone(value);
  delete copy.valueMode;
  return copy;
}

export async function observeVisualEffectHatchingNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    hatching: resolve(rootPath, "hand-lab/src/hatching-field2d.mjs"),
    fieldFlow: resolve(rootPath, "hand-lab/src/field-flow-operators.mjs"),
    fieldOperators: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const hatching = await import(`${pathToFileURL(paths.hatching).href}?sha=${sources.hatching.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(hatching.HATCHING_FIELD2D_HANDS) || !hatching.HATCHING_FIELD2D_GRAPH || typeof hatching.makeHatchingFieldState !== "function") {
    throw new Error("VFX donor hatching graph is unavailable");
  }
  if (hatching.HATCHING_FIELD2D_GRAPH.id !== "fx.stylize.field-guided-hatching2d-static-svg" || hatching.HATCHING_FIELD2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX hatching graph identity");
  }
  const expectedHands = [
    "fx.field.flow-source-normalize",
    "fx.stylize.hatching2d-source-normalize",
    "fx.stylize.hatching2d-stroke-set-build",
    "fx.stylize.hatching2d-static-svg-realize",
  ];
  if (JSON.stringify(hatching.HATCHING_FIELD2D_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX hatching Hand boundary");
  }

  const common = {
    fieldId: "creative-render-hatching-field",
    seed: 20260917,
    frequency: 2.75,
    octaves: 4,
    lacunarity: 2,
    gain: 0.52,
    offset: [0.07, -0.11],
    flowId: "creative-render-hatching-flow",
    flowMode: "tangent",
    sampleStep: 0.015625,
    flowStrength: 1,
    id: "creative-render-hatching",
    minLengthCell: 0.15,
    maxLengthCell: 0.85,
    responsePower: 1.25,
    fallbackAngleTurns: 0.125,
  };
  const choices = {
    normal: { ...common, valueMode: "normal" },
    invert: { ...common, valueMode: "invert" },
  };

  const handById = new Map(hatching.HATCHING_FIELD2D_HANDS.map((hand) => [hand.id, hand]));
  const normalizeFlow = handById.get("fx.field.flow-source-normalize");
  const normalizeHatching = handById.get("fx.stylize.hatching2d-source-normalize");
  const buildStrokes = handById.get("fx.stylize.hatching2d-stroke-set-build");
  if (!normalizeFlow || !normalizeHatching || !buildStrokes) throw new Error("VFX hatching direct proof Hands are unavailable");

  const execute = (state, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(hatching.HATCHING_FIELD2D_HANDS),
    graph: hatching.HATCHING_FIELD2D_GRAPH,
    initialState: state,
    context: { callerKind },
  });

  const variants = {};
  for (const [name, choice] of Object.entries(choices)) {
    const initialState = hatching.makeHatchingFieldState(choice);
    const fieldRequestBytes = stableBytes(initialState.fieldRequest);
    const flowRequestBytes = stableBytes(initialState.flowRequest);
    const treatmentRequestBytes = stableBytes(initialState.hatchingRequest);
    const human = execute(initialState, "human");
    const machine = execute(initialState, "machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`VFX hatching caller-neutral repeat verification failed for ${name}`);
    const finalState = human.finalState;
    if (stableBytes(finalState.fieldRequest).compare(fieldRequestBytes) !== 0 || stableBytes(finalState.flowRequest).compare(flowRequestBytes) !== 0 || stableBytes(finalState.hatchingRequest).compare(treatmentRequestBytes) !== 0) {
      throw new Error(`VFX hatching caller request mutated for ${name}`);
    }

    const { fieldSource, fieldSourceHash, flowSource, flowSourceHash, hatchingSource, hatchingSourceHash } = finalState;
    const strokeSet = finalState.hatchingStrokeSets?.[hatchingSource?.id];
    const realization = finalState.realizations?.hatchingStaticSvg;
    if (!fieldSource || runtime.hashValue(fieldSource) !== fieldSourceHash) throw new Error(`VFX hatching field source hash drifted for ${name}`);
    if (!flowSource || runtime.hashValue(flowSource) !== flowSourceHash || flowSource.scalarSource?.sourceHash !== fieldSourceHash) throw new Error(`VFX hatching flow source lineage drifted for ${name}`);
    if (!hatchingSource || runtime.hashValue(hatchingSource) !== hatchingSourceHash || hatchingSource.fieldSourceHash !== fieldSourceHash || hatchingSource.flowSourceHash !== flowSourceHash) {
      throw new Error(`VFX hatching treatment source lineage drifted for ${name}`);
    }
    if (!strokeSet || strokeSet.schema !== "axm.hatching-stroke-set2d/v0.1" || strokeSet.sourceHash !== hatchingSourceHash || strokeSet.fieldSourceHash !== fieldSourceHash || strokeSet.flowSourceHash !== flowSourceHash || strokeSet.derived !== true || strokeSet.rebuildable !== true) {
      throw new Error(`VFX hatching derived stroke-set boundary drifted for ${name}`);
    }
    if (strokeSet.columns !== 48 || strokeSet.rows !== 32 || strokeSet.strokeCount !== 1536) throw new Error(`VFX hatching bounded default grid drifted for ${name}`);
    if (!realization || realization.schema !== "axm.static-svg-realization/v0.1" || realization.kind !== "field-guided-hatching2d" || realization.sourceHash !== hatchingSourceHash || realization.fieldSourceHash !== fieldSourceHash || realization.flowSourceHash !== flowSourceHash || realization.strokeSetHash !== strokeSet.strokeSetHash || realization.derived !== true || realization.replaceable !== true) {
      throw new Error(`VFX hatching SVG lineage drifted for ${name}`);
    }

    const normalizedFlow = normalizeFlow.execute(hatching.makeHatchingFieldState(choice));
    const normalizedTreatment = normalizeHatching.execute(normalizedFlow.state);
    const exact = buildStrokes.execute(normalizedTreatment.state, { columns: 48, rows: 32, maxStrokes: 1536 }).state.hatchingStrokeSets[hatchingSource.id];
    const roomy = buildStrokes.execute(normalizedTreatment.state, { columns: 48, rows: 32, maxStrokes: 16384 }).state.hatchingStrokeSets[hatchingSource.id];
    if (exact.strokeSetHash !== roomy.strokeSetHash || roomy.strokeSetHash !== strokeSet.strokeSetHash) throw new Error(`VFX hatching sufficient working-set budget changed derived strokes for ${name}`);
    let budgetFailure = null;
    try { buildStrokes.execute(normalizedTreatment.state, { columns: 48, rows: 32, maxStrokes: 1535 }); } catch (error) { budgetFailure = String(error?.message || error); }
    if (!budgetFailure?.includes("hatching stroke budget exceeded")) throw new Error(`VFX hatching insufficient budget did not fail loudly for ${name}`);
    if (runtime.hashValue(normalizedTreatment.state.fieldSource) !== fieldSourceHash || runtime.hashValue(normalizedTreatment.state.flowSource) !== flowSourceHash || runtime.hashValue(normalizedTreatment.state.hatchingSource) !== hatchingSourceHash) {
      throw new Error(`VFX hatching failed budget attempt rewrote retained sources for ${name}`);
    }

    variants[name] = {
      fieldRequestBytes, flowRequestBytes, treatmentRequestBytes,
      fieldSource, fieldSourceHash, fieldSourceBytes: stableBytes(fieldSource),
      flowSource, flowSourceHash, flowSourceBytes: stableBytes(flowSource),
      hatchingSource, hatchingSourceHash, hatchingSourceBytes: stableBytes(hatchingSource),
      strokeSet, strokeSetBytes: stableBytes(strokeSet),
      svgBytes: Buffer.from(realization.content, "utf8"),
      stateBytes: stableBytes(finalState),
      adapted: hatchingStrokeSetToAxmScene(strokeSet),
      finalStateHash: human.finalStateHash,
      budgetFailure,
      realization,
    };
  }

  for (const key of ["fieldSourceHash", "flowSourceHash"]) {
    if (variants.normal[key] !== variants.invert[key]) throw new Error(`hatching valueMode choice rewrote canonical ${key}`);
  }
  if (variants.normal.fieldSourceBytes.compare(variants.invert.fieldSourceBytes) !== 0 || variants.normal.flowSourceBytes.compare(variants.invert.flowSourceBytes) !== 0) {
    throw new Error("hatching valueMode choice rewrote retained field/flow source bytes");
  }
  if (JSON.stringify(withoutValueMode(JSON.parse(variants.normal.treatmentRequestBytes))) !== JSON.stringify(withoutValueMode(JSON.parse(variants.invert.treatmentRequestBytes)))) {
    throw new Error("hatching proof fixture changed treatment request fields other than explicit valueMode");
  }
  if (JSON.stringify(withoutValueMode(variants.normal.hatchingSource)) !== JSON.stringify(withoutValueMode(variants.invert.hatchingSource))) {
    throw new Error("hatching proof fixture changed retained treatment fields other than explicit valueMode");
  }
  if (variants.normal.hatchingSourceHash === variants.invert.hatchingSourceHash || variants.normal.strokeSet.strokeSetHash === variants.invert.strokeSet.strokeSetHash) {
    throw new Error("hatching explicit valueMode choice did not change retained treatment/derived stroke identities");
  }

  let lengthDifferences = 0;
  for (let i = 0; i < variants.normal.strokeSet.strokeCount; i += 1) {
    const a = variants.normal.strokeSet.strokes[i];
    const b = variants.invert.strokeSet.strokes[i];
    if (a.index !== b.index || a.column !== b.column || a.row !== b.row || JSON.stringify(a.center) !== JSON.stringify(b.center) || a.fieldValue !== b.fieldValue || a.flowMagnitude !== b.flowMagnitude || JSON.stringify(a.direction) !== JSON.stringify(b.direction)) {
      throw new Error(`hatching valueMode choice changed sampling/flow identity at stroke ${i}`);
    }
    if (a.lengthCell !== b.lengthCell) lengthDifferences += 1;
  }
  if (lengthDifferences < 1) throw new Error("hatching explicit valueMode choice did not change any derived stroke length");
  if (variants.normal.adapted.bytes.compare(variants.invert.adapted.bytes) === 0) throw new Error("hatching distinct derived endpoints did not change native observation scene bytes");

  const receiptVariants = Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
    field_request_sha256: sha256(row.fieldRequestBytes),
    flow_request_sha256: sha256(row.flowRequestBytes),
    treatment_request_sha256: sha256(row.treatmentRequestBytes),
    field_source: { schema: row.fieldSource.schema, hash: row.fieldSourceHash, bytes_sha256: sha256(row.fieldSourceBytes) },
    flow_source: { schema: row.flowSource.schema, hash: row.flowSourceHash, bytes_sha256: sha256(row.flowSourceBytes), mode: row.flowSource.mode, sample_step: row.flowSource.sampleStep, strength: row.flowSource.strength },
    hatching_source: { schema: row.hatchingSource.schema, hash: row.hatchingSourceHash, bytes_sha256: sha256(row.hatchingSourceBytes), value_mode: row.hatchingSource.valueMode, min_length_cell: row.hatchingSource.minLengthCell, max_length_cell: row.hatchingSource.maxLengthCell, response_power: row.hatchingSource.responsePower, fallback_angle_turns: row.hatchingSource.fallbackAngleTurns },
    stroke_set: { schema: row.strokeSet.schema, hash: row.strokeSet.strokeSetHash, bytes_sha256: sha256(row.strokeSetBytes), columns: row.strokeSet.columns, rows: row.strokeSet.rows, stroke_count: row.strokeSet.strokeCount, derived: row.strokeSet.derived, rebuildable: row.strokeSet.rebuildable },
    working_set_budget: { exact_1536_matches_roomy_16384: true, insufficient_1535_failed_loudly: true, insufficient_1535_error: row.budgetFailure },
    donor_svg: { schema: row.realization.schema, renderer: row.realization.renderer, bytes_sha256: sha256(row.svgBytes), field_source_hash: row.realization.fieldSourceHash, flow_source_hash: row.realization.flowSourceHash, hatching_source_hash: row.realization.sourceHash, stroke_set_hash: row.realization.strokeSetHash, derived: row.realization.derived, replaceable: row.realization.replaceable },
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
      graph_id: hatching.HATCHING_FIELD2D_GRAPH.id,
      graph_version: hatching.HATCHING_FIELD2D_GRAPH.version,
      hand_ids: expectedHands,
      files: {
        "hand-lab/src/hand-runtime.mjs": sources.runtime.sha256,
        "hand-lab/src/hatching-field2d.mjs": sources.hatching.sha256,
        "hand-lab/src/field-flow-operators.mjs": sources.fieldFlow.sha256,
        "hand-lab/src/field-operators.mjs": sources.fieldOperators.sha256,
      },
    },
    caller_authority: {
      explicit_choice: "hatchingRequest.valueMode",
      scalar_field_source_held_exactly_constant: true,
      vector_flow_source_held_exactly_constant: true,
      other_treatment_fields_held_constant: true,
      caller_requests_mutated: false,
      caller_neutral_repeat_verification: "PASS",
      canonical_field_source_remains_authoritative: true,
      canonical_flow_source_remains_authoritative: true,
      canonical_hatching_source_remains_authoritative: true,
      stroke_sets_are_canonical: false,
      donor_svg_is_canonical: false,
      native_scene_is_canonical: false,
      consumer_semantics_assigned: false,
    },
    variants: receiptVariants,
    comparison: {
      stroke_count: variants.normal.strokeSet.strokeCount,
      same_centers_field_values_flow_and_directions: true,
      length_difference_count: lengthDifferences,
      native_scene_bytes_differ: true,
      fixed_native_style: true,
    },
    replaceability: {
      same_derived_stroke_set_can_feed_donor_svg_and_native_scene_realizations: true,
      donor_svg_and_native_scene_do_not_rewrite_field_flow_or_treatment_truth: true,
    },
    authority: "caller field/flow/treatment requests and normalized VFX scalar-field/vector-flow/hatching sources are authoritative; stroke sets are derived/rebuildable and SVG/native scene/render bodies remain replaceable observations",
    truth_boundary: {
      proven: "current VFX field-guided hatching graph execution, caller-neutral replay, exact scalar-field/vector-flow retention across an explicit normal/invert treatment choice, bounded deterministic stroke-set lineage, sufficient-budget non-creativity, loud insufficient-budget failure, donor-SVG lineage and native scene eligibility from the same derived strokes",
      not_proven: [
        "engraving or comic-art quality",
        "physical pen/ink behavior",
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
    normalFlowSourceBytes: variants.normal.flowSourceBytes,
    invertFlowSourceBytes: variants.invert.flowSourceBytes,
    normalHatchingSourceBytes: variants.normal.hatchingSourceBytes,
    invertHatchingSourceBytes: variants.invert.hatchingSourceBytes,
    normalStrokeSetBytes: variants.normal.strokeSetBytes,
    invertStrokeSetBytes: variants.invert.strokeSetBytes,
    normalSvgBytes: variants.normal.svgBytes,
    invertSvgBytes: variants.invert.svgBytes,
    normalStateBytes: variants.normal.stateBytes,
    invertStateBytes: variants.invert.stateBytes,
    normalSceneBytes: variants.normal.adapted.bytes,
    invertSceneBytes: variants.invert.adapted.bytes,
    receipt,
  };
}
