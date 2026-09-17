import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_BRANCH_FLOW_GUIDED_NATIVE_RECEIPT";
const VERSION = 1;
const DEFAULT_SUBDIVISIONS = 8;
const HALF_WIDTH = 0.0045;
const FIXED_ALBEDO = [151, 211, 111];
const round6 = (value) => Number(Number(value).toFixed(6));
const round9 = (value) => Number(Number(value).toFixed(9));

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

function normalizedPoint(point, label) {
  if (!Array.isArray(point) || point.length !== 2) throw new Error(`${label} must be a 2D point`);
  const out = point.map(Number);
  if (!out.every(Number.isFinite) || out.some((value) => value < 0 || value > 1)) {
    throw new Error(`${label} must remain inside normalized 0..1 space`);
  }
  return out;
}

function scenePoint(point) {
  const [x, y] = normalizedPoint(point, "flow-guided branch adapter point");
  return [round9((x - 0.5) * 1.8), round9((0.5 - y) * 1.8), 0];
}

function quadraticPoint(start, control, end, t) {
  const u = 1 - t;
  return [
    round9(u * u * start[0] + 2 * u * t * control[0] + t * t * end[0]),
    round9(u * u * start[1] + 2 * u * t * control[1] + t * t * end[1]),
  ];
}

function stripTriangles(start2d, end2d, label) {
  const start = scenePoint(start2d);
  const end = scenePoint(end2d);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) throw new Error(`flow-guided branch adapter does not silently realize zero-length tessellation segment ${label}`);
  const nx = (-dy / length) * HALF_WIDTH;
  const ny = (dx / length) * HALF_WIDTH;
  const a = [round9(start[0] + nx), round9(start[1] + ny), 0];
  const b = [round9(start[0] - nx), round9(start[1] - ny), 0];
  const c = [round9(end[0] - nx), round9(end[1] - ny), 0];
  const d = [round9(end[0] + nx), round9(end[1] + ny), 0];
  return [
    { vertices: [a, b, c], albedo: [...FIXED_ALBEDO] },
    { vertices: [a, c, d], albedo: [...FIXED_ALBEDO] },
  ];
}

export function flowGuidedBranchCurveSetToAxmScene(curveSet, options = {}) {
  if (!curveSet || typeof curveSet !== "object" || Array.isArray(curveSet)) throw new Error("flow-guided branch scene adapter requires a curve-set object");
  if (curveSet.schema !== "axm.flow-guided-branch-curves2d/v0.1" || curveSet.derived !== true || curveSet.rebuildable !== true) {
    throw new Error("flow-guided branch scene adapter accepts only derived rebuildable v0.1 curve sets");
  }
  for (const key of ["branchSourceHash", "baseNetworkHash", "scalarSourceHash", "flowSourceHash", "guidanceSourceHash", "curveSetHash"]) {
    if (!String(curveSet[key] || "").trim()) throw new Error(`flow-guided branch scene adapter requires ${key}`);
  }
  if (!Array.isArray(curveSet.curves) || curveSet.curves.length !== curveSet.curveCount || curveSet.curveCount < 1) {
    throw new Error("flow-guided branch scene adapter requires an internally consistent non-empty curve set");
  }
  const subdivisions = Number(options.subdivisions ?? DEFAULT_SUBDIVISIONS);
  if (!Number.isInteger(subdivisions) || subdivisions < 2 || subdivisions > 32) {
    throw new Error("flow-guided branch scene adapter subdivisions must be an integer within [2,32]");
  }

  const triangles = [];
  [...curveSet.curves].sort((a, b) => a.index - b.index).forEach((curve, index) => {
    if (!curve || curve.index !== index || typeof curve.segmentId !== "string" || !curve.segmentId) {
      throw new Error(`flow-guided branch adapter curve order/identity mismatch at index ${index}`);
    }
    const start = normalizedPoint(curve.start, `curve ${index}.start`);
    const control = normalizedPoint(curve.control, `curve ${index}.control`);
    const end = normalizedPoint(curve.end, `curve ${index}.end`);
    let previous = quadraticPoint(start, control, end, 0);
    for (let step = 1; step <= subdivisions; step += 1) {
      const current = quadraticPoint(start, control, end, step / subdivisions);
      triangles.push(...stripTriangles(previous, current, `${curve.segmentId}:${step}`));
      previous = current;
    }
  });

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const expectedTriangles = curveSet.curveCount * subdivisions * 2;
  if (parseScene(bytes.toString("utf8")).triangles.length !== expectedTriangles) throw new Error("flow-guided branch scene adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-flow-guided-branch-curves-to-axm-scene/v1",
      branch_source_hash: curveSet.branchSourceHash,
      base_network_hash: curveSet.baseNetworkHash,
      scalar_source_hash: curveSet.scalarSourceHash,
      flow_source_hash: curveSet.flowSourceHash,
      guidance_source_hash: curveSet.guidanceSourceHash,
      curve_set_hash: curveSet.curveSetHash,
      input_curve_count: curveSet.curveCount,
      subdivisions_per_curve: subdivisions,
      polyline_segment_count: curveSet.curveCount * subdivisions,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_only_derived_quadratic_start_control_end: true,
      endpoints_remain_donor_owned_derived_network_geometry: true,
      style_is_fixed: true,
      consumer_semantics_assigned: false,
      adapter_policy: "each donor-derived quadratic curve is deterministically tessellated into a fixed-count polyline and fixed-width two-triangle strips; fixed albedo carries no tree/root/crack/vein/river/UI/game meaning and no canonical or retained VFX source is rewritten",
    },
  };
}

