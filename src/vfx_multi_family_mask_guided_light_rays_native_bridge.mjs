import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_MULTI_FAMILY_MASK_GUIDED_LIGHT_RAYS_NATIVE_RECEIPT";
const VERSION = 1;
const HALF_WIDTH = 0.005;
const DISPLAY_MIN = 40;
const DISPLAY_RANGE = 200;
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

function finite01(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be finite and within 0..1`);
  return number;
}

function normalizedPoint(point, label) {
  if (!Array.isArray(point) || point.length !== 2) throw new Error(`${label} must be a 2D point`);
  return point.map((value, axis) => finite01(value, `${label}[${axis}]`));
}

function scenePoint(point, label) {
  const [x, y] = normalizedPoint(point, label);
  return [round9((x - 0.5) * 1.8), round9((0.5 - y) * 1.8), 0];
}

function grayForWeight(weight) {
  return DISPLAY_MIN + Math.round(finite01(weight, "ray weight") * DISPLAY_RANGE);
}

function stripTriangles(start2d, end2d, albedo, label) {
  const start = scenePoint(start2d, `${label}.start`);
  const end = scenePoint(end2d, `${label}.end`);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) throw new Error(`mask-guided light-ray adapter does not silently realize zero-length ray ${label}`);
  const nx = (-dy / length) * HALF_WIDTH;
  const ny = (dx / length) * HALF_WIDTH;
  const a = [round9(start[0] + nx), round9(start[1] + ny), 0];
  const b = [round9(start[0] - nx), round9(start[1] - ny), 0];
  const c = [round9(end[0] - nx), round9(end[1] - ny), 0];
  const d = [round9(end[0] + nx), round9(end[1] + ny), 0];
  return [
    { vertices: [a, b, c], albedo: [...albedo] },
    { vertices: [a, c, d], albedo: [...albedo] },
  ];
}

export function maskGuidedLightRaySetToAxmScene(raySet) {
  if (!raySet || typeof raySet !== "object" || Array.isArray(raySet)) throw new Error("mask-guided light-ray native adapter requires a ray-set object");
  if (raySet.schema !== "axm.mask-guided-light-ray-set/v0.1") throw new Error("mask-guided light-ray native adapter requires axm.mask-guided-light-ray-set/v0.1");
  if (raySet.derived !== true || raySet.rebuildable !== true) throw new Error("mask-guided light-ray native adapter accepts only derived rebuildable ray sets");
  for (const key of ["raySourceHash", "fieldSourceHash", "maskSourceHash", "raySetHash"]) {
    if (!String(raySet[key] || "").trim()) throw new Error(`mask-guided light-ray native adapter requires ${key}`);
  }
  if (!Number.isInteger(raySet.rayCount) || raySet.rayCount < 1 || raySet.rayCount > 256) throw new Error("mask-guided light-ray native adapter requires rayCount within 1..256");
  if (!Number.isInteger(raySet.samplesPerRay) || raySet.samplesPerRay < 2 || raySet.samplesPerRay > 128) throw new Error("mask-guided light-ray native adapter requires samplesPerRay within 2..128");
  if (!Array.isArray(raySet.rays) || raySet.rays.length !== raySet.rayCount) throw new Error("mask-guided light-ray native adapter ray cardinality mismatch");

  const triangles = [];
  const weights = [];
  raySet.rays.forEach((ray, index) => {
    if (!ray || ray.index !== index || typeof ray.id !== "string" || !ray.id) throw new Error(`mask-guided light-ray adapter identity/order mismatch at index ${index}`);
    normalizedPoint(ray.start, `ray ${index}.start`);
    normalizedPoint(ray.end, `ray ${index}.end`);
    const weight = finite01(ray.weight, `ray ${index}.weight`);
    finite01(ray.coverageMean, `ray ${index}.coverageMean`);
    finite01(ray.coverageMin, `ray ${index}.coverageMin`);
    finite01(ray.coverageMax, `ray ${index}.coverageMax`);
    if (ray.coverageMin > ray.coverageMean || ray.coverageMean > ray.coverageMax) throw new Error(`ray ${index} coverage summaries are inconsistent`);
    const shade = grayForWeight(weight);
    triangles.push(...stripTriangles(ray.start, ray.end, [shade, shade, shade], `ray ${index}`));
    weights.push(weight);
  });

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  if (parseScene(bytes.toString("utf8")).triangles.length !== raySet.rayCount * 2) throw new Error("mask-guided light-ray native adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-mask-guided-light-ray-set-to-axm-scene/v1",
      input_schema: raySet.schema,
      ray_source_hash: raySet.raySourceHash,
      field_source_hash: raySet.fieldSourceHash,
      mask_source_hash: raySet.maskSourceHash,
      ray_set_hash: raySet.raySetHash,
      ray_count: raySet.rayCount,
      samples_per_ray: raySet.samplesPerRay,
      output_contract: "AXM_SCENE 1",
      output_triangles: triangles.length,
      geometry_mapping: "one donor-derived ray -> one fixed-width two-triangle strip from retained derived endpoints",
      display_transfer: "ray weight 0..1 -> neutral grayscale 40..240",
      source_family_branching: false,
      consumer_semantics_assigned: false,
      canonical_source_rewritten: false,
      derived: true,
      replaceable: true,
      min_weight: Math.min(...weights),
      max_weight: Math.max(...weights),
    },
  };
}

function rayGeometry(raySet) {
  return raySet.rays.map((ray) => ({ start: ray.start, end: ray.end, angleTurns: ray.angleTurns, length: ray.length }));
}

function sceneGeometry(scene) {
  return scene.triangles.map((triangle) => triangle.vertices);
}

function sceneAlbedo(scene) {
  return scene.triangles.map((triangle) => triangle.albedo);
}

function selfHashRaySet(runtime, raySet) {
  return runtime.hashValue({
    schema: raySet.schema,
    raySourceHash: raySet.raySourceHash,
    fieldSourceHash: raySet.fieldSourceHash,
    maskSourceHash: raySet.maskSourceHash,
    rayCount: raySet.rayCount,
    samplesPerRay: raySet.samplesPerRay,
    rays: raySet.rays,
  });
}

export async function observeVisualEffectMaskGuidedLightRayFamiliesNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    rays: resolve(rootPath, "hand-lab/src/mask-guided-light-rays.mjs"),
    mask: resolve(rootPath, "hand-lab/src/field-mask-operators.mjs"),
    fbm: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
    cellular: resolve(rootPath, "hand-lab/src/cellular-field2d.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const rays = await import(`${pathToFileURL(paths.rays).href}?sha=${sources.rays.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(rays.MASK_GUIDED_LIGHT_RAY_HANDS) || !Array.isArray(rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_HANDS)
    || !rays.MASK_GUIDED_LIGHT_RAY_GRAPH || !rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_GRAPH
    || typeof rays.makeMaskGuidedLightRayState !== "function" || typeof rays.makeCellularMaskGuidedLightRayState !== "function"
    || typeof rays.buildMaskGuidedLightRaySetHand?.execute !== "function" || typeof rays.realizeMaskGuidedLightRaysStaticSvgHand?.execute !== "function") {
    throw new Error("VFX multi-family mask-guided light-ray donor is unavailable");
  }
  if (rays.MASK_GUIDED_LIGHT_RAY_GRAPH.id !== "fx.light.mask-guided-rays2d-static-svg" || rays.MASK_GUIDED_LIGHT_RAY_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX fBm mask-guided light-ray graph identity");
  if (rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_GRAPH.id !== "fx.light.mask-guided-rays2d-static-svg-cellular" || rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_GRAPH.version !== "0.1.0") throw new Error("unexpected VFX cellular mask-guided light-ray graph identity");

  const sharedMask = { id: "creative-render-family-ray-mask", threshold: 0.5, softness: 0.1, invert: false };
  const sharedRay = { id: "creative-render-family-rays", origin: [0.3, 0.62], directionTurns: 0.04, spanTurns: 0.3, maxLength: 1.3, weightPower: 1.2 };
  const specifications = {
    fbm: {
      family: "fbm-value-noise-2d",
      hands: rays.MASK_GUIDED_LIGHT_RAY_HANDS,
      graph: rays.MASK_GUIDED_LIGHT_RAY_GRAPH,
      initial: rays.makeMaskGuidedLightRayState({
        field: { id: "creative-render-family-field", seed: 91, frequency: 4.5, octaves: 5, lacunarity: 2, gain: 0.57, offset: [0.08, -0.11] },
        mask: sharedMask,
        ray: sharedRay,
      }),
      requestKey: "fieldRequest",
      sourceKey: "fieldSource",
      sourceHashKey: "fieldSourceHash",
      sourceSchema: "axm.scalar-field-source/v0.1",
    },
    cellular: {
      family: "cellular-nearest-feature-2d",
      hands: rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_HANDS,
      graph: rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_GRAPH,
      initial: rays.makeCellularMaskGuidedLightRayState({
        field: { id: "creative-render-family-field", seed: 91, frequency: 4.5, jitter: 0.9, offset: [0.08, -0.11], valueMode: "distance" },
        mask: sharedMask,
        ray: sharedRay,
      }),
      requestKey: "cellularFieldRequest",
      sourceKey: "cellularFieldSource",
      sourceHashKey: "cellularFieldSourceHash",
      sourceSchema: "axm.cellular-field-source/v0.1",
    },
  };

  const variants = {};
  for (const [name, spec] of Object.entries(specifications)) {
    const requestBytes = stableBytes({ field: spec.initial[spec.requestKey], mask: spec.initial.maskRequest, ray: spec.initial.lightRayRequest });
    const registry = runtime.createHandRegistry(spec.hands);
    const execute = (callerKind) => runtime.executeHandGraph({ registry, graph: spec.graph, initialState: spec.initial, context: { callerKind } });
    const human = execute("human");
    const machine = execute("machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`${name} mask-guided light-ray caller-neutral replay failed`);
    const state = human.finalState;
    if (stableBytes({ field: state[spec.requestKey], mask: state.maskRequest, ray: state.lightRayRequest }).compare(requestBytes) !== 0) throw new Error(`${name} mask-guided light-ray caller request mutated`);

    const source = state[spec.sourceKey];
    const sourceHash = state[spec.sourceHashKey];
    const maskSource = state.coverageMaskSource;
    const maskSourceHash = state.coverageMaskSourceHash;
    const raySource = state.lightRaySource;
    const raySourceHash = state.lightRaySourceHash;
    const raySet = state.lightRaySets?.[raySource?.id];
    const realization = state.realizations?.maskGuidedLightRaysStaticSvg;
    if (!source || source.schema !== spec.sourceSchema || runtime.hashValue(source) !== sourceHash) throw new Error(`${name} retained scalar source identity drifted`);
    if (!maskSource || maskSource.schema !== "axm.coverage-mask-source/v0.1" || runtime.hashValue(maskSource) !== maskSourceHash || maskSource.fieldSourceHash !== sourceHash || maskSource.fieldId !== source.id) throw new Error(`${name} retained coverage-mask source lineage drifted`);
    if (!raySource || raySource.schema !== "axm.mask-guided-light-ray-source/v0.1" || runtime.hashValue(raySource) !== raySourceHash || raySource.fieldSourceHash !== sourceHash || raySource.maskSourceHash !== maskSourceHash) throw new Error(`${name} retained light-ray source lineage drifted`);
    if (!raySet || raySet.schema !== "axm.mask-guided-light-ray-set/v0.1" || raySet.derived !== true || raySet.rebuildable !== true || raySet.raySourceHash !== raySourceHash || raySet.fieldSourceHash !== sourceHash || raySet.maskSourceHash !== maskSourceHash || raySet.rayCount !== 64 || raySet.samplesPerRay !== 24 || raySet.rays.length !== 64) throw new Error(`${name} derived light-ray set boundary drifted`);
    if (!realization || realization.schema !== "axm.vfx.mask-guided-light-rays-static-svg/v0.1" || realization.raySourceHash !== raySourceHash || realization.raySetHash !== raySet.raySetHash || realization.fieldSourceHash !== sourceHash || realization.maskSourceHash !== maskSourceHash) throw new Error(`${name} donor SVG lineage drifted`);

    const exact = rays.buildMaskGuidedLightRaySetHand.execute(state, { rayCount: 64, samplesPerRay: 24, maxRays: 64, maxSamples: 1536 }).state.lightRaySets[raySource.id];
    const roomy = rays.buildMaskGuidedLightRaySetHand.execute(state, { rayCount: 64, samplesPerRay: 24, maxRays: 256, maxSamples: 32768 }).state.lightRaySets[raySource.id];
    if (exact.raySetHash !== raySet.raySetHash || roomy.raySetHash !== raySet.raySetHash) throw new Error(`${name} sufficient working-set budgets changed ray truth`);
    let rayBudgetFailure = null;
    let sampleBudgetFailure = null;
    try { rays.buildMaskGuidedLightRaySetHand.execute(state, { rayCount: 64, samplesPerRay: 24, maxRays: 63, maxSamples: 32768 }); }
    catch (error) { rayBudgetFailure = String(error?.message || error); }
    try { rays.buildMaskGuidedLightRaySetHand.execute(state, { rayCount: 64, samplesPerRay: 24, maxRays: 256, maxSamples: 1535 }); }
    catch (error) { sampleBudgetFailure = String(error?.message || error); }
    if (!rayBudgetFailure?.includes("light ray count budget exceeded: 64 > 63")) throw new Error(`${name} insufficient maxRays did not fail loudly`);
    if (!sampleBudgetFailure?.includes("light ray sample budget exceeded: 1536 > 1535")) throw new Error(`${name} insufficient maxSamples did not fail loudly`);
    if (runtime.hashValue(state[spec.sourceKey]) !== sourceHash || runtime.hashValue(state.coverageMaskSource) !== maskSourceHash || runtime.hashValue(state.lightRaySource) !== raySourceHash) throw new Error(`${name} failed budget attempts rewrote retained source truth`);

    const tampered = structuredClone(state);
    const tamperedSet = tampered.lightRaySets[raySource.id];
    tamperedSet.rays[0].weight = tamperedSet.rays[0].weight > 0.5 ? 0.25 : 0.75;
    tamperedSet.raySetHash = selfHashRaySet(runtime, tamperedSet);
    let tamperFailure = null;
    try { rays.realizeMaskGuidedLightRaysStaticSvgHand.execute(tampered, {}); }
    catch (error) { tamperFailure = String(error?.message || error); }
    if (!tamperFailure?.includes("light ray set does not rebuild from retained source truth")) throw new Error(`${name} self-consistent derived-ray tampering was not rejected from source truth`);

    const adapted = maskGuidedLightRaySetToAxmScene(raySet);
    variants[name] = {
      family: spec.family,
      requestBytes,
      source,
      sourceHash,
      sourceBytes: stableBytes(source),
      maskSource,
      maskSourceHash,
      maskSourceBytes: stableBytes(maskSource),
      raySource,
      raySourceHash,
      raySourceBytes: stableBytes(raySource),
      raySet,
      raySetBytes: stableBytes(raySet),
      svg: realization,
      svgBytes: Buffer.from(realization.content, "utf8"),
      adapted,
      finalStateHash: human.finalStateHash,
      rayBudgetFailure,
      sampleBudgetFailure,
      tamperFailure,
    };
  }

  if (variants.fbm.source.schema === variants.cellular.source.schema) throw new Error("fixture no longer proves distinct retained scalar-source families");
  if (variants.fbm.sourceHash === variants.cellular.sourceHash || variants.fbm.maskSourceHash === variants.cellular.maskSourceHash || variants.fbm.raySourceHash === variants.cellular.raySourceHash || variants.fbm.raySet.raySetHash === variants.cellular.raySet.raySetHash) throw new Error("distinct source families collapsed to identical retained/derived identities");
  if (stableBytes(variants.fbm.raySource).toString("utf8") === stableBytes(variants.cellular.raySource).toString("utf8")) throw new Error("distinct source families unexpectedly produced identical retained ray-source bytes");
  if (JSON.stringify(rayGeometry(variants.fbm.raySet)) !== JSON.stringify(rayGeometry(variants.cellular.raySet))) throw new Error("source family changed shared geometric ray request");
  if (!variants.fbm.raySet.rays.some((ray, index) => Math.abs(ray.weight - variants.cellular.raySet.rays[index].weight) > 0.000001)) throw new Error("distinct source families did not materially change derived ray weights");
  if (JSON.stringify(sceneGeometry(variants.fbm.adapted.scene)) !== JSON.stringify(sceneGeometry(variants.cellular.adapted.scene))) throw new Error("source family leaked into native observation geometry");
  if (JSON.stringify(sceneAlbedo(variants.fbm.adapted.scene)) === JSON.stringify(sceneAlbedo(variants.cellular.adapted.scene))) throw new Error("distinct ray weights collapsed to identical native observation albedo");

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      modules: Object.fromEntries(Object.entries(sources).map(([name, row]) => [name, row.sha256])),
      graphs: {
        fbm: { id: rays.MASK_GUIDED_LIGHT_RAY_GRAPH.id, version: rays.MASK_GUIDED_LIGHT_RAY_GRAPH.version },
        cellular: { id: rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_GRAPH.id, version: rays.CELLULAR_MASK_GUIDED_LIGHT_RAY_GRAPH.version },
      },
    },
    shared_request: { mask: sharedMask, ray: sharedRay, ray_count: 64, samples_per_ray: 24, total_samples: 1536 },
    caller_authority: {
      caller_requests_mutated: false,
      human_machine_replay_identical_per_family: true,
      canonical_scalar_sources_remain_authoritative: true,
      coverage_mask_sources_remain_authoritative: true,
      light_ray_sources_remain_authoritative: true,
      ray_sets_are_canonical: false,
      donor_svgs_are_canonical: false,
      native_scenes_are_canonical: false,
      consumer_semantics_assigned: false,
    },
    variants: Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
      family: row.family,
      final_state_hash: row.finalStateHash,
      request_sha256: sha256(row.requestBytes),
      source: { schema: row.source.schema, hash: row.sourceHash, bytes_sha256: sha256(row.sourceBytes) },
      mask_source: { hash: row.maskSourceHash, bytes_sha256: sha256(row.maskSourceBytes) },
      ray_source: { hash: row.raySourceHash, bytes_sha256: sha256(row.raySourceBytes) },
      ray_set: { hash: row.raySet.raySetHash, bytes_sha256: sha256(row.raySetBytes), rays: row.raySet.rayCount, samples_per_ray: row.raySet.samplesPerRay, total_samples: row.raySet.rayCount * row.raySet.samplesPerRay },
      donor_svg: { bytes_sha256: sha256(row.svgBytes), bytes: row.svgBytes.length, renderer: row.svg.renderer },
      native_scene: { bytes_sha256: sha256(row.adapted.bytes), triangles: row.adapted.scene.triangles.length, adapter: row.adapted.observation },
      working_set_budget: {
        exact_64_rays_1536_samples_matches_roomy: true,
        insufficient_63_rays_failed_loudly: true,
        insufficient_1535_samples_failed_loudly: true,
        ray_budget_error: row.rayBudgetFailure,
        sample_budget_error: row.sampleBudgetFailure,
      },
      source_truth_rebuild: { self_consistent_tamper_rejected: true, error: row.tamperFailure },
    }])),
    comparison: {
      source_hashes_differ: variants.fbm.sourceHash !== variants.cellular.sourceHash,
      mask_source_hashes_differ: variants.fbm.maskSourceHash !== variants.cellular.maskSourceHash,
      ray_source_hashes_differ: variants.fbm.raySourceHash !== variants.cellular.raySourceHash,
      ray_set_hashes_differ: variants.fbm.raySet.raySetHash !== variants.cellular.raySet.raySetHash,
      derived_ray_geometry_identical: JSON.stringify(rayGeometry(variants.fbm.raySet)) === JSON.stringify(rayGeometry(variants.cellular.raySet)),
      derived_ray_weights_differ: true,
      native_geometry_identical: JSON.stringify(sceneGeometry(variants.fbm.adapted.scene)) === JSON.stringify(sceneGeometry(variants.cellular.adapted.scene)),
      native_albedo_differs: JSON.stringify(sceneAlbedo(variants.fbm.adapted.scene)) !== JSON.stringify(sceneAlbedo(variants.cellular.adapted.scene)),
    },
    replaceability: {
      same_downstream_ray_hands_accept_both_source_families: true,
      same_generic_derived_ray_contract_feeds_one_native_observer: true,
      donor_svg_and_native_scene_are_independent_replaceable_observation_bodies: true,
      observer_does_not_rewrite_donor_source_or_ray_truth: true,
    },
    truth_boundary: {
      proven: "for this bounded fixture, current VFX fBm and cellular scalar-source families preserve distinct canonical source lineage while the same mask/ray Hands derive identical ray geometry with materially different coverage-guided weights; sufficient working-set budgets are non-creative, insufficient budgets fail closed, self-consistent derived-ray tampering is rejected by rebuilding from retained source truth, and one source-family-neutral native observer preserves geometry while exposing the weight difference",
      not_proven: ["physical volumetric lighting", "shadowing or occlusion correctness", "radiometry or scattering", "aesthetic quality", "semantic meaning", "production renderer suitability", "real-time or target-device performance", "GPU or browser equivalence", "cross-machine bitwise determinism"],
    },
  };

  return { vfxRevision, sources, variants, receipt };
}
