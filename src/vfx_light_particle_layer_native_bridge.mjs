import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";
import { maskGuidedLightRaySetToAxmScene } from "./vfx_multi_family_mask_guided_light_rays_native_bridge.mjs";
import { flowAdvectedParticleSetToAxmScene } from "./vfx_particle_flow_advection_bridge.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_LIGHT_PARTICLE_LAYER_NATIVE_RECEIPT";
const VERSION = 1;
const PLAN_ID = "creative-render-light-particle-layer-plan";
const ORDER_MODES = ["rays-under-particles", "particles-under-rays"];
const PLAN_HASH_KEYS = [
  "contract",
  "coordinateSpace",
  "layerAuthority",
  "blendModeAuthority",
  "opacityAuthority",
  "materialAuthority",
  "rendererAuthority",
  "consumerAuthority",
  "geometryMutation",
  "sourceMerge",
];

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

function selectedRaySet(state) {
  const id = state?.lightRaySource?.id;
  const set = id ? state?.lightRaySets?.[id] : null;
  if (!set) throw new Error("light-particle native bridge requires donor-derived light-ray set");
  return set;
}

function selectedParticleSet(state) {
  const id = state?.particleFlowSource?.id;
  const set = id ? state?.flowAdvectedParticleSets?.[id] : null;
  if (!set) throw new Error("light-particle native bridge requires donor-derived particle set");
  return set;
}

function planHash(runtime, plan) {
  const payload = { schema: plan.schema };
  for (const key of PLAN_HASH_KEYS) payload[key] = plan[key];
  payload.id = plan.id;
  payload.orderMode = plan.orderMode;
  payload.layers = plan.layers;
  payload.derived = plan.derived;
  payload.rebuildable = plan.rebuildable;
  return runtime.hashValue(payload);
}

function expectRejected(fn, label) {
  try {
    fn();
  } catch (error) {
    return String(error?.message || error);
  }
  throw new Error(`${label} was unexpectedly accepted`);
}

function cloneTriangles(triangles) {
  return triangles.map((triangle) => structuredClone(triangle));
}

export function lightParticleLayerPlanToAxmScene(plan, observers, options = {}) {
  if (!plan || plan.schema !== "axm.effect-layer-plan2d/v0.1" || plan.derived !== true || plan.rebuildable !== true) {
    throw new Error("light-particle native adapter requires a derived rebuildable axm.effect-layer-plan2d/v0.1 plan");
  }
  if (!ORDER_MODES.includes(plan.orderMode)) throw new Error("light-particle native adapter received unsupported order mode");
  if (!Array.isArray(plan.layers) || plan.layers.length !== 2) throw new Error("light-particle native adapter requires exactly two donor layers");

  const rayScene = observers?.lightRays?.scene;
  const particleScene = observers?.particles?.scene;
  if (!rayScene || !particleScene) throw new Error("light-particle native adapter requires independent light-ray and particle observers");
  const byLayer = {
    "light-rays": rayScene.triangles,
    particles: particleScene.triangles,
  };
  const expectedOrder = plan.orderMode === "rays-under-particles"
    ? ["light-rays", "particles"]
    : ["particles", "light-rays"];
  const actualOrder = plan.layers.map((layer) => layer?.layerId);
  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error("light-particle native adapter refuses a plan whose layer array disagrees with donor orderMode");
  }
  if (new Set(actualOrder).size !== 2 || actualOrder.some((id) => !byLayer[id])) {
    throw new Error("light-particle native adapter accepts only the two independently observed donor layer families");
  }

  const totalTriangles = actualOrder.reduce((sum, id) => sum + byLayer[id].length, 0);
  const maxTriangles = Number(options.maxTriangles ?? 4096);
  if (!Number.isInteger(maxTriangles) || maxTriangles < 1) throw new Error("light-particle native maxTriangles must be a positive integer");
  if (totalTriangles > maxTriangles) throw new Error(`light-particle native triangle budget exceeded: ${totalTriangles} > ${maxTriangles}`);

  const triangles = [];
  const groups = [];
  for (const layerId of actualOrder) {
    const source = byLayer[layerId];
    const startTriangle = triangles.length;
    triangles.push(...cloneTriangles(source));
    groups.push({ layer_id: layerId, start_triangle: startTriangle, triangle_count: source.length });
  }
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== totalTriangles) throw new Error("light-particle native scene triangle count drifted during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-light-particle-layer-plan-to-axm-scene/v1",
      plan_hash: plan.planHash,
      order_mode: plan.orderMode,
      groups,
      output_contract: "AXM_SCENE 1",
      output_triangles: totalTriangles,
      output_sha256: sha256(bytes),
      source_geometry_mutated: false,
      blend_mode_assigned: false,
      opacity_assigned: false,
      material_meaning_assigned: false,
      depth_meaning_assigned: false,
      consumer_semantics_assigned: false,
      canonical_source_rewritten: false,
      layer_order_consumed_from_donor_plan: true,
      derived: true,
      replaceable: true,
      adapter_policy: "concatenate the two already-derived replaceable observer triangle groups in exact verified donor plan order; do not add blending, opacity, material, depth, or consumer meaning",
    },
  };
}