function midpoint(segment) {
  return [round6((segment.start[0] + segment.end[0]) / 2), round6((segment.start[1] + segment.end[1]) / 2)];
}

export async function observeVisualEffectBranchFlowGuidedNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    guided: resolve(rootPath, "hand-lab/src/branch-flow-guided-curves.mjs"),
    branchGrowth: resolve(rootPath, "hand-lab/src/branch-growth2d.mjs"),
    fieldFlow: resolve(rootPath, "hand-lab/src/field-flow-operators.mjs"),
    field: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const guided = await import(`${pathToFileURL(paths.guided).href}?sha=${sources.guided.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(guided.BRANCH_FLOW_GUIDED_CURVE_HANDS) || !guided.BRANCH_FLOW_GUIDED_CURVE_GRAPH || typeof guided.makeBranchFlowGuidedCurveState !== "function") throw new Error("VFX donor flow-guided branch graph is unavailable");
  if (guided.BRANCH_FLOW_GUIDED_CURVE_GRAPH.id !== "fx.growth.branching2d-flow-guided-static-svg" || guided.BRANCH_FLOW_GUIDED_CURVE_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX flow-guided branch graph identity");

  const expectedHands = [
    "fx.growth.branching2d-source-normalize",
    "fx.growth.branching2d-network-build",
    "fx.field.flow-source-normalize",
    "fx.growth.branching2d-flow-guidance-source-normalize",
    "fx.growth.branching2d-flow-guided-curves-build",
    "fx.growth.branching2d-flow-guided-static-svg-realize",
  ];
  if (JSON.stringify(guided.BRANCH_FLOW_GUIDED_CURVE_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) throw new Error("unexpected VFX flow-guided branch Hand boundary");

  const growth = {
    id: "creative-render-flow-guided-growth",
    origin: [0.5, 0.92], headingTurns: 0.75, baseLength: 0.18, lengthDecay: 0.66,
    branchOffsetsTurns: [-0.075, 0.075], generations: 5,
  };
  const flow = {
    id: "creative-render-flow-guidance", mode: "gradient", strength: 2.4, sampleStep: 0.02,
    field: { id: "creative-render-flow-field", seed: 4242, frequency: 3.5, octaves: 4, lacunarity: 2, gain: 0.5, offset: [0.1, -0.2] },
  };
  const choices = {
    zero: { id: "creative-render-branch-flow-guidance", curvatureScale: 0, maxControlOffset: 0.18 },
    active: { id: "creative-render-branch-flow-guidance", curvatureScale: 1.1, maxControlOffset: 0.18 },
  };
  const registry = runtime.createHandRegistry(guided.BRANCH_FLOW_GUIDED_CURVE_HANDS);
  const execute = (state, callerKind) => runtime.executeHandGraph({ registry, graph: guided.BRANCH_FLOW_GUIDED_CURVE_GRAPH, initialState: state, context: { callerKind } });

  async function runVariant(name, guidance) {
    const initialState = guided.makeBranchFlowGuidedCurveState({ growth: structuredClone(growth), flow: structuredClone(flow), guidance: structuredClone(guidance) });
    const requestBytes = {
      growth: stableBytes(initialState.branchGrowthRequest), field: stableBytes(initialState.fieldRequest),
      flow: stableBytes(initialState.flowRequest), guidance: stableBytes(initialState.branchFlowGuidanceRequest),
    };
    const human = execute(initialState, "human");
    const machine = execute(initialState, "machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`VFX flow-guided branch caller-neutral repeat failed for ${name}`);
    const state = human.finalState;
    const growthSource = state.branchGrowthSource;
    const network = state.branchGrowthNetworks?.[growthSource?.id];
    const fieldSource = state.fieldSource;
    const flowSource = state.flowSource;
    const guidanceSource = state.branchFlowGuidanceSource;
    const curveSet = state.branchFlowGuidedCurveSets?.[guidanceSource?.id];
    const realization = state.realizations?.branchFlowGuidedStaticSvg;

    if (!growthSource || runtime.hashValue(growthSource) !== state.branchGrowthSourceHash) throw new Error(`growth source hash drifted for ${name}`);
    if (!network || network.schema !== "axm.branch-growth-network2d/v0.1" || network.sourceHash !== state.branchGrowthSourceHash || network.derived !== true || network.rebuildable !== true || network.segmentCount !== 31) throw new Error(`base network boundary drifted for ${name}`);
    if (!fieldSource || runtime.hashValue(fieldSource) !== state.fieldSourceHash) throw new Error(`scalar source hash drifted for ${name}`);
    if (!flowSource || runtime.hashValue(flowSource) !== state.flowSourceHash || flowSource.scalarSource?.sourceHash !== state.fieldSourceHash) throw new Error(`flow source lineage drifted for ${name}`);
    if (!guidanceSource || runtime.hashValue(guidanceSource) !== state.branchFlowGuidanceSourceHash || guidanceSource.branchSource?.sourceHash !== state.branchGrowthSourceHash || guidanceSource.baseNetworkHash !== network.networkHash || guidanceSource.flowSource?.sourceHash !== state.flowSourceHash || guidanceSource.flowSource?.scalarSourceHash !== state.fieldSourceHash) throw new Error(`guidance source lineage drifted for ${name}`);
    if (!curveSet || curveSet.schema !== "axm.flow-guided-branch-curves2d/v0.1" || curveSet.derived !== true || curveSet.rebuildable !== true || curveSet.curveCount !== network.segmentCount || curveSet.branchSourceHash !== state.branchGrowthSourceHash || curveSet.baseNetworkHash !== network.networkHash || curveSet.scalarSourceHash !== state.fieldSourceHash || curveSet.flowSourceHash !== state.flowSourceHash || curveSet.guidanceSourceHash !== state.branchFlowGuidanceSourceHash) throw new Error(`curve-set lineage drifted for ${name}`);
    if (!realization || realization.schema !== "axm.vfx.branch-flow-guided-static-svg/v0.1" || realization.curveSetHash !== curveSet.curveSetHash || realization.baseNetworkHash !== network.networkHash || realization.flowSourceHash !== state.flowSourceHash || realization.guidanceSourceHash !== state.branchFlowGuidanceSourceHash) throw new Error(`SVG lineage drifted for ${name}`);
    if (stableBytes(state.branchGrowthRequest).compare(requestBytes.growth) || stableBytes(state.fieldRequest).compare(requestBytes.field) || stableBytes(state.flowRequest).compare(requestBytes.flow) || stableBytes(state.branchFlowGuidanceRequest).compare(requestBytes.guidance)) throw new Error(`caller request mutated for ${name}`);

    curveSet.curves.forEach((curve, index) => {
      const segment = network.segments[index];
      if (curve.segmentId !== segment.id || curve.parentId !== segment.parentId || curve.generation !== segment.generation || JSON.stringify(curve.start) !== JSON.stringify(segment.start) || JSON.stringify(curve.end) !== JSON.stringify(segment.end)) throw new Error(`curve topology/endpoints drifted for ${name}:${index}`);
    });

    const exactBudget = guided.buildBranchFlowGuidedCurveSetHand.execute(state, { maxCurves: curveSet.curveCount }, {}).state.branchFlowGuidedCurveSets[guidanceSource.id];
    const roomyBudget = guided.buildBranchFlowGuidedCurveSetHand.execute(state, { maxCurves: 2048 }, {}).state.branchFlowGuidedCurveSets[guidanceSource.id];
    if (exactBudget.curveSetHash !== roomyBudget.curveSetHash || roomyBudget.curveSetHash !== curveSet.curveSetHash) throw new Error(`sufficient curve budget changed output for ${name}`);
    let budgetFailure = null;
    try { guided.buildBranchFlowGuidedCurveSetHand.execute(state, { maxCurves: curveSet.curveCount - 1 }, {}); }
    catch (error) { budgetFailure = String(error?.message || error); }
    if (!budgetFailure?.includes("curve budget exceeded")) throw new Error(`insufficient curve budget did not fail loudly for ${name}`);
    if (runtime.hashValue(state.branchFlowGuidanceSource) !== state.branchFlowGuidanceSourceHash) throw new Error(`failed curve budget rewrote guidance source for ${name}`);

    return {
      growthSource, growthSourceHash: state.branchGrowthSourceHash, growthSourceBytes: stableBytes(growthSource),
      network, networkBytes: stableBytes(network), fieldSource, fieldSourceHash: state.fieldSourceHash, fieldSourceBytes: stableBytes(fieldSource),
      flowSource, flowSourceHash: state.flowSourceHash, flowSourceBytes: stableBytes(flowSource),
      guidanceSource, guidanceSourceHash: state.branchFlowGuidanceSourceHash, guidanceSourceBytes: stableBytes(guidanceSource),
      curveSet, curveSetBytes: stableBytes(curveSet), realization, svgBytes: Buffer.from(realization.content, "utf8"),
      stateBytes: stableBytes(state), adapted: flowGuidedBranchCurveSetToAxmScene(curveSet), finalStateHash: human.finalStateHash, budgetFailure,
    };
  }

  const zero = await runVariant("zero", choices.zero);
  const active = await runVariant("active", choices.active);
  if (zero.growthSourceBytes.compare(active.growthSourceBytes) || zero.networkBytes.compare(active.networkBytes) || zero.fieldSourceBytes.compare(active.fieldSourceBytes) || zero.flowSourceBytes.compare(active.flowSourceBytes)) throw new Error("retained branch/network/field/flow truth changed across curvature choice");
  if (zero.guidanceSource.curvatureScale !== 0 || active.guidanceSource.curvatureScale !== 1.1 || zero.guidanceSource.maxControlOffset !== active.guidanceSource.maxControlOffset) throw new Error("curvatureScale isolation failed");
  if (zero.guidanceSourceHash === active.guidanceSourceHash || zero.curveSet.curveSetHash === active.curveSet.curveSetHash) throw new Error("curvature choice did not change guidance/curve identity");
  if (zero.curveSet.maxOffsetMagnitude !== 0 || zero.curveSet.meanOffsetMagnitude !== 0) throw new Error("zero curvature was not an exact derived no-op");
  zero.curveSet.curves.forEach((curve, index) => {
    if (JSON.stringify(curve.control) !== JSON.stringify(midpoint(zero.network.segments[index]))) throw new Error(`zero curvature control was not midpoint at ${index}`);
  });
  if (!(active.curveSet.maxOffsetMagnitude > 0) || !active.curveSet.curves.some((curve, index) => JSON.stringify(curve.control) !== JSON.stringify(zero.curveSet.curves[index].control))) throw new Error("active curvature changed no derived control point");
  if (zero.svgBytes.compare(active.svgBytes) === 0 || zero.adapted.bytes.compare(active.adapted.bytes) === 0) throw new Error("active curvature did not reach both replaceable observation bodies");

  const variants = { zero, active };
  const receiptVariants = Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
    growth_source: { hash: row.growthSourceHash, bytes_sha256: sha256(row.growthSourceBytes) },
    network: { hash: row.network.networkHash, bytes_sha256: sha256(row.networkBytes), segment_count: row.network.segmentCount, derived: true, rebuildable: true },
    scalar_source: { hash: row.fieldSourceHash, bytes_sha256: sha256(row.fieldSourceBytes) },
    flow_source: { hash: row.flowSourceHash, bytes_sha256: sha256(row.flowSourceBytes), mode: row.flowSource.mode },
    guidance_source: { hash: row.guidanceSourceHash, bytes_sha256: sha256(row.guidanceSourceBytes), curvature_scale: row.guidanceSource.curvatureScale, max_control_offset: row.guidanceSource.maxControlOffset },
    curve_set: { hash: row.curveSet.curveSetHash, bytes_sha256: sha256(row.curveSetBytes), curve_count: row.curveSet.curveCount, max_offset_magnitude: row.curveSet.maxOffsetMagnitude, mean_offset_magnitude: row.curveSet.meanOffsetMagnitude, clamped_control_count: row.curveSet.clampedControlCount, derived: true, rebuildable: true },
    working_set_budget: { exact_curve_count_matches_2048: true, insufficient_budget_failed_loudly: true, insufficient_budget_error: row.budgetFailure },
    donor_svg: { schema: row.realization.schema, bytes_sha256: sha256(row.svgBytes), curve_set_hash: row.realization.curveSetHash, replaceable_realization: true },
    native_scene: { bytes_sha256: sha256(row.adapted.bytes), adapter: row.adapted.observation },
    final_state_sha256: sha256(row.stateBytes), caller_neutral_final_state_hash: row.finalStateHash,
  }]));

  const receipt = {
    contract: CONTRACT, version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric", revision: vfxRevision,
      graph_id: guided.BRANCH_FLOW_GUIDED_CURVE_GRAPH.id, graph_version: guided.BRANCH_FLOW_GUIDED_CURVE_GRAPH.version,
      hand_ids: expectedHands,
      files: {
        "hand-lab/src/hand-runtime.mjs": sources.runtime.sha256,
        "hand-lab/src/branch-flow-guided-curves.mjs": sources.guided.sha256,
        "hand-lab/src/branch-growth2d.mjs": sources.branchGrowth.sha256,
        "hand-lab/src/field-flow-operators.mjs": sources.fieldFlow.sha256,
        "hand-lab/src/field-operators.mjs": sources.field.sha256,
      },
    },
    caller_authority: {
      explicit_choice: "branchFlowGuidanceRequest.curvatureScale",
      held_constant: ["branchGrowthRequest", "fieldRequest", "flowRequest", "branchFlowGuidanceRequest.maxControlOffset"],
      caller_requests_mutated: false, caller_neutral_repeat_verification: "PASS",
      retained_growth_field_flow_sources_remain_authoritative: true,
      base_network_is_derived_rebuildable_not_canonical: true,
      guided_curve_set_is_derived_rebuildable_not_canonical: true,
      donor_svg_is_canonical: false, native_scene_is_canonical: false, consumer_semantics_assigned: false,
    },
    variants: receiptVariants,
    cross_variant_gates: {
      retained_growth_source_identical: true, retained_base_network_identical: true,
      retained_scalar_source_identical: true, retained_flow_source_identical: true,
      zero_curvature_exact_midpoint_noop: true, active_curvature_changes_only_guidance_and_derived_curve_geometry: true,
      branch_endpoints_and_topology_preserved: true, active_choice_reaches_donor_svg_and_native_scene: true,
    },
    replaceability: {
      same_derived_curve_set_can_feed_donor_svg_and_native_scene_realizations: true,
      deterministic_native_tessellation_is_observation_only: true,
      donor_svg_and_native_scene_do_not_rewrite_retained_sources_or_network_truth: true,
    },
    authority: "caller-authored growth/field/flow/guidance requests and donor-normalized retained sources remain authoritative; base networks and flow-guided curve sets are derived/rebuildable; SVG/native scene/render bodies are replaceable observations",
    truth_boundary: {
      proven: "current VFX flow-guided branch graph execution, caller-neutral replay, isolated curvatureScale choice, exact zero-curvature midpoint no-op, retained branch/network/field/flow identity, endpoint/topology preservation, curve-budget honesty, donor-SVG lineage, and deterministic native-scene eligibility from the same derived quadratic curves",
      not_proven: ["tree/root/crack/vein/river semantics", "organic or physical growth correctness", "fluid correctness", "artistic quality", "animation quality", "browser/GPU equivalence", "real-time performance", "cross-machine bitwise determinism"],
    },
  };

  return {
    zeroGrowthSourceBytes: zero.growthSourceBytes, activeGrowthSourceBytes: active.growthSourceBytes,
    zeroNetworkBytes: zero.networkBytes, activeNetworkBytes: active.networkBytes,
    zeroFieldSourceBytes: zero.fieldSourceBytes, activeFieldSourceBytes: active.fieldSourceBytes,
    zeroFlowSourceBytes: zero.flowSourceBytes, activeFlowSourceBytes: active.flowSourceBytes,
    zeroGuidanceSourceBytes: zero.guidanceSourceBytes, activeGuidanceSourceBytes: active.guidanceSourceBytes,
    zeroCurveSetBytes: zero.curveSetBytes, activeCurveSetBytes: active.curveSetBytes,
    zeroSvgBytes: zero.svgBytes, activeSvgBytes: active.svgBytes,
    zeroStateBytes: zero.stateBytes, activeStateBytes: active.stateBytes,
    zeroSceneBytes: zero.adapted.bytes, activeSceneBytes: active.adapted.bytes,
    receipt,
  };
}
