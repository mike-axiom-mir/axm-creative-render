import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_HALFTONE_NATIVE_RECEIPT";
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

function sceneCenter(center) {
  if (!Array.isArray(center) || center.length !== 2) throw new Error("halftone native adapter requires 2D centers");
  const [x, y] = center.map(Number);
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error("halftone native adapter centers must remain inside normalized 0..1 space");
  }
  return [(x - 0.5) * 1.8, (0.5 - y) * 1.8, 0];
}

export function halftoneDotSetToAxmScene(dotSet) {
  if (!dotSet || typeof dotSet !== "object" || Array.isArray(dotSet)) throw new Error("halftone native adapter requires a dot-set object");
  if (dotSet.schema !== "axm.halftone-dot-set2d/v0.1" || dotSet.derived !== true || dotSet.rebuildable !== true) {
    throw new Error("halftone native adapter accepts only derived rebuildable v0.1 dot sets");
  }
  if (!String(dotSet.sourceHash || "").trim() || !String(dotSet.fieldSourceHash || "").trim() || !String(dotSet.dotSetHash || "").trim()) {
    throw new Error("halftone native adapter requires retained source and dot-set hashes");
  }
  if (!Number.isInteger(dotSet.columns) || !Number.isInteger(dotSet.rows) || dotSet.columns < 2 || dotSet.rows < 2) {
    throw new Error("halftone native adapter requires a bounded grid");
  }
  if (!Array.isArray(dotSet.dots) || dotSet.dots.length !== dotSet.dotCount || dotSet.dotCount !== dotSet.columns * dotSet.rows) {
    throw new Error("halftone native adapter requires an internally consistent dot set");
  }

  const cellScale = Math.min(1 / dotSet.columns, 1 / dotSet.rows) * 1.8;
  const triangles = [];
  const ordered = [...dotSet.dots].sort((a, b) => a.index - b.index);
  ordered.forEach((dot, index) => {
    if (!dot || dot.index !== index || dot.column !== index % dotSet.columns || dot.row !== Math.floor(index / dotSet.columns)) {
      throw new Error(`halftone native adapter dot order/identity mismatch at index ${index}`);
    }
    const radiusCell = Number(dot.radiusCell);
    if (!Number.isFinite(radiusCell) || !(radiusCell > 0) || radiusCell > 0.5) {
      throw new Error(`halftone native adapter requires positive bounded radius at dot ${index}`);
    }
    const [cx, cy, cz] = sceneCenter(dot.center);
    const half = radiusCell * cellScale;
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
  if (reparsed.triangles.length !== dotSet.dotCount * 2) throw new Error("halftone native adapter triangle count drifted");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-halftone-dot-set-to-axm-scene/v1",
      field_source_hash: dotSet.fieldSourceHash,
      halftone_source_hash: dotSet.sourceHash,
      dot_set_hash: dotSet.dotSetHash,
      input_dot_count: dotSet.dotCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: scene.triangles.length,
      output_sha256: sha256(bytes),
      centers_and_radius_only: true,
      style_is_fixed: true,
      consumer_semantics_assigned: false,
      adapter_policy: "each positive-radius derived dot becomes one fixed-albedo two-triangle square centered at the retained derived sample center; radius changes geometry only, and canonical VFX field/treatment sources are not rewritten",
    },
  };
}

function sourceWithoutValueMode(source) {
  const copy = structuredClone(source);
  delete copy.valueMode;
  return copy;
}

function requestWithoutValueMode(request) {
  const copy = structuredClone(request);
  delete copy.valueMode;
  return copy;
}

export async function observeVisualEffectHalftoneNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    halftone: resolve(rootPath, "hand-lab/src/halftone-field2d.mjs"),
    fieldOperators: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const halftone = await import(`${pathToFileURL(paths.halftone).href}?sha=${sources.halftone.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(halftone.HALFTONE_FIELD2D_HANDS) || !halftone.HALFTONE_FIELD2D_GRAPH || typeof halftone.makeHalftoneFieldState !== "function") {
    throw new Error("VFX donor halftone graph is unavailable");
  }
  if (halftone.HALFTONE_FIELD2D_GRAPH.id !== "fx.stylize.halftone-field2d-static-svg" || halftone.HALFTONE_FIELD2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX halftone graph identity");
  }
  const expectedHands = [
    "fx.field.fbm-source-normalize",
    "fx.stylize.halftone2d-source-normalize",
    "fx.stylize.halftone2d-dot-set-build",
    "fx.stylize.halftone2d-static-svg-realize",
  ];
  if (JSON.stringify(halftone.HALFTONE_FIELD2D_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX halftone Hand boundary");
  }

  const common = {
    fieldId: "creative-render-halftone-field",
    seed: 20260917,
    frequency: 2.75,
    octaves: 4,
    lacunarity: 2,
    gain: 0.52,
    offset: [0.07, -0.11],
    id: "creative-render-halftone",
    minRadiusCell: 0.08,
    maxRadiusCell: 0.44,
    responsePower: 1.25,
  };
  const choices = {
    normal: { ...common, valueMode: "normal" },
    invert: { ...common, valueMode: "invert" },
  };

  const handById = new Map(halftone.HALFTONE_FIELD2D_HANDS.map((hand) => [hand.id, hand]));
  const buildHand = handById.get("fx.stylize.halftone2d-dot-set-build");
  const normalizeFieldHand = handById.get("fx.field.fbm-source-normalize");
  const normalizeHalftoneHand = handById.get("fx.stylize.halftone2d-source-normalize");
  if (!buildHand || !normalizeFieldHand || !normalizeHalftoneHand) throw new Error("VFX halftone direct proof Hands are unavailable");

  const execute = (state, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(halftone.HALFTONE_FIELD2D_HANDS),
    graph: halftone.HALFTONE_FIELD2D_GRAPH,
    initialState: state,
    context: { callerKind },
  });

  const variants = {};
  for (const [name, choice] of Object.entries(choices)) {
    const initialState = halftone.makeHalftoneFieldState(choice);
    const fieldRequestBytes = stableBytes(initialState.fieldRequest);
    const treatmentRequestBytes = stableBytes(initialState.halftoneRequest);
    const human = execute(initialState, "human");
    const machine = execute(initialState, "machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`VFX halftone caller-neutral repeat verification failed for ${name}`);

    const finalState = human.finalState;
    if (stableBytes(finalState.fieldRequest).compare(fieldRequestBytes) !== 0) throw new Error(`VFX halftone field request mutated for ${name}`);
    if (stableBytes(finalState.halftoneRequest).compare(treatmentRequestBytes) !== 0) throw new Error(`VFX halftone treatment request mutated for ${name}`);

    const fieldSource = finalState.fieldSource;
    const fieldSourceHash = finalState.fieldSourceHash;
    const halftoneSource = finalState.halftoneSource;
    const halftoneSourceHash = finalState.halftoneSourceHash;
    const dotSet = finalState.halftoneDotSets?.[halftoneSource?.id];
    const realization = finalState.realizations?.halftoneStaticSvg;
    if (!fieldSource || runtime.hashValue(fieldSource) !== fieldSourceHash) throw new Error(`VFX halftone field source hash drifted for ${name}`);
    if (!halftoneSource || runtime.hashValue(halftoneSource) !== halftoneSourceHash || halftoneSource.fieldSourceHash !== fieldSourceHash) {
      throw new Error(`VFX halftone treatment source lineage drifted for ${name}`);
    }
    if (!dotSet || dotSet.schema !== "axm.halftone-dot-set2d/v0.1" || dotSet.sourceHash !== halftoneSourceHash || dotSet.fieldSourceHash !== fieldSourceHash || dotSet.derived !== true || dotSet.rebuildable !== true) {
      throw new Error(`VFX halftone derived dot-set boundary drifted for ${name}`);
    }
    if (dotSet.columns !== 48 || dotSet.rows !== 32 || dotSet.dotCount !== 1536) throw new Error(`VFX halftone bounded default grid drifted for ${name}`);
    if (!realization || realization.schema !== "axm.static-svg-realization/v0.1" || realization.kind !== "halftone-field2d" || realization.sourceHash !== halftoneSourceHash || realization.fieldSourceHash !== fieldSourceHash || realization.dotSetHash !== dotSet.dotSetHash || realization.derived !== true || realization.replaceable !== true) {
      throw new Error(`VFX halftone SVG lineage drifted for ${name}`);
    }

    const normalizedField = normalizeFieldHand.execute(halftone.makeHalftoneFieldState(choice));
    const normalizedHalftone = normalizeHalftoneHand.execute(normalizedField.state);
    const exactBudget = buildHand.execute(normalizedHalftone.state, { columns: 48, rows: 32, maxDots: 1536 }).state.halftoneDotSets[halftoneSource.id];
    const roomyBudget = buildHand.execute(normalizedHalftone.state, { columns: 48, rows: 32, maxDots: 16384 }).state.halftoneDotSets[halftoneSource.id];
    if (exactBudget.dotSetHash !== roomyBudget.dotSetHash || roomyBudget.dotSetHash !== dotSet.dotSetHash) {
      throw new Error(`VFX halftone sufficient working-set budget changed derived dots for ${name}`);
    }
    let budgetFailure = null;
    try {
      buildHand.execute(normalizedHalftone.state, { columns: 48, rows: 32, maxDots: 1535 });
    } catch (error) {
      budgetFailure = String(error?.message || error);
    }
    if (!budgetFailure?.includes("halftone dot budget exceeded")) throw new Error(`VFX halftone insufficient budget did not fail loudly for ${name}`);
    if (runtime.hashValue(normalizedHalftone.state.fieldSource) !== fieldSourceHash || runtime.hashValue(normalizedHalftone.state.halftoneSource) !== halftoneSourceHash) {
      throw new Error(`VFX halftone failed budget attempt rewrote retained sources for ${name}`);
    }

    const adapted = halftoneDotSetToAxmScene(dotSet);
    variants[name] = {
      fieldRequestBytes,
      treatmentRequestBytes,
      fieldSource,
      fieldSourceHash,
      fieldSourceBytes: stableBytes(fieldSource),
      halftoneSource,
      halftoneSourceHash,
      halftoneSourceBytes: stableBytes(halftoneSource),
      dotSet,
      dotSetBytes: stableBytes(dotSet),
      svgBytes: Buffer.from(realization.content, "utf8"),
      stateBytes: stableBytes(finalState),
      adapted,
      finalStateHash: human.finalStateHash,
      budgetFailure,
      realization,
    };
  }

  if (variants.normal.fieldSourceHash !== variants.invert.fieldSourceHash || variants.normal.fieldSourceBytes.compare(variants.invert.fieldSourceBytes) !== 0) {
    throw new Error("halftone valueMode choice rewrote canonical scalar-field source");
  }
  if (JSON.stringify(requestWithoutValueMode(JSON.parse(variants.normal.treatmentRequestBytes))) !== JSON.stringify(requestWithoutValueMode(JSON.parse(variants.invert.treatmentRequestBytes)))) {
    throw new Error("halftone proof fixture changed treatment request fields other than explicit valueMode");
  }
  if (JSON.stringify(sourceWithoutValueMode(variants.normal.halftoneSource)) !== JSON.stringify(sourceWithoutValueMode(variants.invert.halftoneSource))) {
    throw new Error("halftone proof fixture changed retained treatment fields other than explicit valueMode");
  }
  if (variants.normal.halftoneSourceHash === variants.invert.halftoneSourceHash || variants.normal.dotSet.dotSetHash === variants.invert.dotSet.dotSetHash) {
    throw new Error("halftone explicit valueMode choice did not change retained treatment/derived dot identities");
  }

  let radiusDifferences = 0;
  for (let i = 0; i < variants.normal.dotSet.dotCount; i += 1) {
    const a = variants.normal.dotSet.dots[i];
    const b = variants.invert.dotSet.dots[i];
    if (a.index !== b.index || a.column !== b.column || a.row !== b.row || JSON.stringify(a.center) !== JSON.stringify(b.center) || a.fieldValue !== b.fieldValue) {
      throw new Error(`halftone valueMode choice changed derived sampling identity at dot ${i}`);
    }
    if (a.radiusCell !== b.radiusCell) radiusDifferences += 1;
  }
  if (radiusDifferences < 1) throw new Error("halftone explicit valueMode choice did not change any derived radius");
  if (variants.normal.adapted.bytes.compare(variants.invert.adapted.bytes) === 0) {
    throw new Error("halftone distinct derived radii did not change native observation scene bytes");
  }

  const receiptVariants = Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
    field_request_sha256: sha256(row.fieldRequestBytes),
    treatment_request_sha256: sha256(row.treatmentRequestBytes),
    field_source: {
      schema: row.fieldSource.schema,
      hash: row.fieldSourceHash,
      bytes_sha256: sha256(row.fieldSourceBytes),
    },
    halftone_source: {
      schema: row.halftoneSource.schema,
      hash: row.halftoneSourceHash,
      bytes_sha256: sha256(row.halftoneSourceBytes),
      value_mode: row.halftoneSource.valueMode,
      min_radius_cell: row.halftoneSource.minRadiusCell,
      max_radius_cell: row.halftoneSource.maxRadiusCell,
      response_power: row.halftoneSource.responsePower,
    },
    dot_set: {
      schema: row.dotSet.schema,
      hash: row.dotSet.dotSetHash,
      bytes_sha256: sha256(row.dotSetBytes),
      columns: row.dotSet.columns,
      rows: row.dotSet.rows,
      dot_count: row.dotSet.dotCount,
      derived: row.dotSet.derived,
      rebuildable: row.dotSet.rebuildable,
    },
    working_set_budget: {
      exact_1536_matches_roomy_16384: true,
      insufficient_1535_failed_loudly: true,
      insufficient_1535_error: row.budgetFailure,
    },
    donor_svg: {
      schema: row.realization.schema,
      renderer: row.realization.renderer,
      bytes_sha256: sha256(row.svgBytes),
      field_source_hash: row.realization.fieldSourceHash,
      halftone_source_hash: row.realization.sourceHash,
      dot_set_hash: row.realization.dotSetHash,
      derived: row.realization.derived,
      replaceable: row.realization.replaceable,
    },
    native_scene: {
      bytes_sha256: sha256(row.adapted.bytes),
      adapter: row.adapted.observation,
    },
    final_state_sha256: sha256(row.stateBytes),
    caller_neutral_final_state_hash: row.finalStateHash,
  }]));

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: halftone.HALFTONE_FIELD2D_GRAPH.id,
      graph_version: halftone.HALFTONE_FIELD2D_GRAPH.version,
      hand_ids: expectedHands,
      files: {
        "hand-lab/src/hand-runtime.mjs": sources.runtime.sha256,
        "hand-lab/src/halftone-field2d.mjs": sources.halftone.sha256,
        "hand-lab/src/field-operators.mjs": sources.fieldOperators.sha256,
      },
    },
    caller_authority: {
      explicit_choice: "halftoneRequest.valueMode",
      scalar_field_source_held_exactly_constant: true,
      other_treatment_fields_held_constant: true,
      caller_requests_mutated: false,
      caller_neutral_repeat_verification: "PASS",
      canonical_field_source_remains_authoritative: true,
      canonical_halftone_source_remains_authoritative: true,
      dot_sets_are_canonical: false,
      donor_svg_is_canonical: false,
      native_scene_is_canonical: false,
      consumer_semantics_assigned: false,
    },
    variants: receiptVariants,
    comparison: {
      dot_count: variants.normal.dotSet.dotCount,
      same_sample_centers_and_field_values: true,
      radius_difference_count: radiusDifferences,
      native_scene_bytes_differ: true,
      fixed_native_style: true,
    },
    replaceability: {
      same_derived_dot_set_can_feed_donor_svg_and_native_scene_realizations: true,
      donor_svg_and_native_scene_do_not_rewrite_field_or_treatment_truth: true,
    },
    authority: "caller field/treatment requests and normalized VFX scalar-field/halftone sources are authoritative; dot sets are derived/rebuildable and SVG/native scene/render bodies remain replaceable observations",
    truth_boundary: {
      proven: "current VFX field-driven halftone graph execution, caller-neutral replay, exact scalar-field retention across an explicit normal/invert treatment choice, bounded deterministic dot-set lineage, sufficient-budget non-creativity, loud insufficient-budget failure, donor-SVG lineage and native scene eligibility from the same derived dot sets",
      not_proven: [
        "photographic halftone reproduction",
        "physical ink or print-screen behavior",
        "color separation",
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
    normalHalftoneSourceBytes: variants.normal.halftoneSourceBytes,
    invertHalftoneSourceBytes: variants.invert.halftoneSourceBytes,
    normalDotSetBytes: variants.normal.dotSetBytes,
    invertDotSetBytes: variants.invert.dotSetBytes,
    normalSvgBytes: variants.normal.svgBytes,
    invertSvgBytes: variants.invert.svgBytes,
    normalStateBytes: variants.normal.stateBytes,
    invertStateBytes: variants.invert.stateBytes,
    normalSceneBytes: variants.normal.adapted.bytes,
    invertSceneBytes: variants.invert.adapted.bytes,
    receipt,
  };
}