export async function observeVisualEffectLightParticleLayerPlanNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    rays: resolve(rootPath, "hand-lab/src/mask-guided-light-rays.mjs"),
    particles: resolve(rootPath, "hand-lab/src/particle-flow-advection.mjs"),
    layerPlan: resolve(rootPath, "hand-lab/src/light-particle-layer-plan2d.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const rays = await import(`${pathToFileURL(paths.rays).href}?sha=${sources.rays.sha256}`);
  const particles = await import(`${pathToFileURL(paths.particles).href}?sha=${sources.particles.sha256}`);
  const layerPlan = await import(`${pathToFileURL(paths.layerPlan).href}?sha=${sources.layerPlan.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX Hand runtime is unavailable");
  }
  if (rays.MASK_GUIDED_LIGHT_RAY_GRAPH?.id !== "fx.light.mask-guided-rays2d-static-svg" || rays.MASK_GUIDED_LIGHT_RAY_GRAPH?.version !== "0.1.0") {
    throw new Error("unexpected mask-guided light-ray donor graph identity");
  }
  if (particles.PARTICLE_FLOW_ADVECTION_GRAPH?.id !== "fx.particle.flow-advect2d" || particles.PARTICLE_FLOW_ADVECTION_GRAPH?.version !== "0.1.0") {
    throw new Error("unexpected particle-flow donor graph identity");
  }
  if (layerPlan.LIGHT_PARTICLE_LAYER_PLAN_GRAPH?.id !== "fx.composition.light-particle-layer-plan2d" || layerPlan.LIGHT_PARTICLE_LAYER_PLAN_GRAPH?.version !== "0.1.0") {
    throw new Error("unexpected light-particle layer-plan donor graph identity");
  }
  if (typeof layerPlan.validateLightParticleLayerPlan !== "function" || typeof layerPlan.makeLightParticleLayerPlanState !== "function") {
    throw new Error("VFX light-particle layer-plan validation boundary is unavailable");
  }

  const lightInitial = rays.makeMaskGuidedLightRayState({
    field: { id: "creative-render-layer-light-field", seed: 503, frequency: 4.2, octaves: 5, lacunarity: 2, gain: 0.54, offset: [0.07, -0.09] },
    mask: { id: "creative-render-layer-light-mask", threshold: 0.46, softness: 0.13, invert: false },
    ray: { id: "creative-render-layer-light-rays", origin: [0.28, 0.61], directionTurns: 0.035, spanTurns: 0.28, maxLength: 1.25, weightPower: 1.15 },
  });
  const callerParticles = [
    { id: "layer-p0", x: 0.22, y: 0.28, tag: "caller-owned-untyped" },
    { id: "layer-p1", x: 0.39, y: 0.43, tag: "caller-owned-untyped" },
    { id: "layer-p2", x: 0.55, y: 0.55, tag: "caller-owned-untyped" },
    { id: "layer-p3", x: 0.68, y: 0.62, tag: "caller-owned-untyped" },
    { id: "layer-p4", x: 0.76, y: 0.39, tag: "caller-owned-untyped" },
    { id: "layer-p5", x: 0.47, y: 0.76, tag: "caller-owned-untyped" },
  ];
  const particleInitial = particles.makeParticleFlowAdvectionState(callerParticles, {
    id: "creative-render-layer-particles",
    stepSize: 0.03,
    steps: 10,
    field: { id: "creative-render-layer-particle-field", seed: 1701, frequency: 4.1, octaves: 5, lacunarity: 2, gain: 0.51, offset: [0.11, -0.08] },
    flow: { id: "creative-render-layer-particle-flow", mode: "tangent", sampleStep: 0.015625, strength: 1.05 },
  });
  const callerBytes = {
    light: stableBytes(lightInitial),
    particles: stableBytes(particleInitial),
  };

  const executeDonor = (hands, graph, initialState, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(hands),
    graph,
    initialState,
    context: { callerKind },
  });
  const lightHuman = executeDonor(rays.MASK_GUIDED_LIGHT_RAY_HANDS, rays.MASK_GUIDED_LIGHT_RAY_GRAPH, lightInitial, "human");
  const lightMachine = executeDonor(rays.MASK_GUIDED_LIGHT_RAY_HANDS, rays.MASK_GUIDED_LIGHT_RAY_GRAPH, lightInitial, "machine");
  const particleHuman = executeDonor(particles.PARTICLE_FLOW_ADVECTION_HANDS, particles.PARTICLE_FLOW_ADVECTION_GRAPH, particleInitial, "human");
  const particleMachine = executeDonor(particles.PARTICLE_FLOW_ADVECTION_HANDS, particles.PARTICLE_FLOW_ADVECTION_GRAPH, particleInitial, "machine");
  if (lightHuman.finalStateHash !== lightMachine.finalStateHash || particleHuman.finalStateHash !== particleMachine.finalStateHash) {
    throw new Error("light-particle donor caller-neutral replay failed");
  }
  if (stableBytes(lightInitial).compare(callerBytes.light) !== 0 || stableBytes(particleInitial).compare(callerBytes.particles) !== 0) {
    throw new Error("light-particle donor mutated caller initial state");
  }

  const lightState = lightHuman.finalState;
  const particleState = particleHuman.finalState;
  const raySet = selectedRaySet(lightState);
  const particleSet = selectedParticleSet(particleState);
  const rayObserved = maskGuidedLightRaySetToAxmScene(raySet);
  const particleObserved = flowAdvectedParticleSetToAxmScene(particleSet);
  const compositionInitial = layerPlan.makeLightParticleLayerPlanState(lightState, particleState);
  const compositionBytes = stableBytes(compositionInitial);
  const results = {};

  for (const orderMode of ORDER_MODES) {
    const graph = structuredClone(layerPlan.LIGHT_PARTICLE_LAYER_PLAN_GRAPH);
    graph.stages[0].params = { id: PLAN_ID, orderMode };
    const human = executeDonor(layerPlan.LIGHT_PARTICLE_LAYER_PLAN_HANDS, graph, compositionInitial, "human");
    const machine = executeDonor(layerPlan.LIGHT_PARTICLE_LAYER_PLAN_HANDS, graph, compositionInitial, "machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${orderMode} layer-plan caller-neutral replay failed`);
    if (stableBytes(compositionInitial).compare(compositionBytes) !== 0) throw new Error(`${orderMode} plan build mutated composition input`);
    if (stableBytes(human.finalState.lightRayState).compare(stableBytes(lightState)) !== 0 || stableBytes(human.finalState.particleFlowState).compare(stableBytes(particleState)) !== 0) {
      throw new Error(`${orderMode} plan build rewrote nested donor truth`);
    }
    const plan = human.finalState.effectLayerPlans?.[PLAN_ID];
    if (!plan || layerPlan.validateLightParticleLayerPlan(human.finalState, plan) !== true) throw new Error(`${orderMode} layer plan failed donor validation`);
    const exactTriangles = rayObserved.scene.triangles.length + particleObserved.scene.triangles.length;
    const exact = lightParticleLayerPlanToAxmScene(plan, { lightRays: rayObserved, particles: particleObserved }, { maxTriangles: exactTriangles });
    const roomy = lightParticleLayerPlanToAxmScene(plan, { lightRays: rayObserved, particles: particleObserved }, { maxTriangles: 4096 });
    if (exact.bytes.compare(roomy.bytes) !== 0) throw new Error(`${orderMode} sufficient observer budgets changed output`);
    const budgetFailure = expectRejected(
      () => lightParticleLayerPlanToAxmScene(plan, { lightRays: rayObserved, particles: particleObserved }, { maxTriangles: exactTriangles - 1 }),
      `${orderMode} insufficient observer budget`,
    );
    results[orderMode] = { state: human.finalState, plan, observed: exact, budgetFailure, finalStateHash: human.finalStateHash };
  }

  const under = results["rays-under-particles"];
  const over = results["particles-under-rays"];
  const underLight = under.plan.layers.find((layer) => layer.layerId === "light-rays");
  const underParticles = under.plan.layers.find((layer) => layer.layerId === "particles");
  const overLight = over.plan.layers.find((layer) => layer.layerId === "light-rays");
  const overParticles = over.plan.layers.find((layer) => layer.layerId === "particles");
  if (underLight.lineage.raySetHash !== overLight.lineage.raySetHash || underParticles.lineage.particleSetHash !== overParticles.lineage.particleSetHash) {
    throw new Error("layer order selection changed donor-derived layer identity");
  }
  if (under.plan.planHash === over.plan.planHash || under.observed.bytes.compare(over.observed.bytes) === 0) {
    throw new Error("distinct verified order selections collapsed to one plan/native scene identity");
  }

  const forgedOrder = structuredClone(under.plan);
  forgedOrder.layers.reverse();
  forgedOrder.planHash = planHash(runtime, forgedOrder);
  const forgedOrderFailure = expectRejected(() => layerPlan.validateLightParticleLayerPlan(under.state, forgedOrder), "self-consistently rehashed layer-order forgery");

  const forgedBlend = structuredClone(under.plan);
  forgedBlend.blendModeAuthority = "screen";
  forgedBlend.planHash = planHash(runtime, forgedBlend);
  const forgedBlendFailure = expectRejected(() => layerPlan.validateLightParticleLayerPlan(under.state, forgedBlend), "self-consistently rehashed blend-authority forgery");

  const thirdLayer = structuredClone(under.plan);
  thirdLayer.layers.push(structuredClone(thirdLayer.layers[0]));
  thirdLayer.planHash = planHash(runtime, thirdLayer);
  const thirdLayerFailure = expectRejected(() => layerPlan.validateLightParticleLayerPlan(under.state, thirdLayer), "third-layer forgery");

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      modules: Object.fromEntries(Object.entries(sources).map(([name, row]) => [name, row.sha256])),
      graph_id: layerPlan.LIGHT_PARTICLE_LAYER_PLAN_GRAPH.id,
      graph_version: layerPlan.LIGHT_PARTICLE_LAYER_PLAN_GRAPH.version,
      donor_graph_reused: true,
      light_graph_id: rays.MASK_GUIDED_LIGHT_RAY_GRAPH.id,
      particle_graph_id: particles.PARTICLE_FLOW_ADVECTION_GRAPH.id,
      caller_neutral_replay: "PASS",
      caller_inputs_unchanged: true,
      nested_donor_states_unchanged_by_plan: true,
      retained_light_source_hash: lightState.lightRaySourceHash,
      retained_particle_flow_source_hash: particleState.particleFlowSourceHash,
      derived_ray_set_hash: raySet.raySetHash,
      derived_particle_set_hash: particleSet.particleSetHash,
      ray_count: raySet.rayCount,
      particle_count: particleSet.particleCount,
      ray_observer_triangles: rayObserved.scene.triangles.length,
      particle_observer_triangles: particleObserved.scene.triangles.length,
    },
    plans: Object.fromEntries(ORDER_MODES.map((mode) => [mode, {
      plan: results[mode].plan,
      final_state_hash: results[mode].finalStateHash,
      native_observation: results[mode].observed.observation,
      scene_sha256: sha256(results[mode].observed.bytes),
      insufficient_triangle_budget_error: results[mode].budgetFailure,
    }])),
    comparison: {
      same_ray_set_identity: underLight.lineage.raySetHash === overLight.lineage.raySetHash,
      same_particle_set_identity: underParticles.lineage.particleSetHash === overParticles.lineage.particleSetHash,
      plan_hashes_differ: under.plan.planHash !== over.plan.planHash,
      scene_bytes_differ_by_verified_group_order: under.observed.bytes.compare(over.observed.bytes) !== 0,
      blend_policy_added: false,
      opacity_policy_added: false,
      material_policy_added: false,
      depth_policy_added: false,
    },
    challenges: {
      exact_and_roomy_observer_capacity_identical: true,
      one_below_observer_capacity_failed_loudly: true,
      self_consistent_layer_order_forgery_rejected: Boolean(forgedOrderFailure),
      self_consistent_blend_authority_forgery_rejected: Boolean(forgedBlendFailure),
      self_consistent_third_layer_forgery_rejected: Boolean(thirdLayerFailure),
    },
    challenge_errors: { forged_order: forgedOrderFailure, forged_blend: forgedBlendFailure, third_layer: thirdLayerFailure },
    truth_boundary: {
      caller_requests_authority: "RETAINED_CALLER_SOURCE_TRUTH",
      vfx_light_and_particle_sources_authority: "RETAINED_VFX_SOURCE_TRUTH",
      vfx_ray_and_particle_sets_authority: "DERIVED_REBUILDABLE_VFX_BODIES",
      vfx_layer_plan_authority: "DERIVED_REBUILDABLE_ORDER_ONLY",
      native_scene_receipt_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
      source_truth_merged: false,
      blend_semantics_proven: false,
      opacity_semantics_proven: false,
      material_semantics_proven: false,
      depth_semantics_proven: false,
      consumer_semantics_proven: false,
      visual_order_effect_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
      realtime_performance_proven: false,
      gpu_equivalence_proven: false,
      browser_equivalence_proven: false,
      cross_machine_bitwise_determinism_proven: false,
    },
  };

  return {
    vfxRevision,
    lightState,
    particleState,
    raySet,
    particleSet,
    plans: Object.fromEntries(ORDER_MODES.map((mode) => [mode, results[mode].plan])),
    scenes: Object.fromEntries(ORDER_MODES.map((mode) => [mode, results[mode].observed])),
    receipt,
  };
}
