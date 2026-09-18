import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PATH_FRAME_INSTANCES_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_INSTANCES = 16384;
const SOURCE_SEMANTICS = Object.freeze({
  algorithm: "polyline-bisector-sweep-frame2d/v0.1",
  profile: "symmetric-ribbon2d",
  framePolicy: "left-normal-bisector2d",
  reversalFallback: "outgoing-segment",
  widthMode: "constant-half-width",
});
const INSTANCE_SEMANTICS = Object.freeze({
  algorithm: "verified-path-frame-rigid-instance2d/v0.1",
  selectionPolicy: "stride-with-final-frame",
  translationPolicy: "frame-position",
  orientationPolicy: "tangent-normal-rigid-basis",
  scalePolicy: "identity-only",
  widthPolicy: "carry-sweep-half-width-as-neutral-hint",
  prototypeBinding: "external-required",
  rendererAuthority: "none",
  meshAuthority: "none",
  consumerPlacementAuthority: "none",
});

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  return { sha256: sha256(await readFile(path)) };
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function boundedInteger(value, min, max, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer within [${min},${max}]`);
  }
  return number;
}

function geometryDigest(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

function instanceSetHashPayload(set) {
  return {
    schema: set.schema,
    sweepSourceHash: set.sweepSourceHash,
    pathSourceHash: set.pathSourceHash,
    frameSetHash: set.frameSetHash,
    pathCount: set.pathCount,
    sourcePointCount: set.sourcePointCount,
    instanceCount: set.instanceCount,
    selection: set.selection,
    semantics: set.semantics,
    paths: set.paths,
    provenance: set.provenance,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

function frameSetHashPayload(set) {
  return {
    schema: set.schema,
    sourceHash: set.sourceHash,
    pathSourceHash: set.pathSourceHash,
    pathCount: set.pathCount,
    pointCount: set.pointCount,
    paths: set.paths,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

function validateSource(source, sourceHash, frameSet) {
  if (!source || source.schema !== "axm.path-sweep-frame-source/v0.1") {
    throw new Error("path-frame instance observer requires retained v0.1 sweep-frame source");
  }
  for (const [key, expected] of Object.entries(SOURCE_SEMANTICS)) {
    if (source[key] !== expected) throw new Error(`path-frame instance source ${key} drifted`);
  }
  if (!String(sourceHash || "").trim()) throw new Error("path-frame instance observer requires retained sweep source hash");
  if (!frameSet || frameSet.schema !== "axm.path-sweep-frame-set/v0.1" || frameSet.derived !== true || frameSet.rebuildable !== true) {
    throw new Error("path-frame instance observer requires derived rebuildable frame-set lineage");
  }
  if (frameSet.sourceHash !== sourceHash || frameSet.pathSourceHash !== source.pathSource?.sourceHash) {
    throw new Error("path-frame instance observer frame/source lineage mismatch");
  }
  if (source.provenance?.rendererAuthority !== "none" || source.provenance?.meshAuthority !== "none") {
    throw new Error("retained sweep source unexpectedly claims renderer or mesh authority");
  }
}

function validateInstanceSet(sourceHash, frameSet, set) {
  if (!set || set.schema !== "axm.path-frame-instance-transform-set2d/v0.1" || set.derived !== true || set.rebuildable !== true) {
    throw new Error("path-frame instance observer accepts only derived rebuildable v0.1 transform sets");
  }
  if (set.sweepSourceHash !== sourceHash || set.pathSourceHash !== frameSet.pathSourceHash || set.frameSetHash !== frameSet.frameSetHash) {
    throw new Error("path-frame instance observer derived lineage mismatch");
  }
  if (set.pathCount !== frameSet.pathCount || set.sourcePointCount !== frameSet.pointCount) {
    throw new Error("path-frame instance observer source cardinality mismatch");
  }
  for (const [key, expected] of Object.entries(INSTANCE_SEMANTICS)) {
    if (set.semantics?.[key] !== expected) throw new Error(`path-frame instance semantic ${key} drifted`);
  }
  if (set.provenance?.externalSourceReuse !== "none") throw new Error("path-frame instance provenance drifted");
}

function validatePrototype(prototype) {
  if (!prototype || prototype.schema !== "axm.creative-render.external-neutral-prototype2d/v1") {
    throw new Error("path-frame instance observer requires an explicit external neutral prototype");
  }
  if (!Array.isArray(prototype.vertices) || prototype.vertices.length !== 3) {
    throw new Error("external neutral prototype must contain exactly three local 2D vertices");
  }
  const vertices = prototype.vertices.map((point, index) => ({
    x: finite(point?.x, `prototype.vertices[${index}].x`),
    y: finite(point?.y, `prototype.vertices[${index}].y`),
  }));
  if (!Array.isArray(prototype.albedo) || prototype.albedo.length !== 3) {
    throw new Error("external neutral prototype requires RGB albedo");
  }
  const albedo = prototype.albedo.map((value, index) => boundedInteger(value, 0, 255, `prototype.albedo[${index}]`));
  return { vertices, albedo };
}

function transformLocal(instance, point, label) {
  const tx = finite(instance?.translation?.x, `${label}.translation.x`);
  const ty = finite(instance?.translation?.y, `${label}.translation.y`);
  const xx = finite(instance?.basisX?.x, `${label}.basisX.x`);
  const xy = finite(instance?.basisX?.y, `${label}.basisX.y`);
  const yx = finite(instance?.basisY?.x, `${label}.basisY.x`);
  const yy = finite(instance?.basisY?.y, `${label}.basisY.y`);
  if (instance?.scale?.x !== 1 || instance?.scale?.y !== 1) throw new Error(`${label} must retain donor identity scale`);
  return [tx + (xx * point.x) + (yx * point.y), ty + (xy * point.x) + (yy * point.y), 0];
}

export function pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, instanceSet, prototype, options = {}) {
  validateSource(source, sourceHash, frameSet);
  validateInstanceSet(sourceHash, frameSet, instanceSet);
  const maxInstances = boundedInteger(options.maxInstances ?? 4096, 1, HARD_MAX_INSTANCES, "path-frame instance observer maxInstances");
  if (instanceSet.instanceCount > maxInstances) {
    throw new Error(`path-frame instance observer instance budget exceeded: ${instanceSet.instanceCount} > ${maxInstances}`);
  }
  const neutral = validatePrototype(prototype);
  const triangles = [];
  let counted = 0;
  for (const path of instanceSet.paths || []) {
    for (const instance of path.instances || []) {
      const label = `path-frame instance ${path.id}:${instance.frameIndex}`;
      finite(instance.sweepHalfWidth, `${label}.sweepHalfWidth`);
      triangles.push({
        vertices: neutral.vertices.map((point) => transformLocal(instance, point, label)),
        albedo: [...neutral.albedo],
      });
      counted += 1;
    }
  }
  if (counted !== instanceSet.instanceCount) throw new Error("path-frame instance observer total instance count drifted");
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const prototypeBytes = stableBytes(prototype);
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-path-frame-instances-to-native-prototype/v1",
      retained_path_source_hash: instanceSet.pathSourceHash,
      retained_sweep_source_hash: sourceHash,
      derived_frame_set_hash: frameSet.frameSetHash,
      derived_instance_set_hash: instanceSet.instanceSetHash,
      derived_selection: structuredClone(instanceSet.selection),
      input_instance_count: instanceSet.instanceCount,
      output_triangle_count: triangles.length,
      external_prototype_sha256: sha256(prototypeBytes),
      output_contract: "AXM_SCENE 1",
      output_sha256: sha256(bytes),
      geometry_sha256: geometryDigest(scene),
      basis_consumed_directly: true,
      angle_rederived_by_consumer: false,
      sweep_half_width_used_as_scale: false,
      donor_identity_scale_preserved: true,
      prototype_authority: "CALLER_OWNED_REPLACEABLE_OBSERVER_INPUT",
      native_scene_authority: "DERIVED_REPLACEABLE_OBSERVER_BODY",
      canonical_mesh_authority_acquired: false,
      renderer_authority_acquired: false,
      consumer_placement_authority_acquired: false,
      consumer_semantics_assigned: false,
      observer_policy: "apply a caller-owned neutral triangle through donor-derived translation and rigid tangent/normal basis only; ignore sweepHalfWidth for scale and do not infer sprite, particle, mesh, material, game, UI, product, or world meaning",
    },
  };
}

function fixturePaths() {
  return [
    { id: "neutral-path-a", points: [{ x: 0.12, y: 0.24 }, { x: 0.31, y: 0.36 }, { x: 0.55, y: 0.58 }, { x: 0.84, y: 0.7 }] },
    { id: "neutral-path-b", points: [{ x: 0.14, y: 0.78 }, { x: 0.34, y: 0.68 }, { x: 0.61, y: 0.5 }, { x: 0.86, y: 0.3 }] },
  ];
}

function neutralPrototype() {
  return {
    schema: "axm.creative-render.external-neutral-prototype2d/v1",
    id: "orientation-marker",
    vertices: [{ x: -0.014, y: -0.008 }, { x: 0.018, y: 0 }, { x: -0.014, y: 0.008 }],
    albedo: [176, 176, 176],
    semanticRole: "none",
    canonicalAuthority: "none",
  };
}

export async function observeVisualEffectPathFrameInstancesNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const donorPaths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    frame: resolve(rootPath, "hand-lab/src/path-sweep-frame2d.mjs"),
    instances: resolve(rootPath, "hand-lab/src/path-frame-instances2d.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(donorPaths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(donorPaths.runtime).href}?sha=${sources.runtime.sha256}`);
  const frame = await import(`${pathToFileURL(donorPaths.frame).href}?sha=${sources.frame.sha256}`);
  const instances = await import(`${pathToFileURL(donorPaths.instances).href}?sha=${sources.instances.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (typeof frame.makePathSweepFrameState !== "function" || typeof frame.validatePathSweepFrameSet !== "function" ||
      !Array.isArray(instances.PATH_FRAME_INSTANCES_2D_HANDS) || !instances.PATH_FRAME_INSTANCES_2D_GRAPH ||
      typeof instances.validatePathFrameInstanceTransformSet !== "function" || typeof instances.buildPathFrameInstanceTransformSetHand?.execute !== "function") {
    throw new Error("VFX donor path-frame-instances2d boundary is unavailable");
  }
  if (instances.PATH_FRAME_INSTANCES_2D_GRAPH.id !== "fx.geometry.path-frame-instances2d" || instances.PATH_FRAME_INSTANCES_2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX path-frame-instances2d graph identity");
  }

  const callerPaths = fixturePaths();
  const initial = frame.makePathSweepFrameState(callerPaths, { id: "creative-render-neutral-instances", halfWidth: Number(options.halfWidth ?? 0.025) });
  initial.consumerMetadata = { owner: "creative-render-observer", untouched: true };
  const initialBytes = stableBytes(initial);
  const requestBytes = stableBytes(initial.pathSweepFrameRequest);
  const pathsBytes = stableBytes(initial.paths);
  const registry = runtime.createHandRegistry(instances.PATH_FRAME_INSTANCES_2D_HANDS);
  const execute = (callerKind, state = initial) => runtime.executeHandGraph({
    registry,
    graph: instances.PATH_FRAME_INSTANCES_2D_GRAPH,
    initialState: state,
    context: { callerKind },
  });
  const human = execute("human");
  const machine = execute("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX path-frame instance caller-neutral replay failed");
  if (stableBytes(initial).compare(initialBytes) !== 0) throw new Error("VFX path-frame instance initial state mutated during replay");
  if (stableBytes(human.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0 || stableBytes(machine.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0) {
    throw new Error("VFX path-frame instance caller request mutated");
  }
  if (stableBytes(human.finalState.paths).compare(pathsBytes) !== 0 || stableBytes(machine.finalState.paths).compare(pathsBytes) !== 0) {
    throw new Error("VFX path-frame instance retained caller paths were rewritten");
  }

  const finalState = human.finalState;
  const source = finalState.pathSweepFrameSource;
  const sourceHash = finalState.pathSweepFrameSourceHash;
  const frameSet = finalState.pathSweepFrameSets?.[source?.id];
  const denseSet = finalState.pathFrameInstanceTransformSets?.[source?.id];
  if (frame.validatePathSweepFrameSet(finalState, frameSet, { maxPoints: 4096 }) !== true ||
      instances.validatePathFrameInstanceTransformSet(finalState, denseSet, { maxPoints: 4096, maxInstances: 4096 }) !== true) {
    throw new Error("VFX path-frame instance donor validation failed");
  }

  const prototype = neutralPrototype();
  const denseObserved = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, denseSet, prototype, { maxInstances: denseSet.instanceCount });
  const roomyObserved = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, denseSet, prototype, { maxInstances: 4096 });
  if (denseObserved.observation.output_sha256 !== roomyObserved.observation.output_sha256) {
    throw new Error("path-frame instance observer capacity changed observation bytes");
  }
  let observerBudgetRejected = false;
  try { pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, denseSet, prototype, { maxInstances: denseSet.instanceCount - 1 }); }
  catch (error) { observerBudgetRejected = /instance budget exceeded/.test(String(error)); }
  if (!observerBudgetRejected) throw new Error("path-frame instance observer one-below capacity did not fail closed");

  const exactState = instances.buildPathFrameInstanceTransformSetHand.execute(finalState, { maxPoints: 4096, maxInstances: denseSet.instanceCount, stride: 1 }, {}).state;
  const roomyState = instances.buildPathFrameInstanceTransformSetHand.execute(finalState, { maxPoints: 4096, maxInstances: 4096, stride: 1 }, {}).state;
  const exactSet = exactState.pathFrameInstanceTransformSets[source.id];
  const roomySet = roomyState.pathFrameInstanceTransformSets[source.id];
  if (exactSet.instanceSetHash !== roomySet.instanceSetHash || exactSet.instanceSetHash !== denseSet.instanceSetHash) {
    throw new Error("VFX path-frame instance donor capacity changed derived identity");
  }
  let donorBudgetRejected = false;
  try { instances.buildPathFrameInstanceTransformSetHand.execute(finalState, { maxPoints: 4096, maxInstances: denseSet.instanceCount - 1, stride: 1 }, {}); }
  catch (error) { donorBudgetRejected = /instance budget exceeded/.test(String(error)); }
  if (!donorBudgetRejected) throw new Error("VFX path-frame instance donor one-below capacity did not fail closed");

  const sparseState = instances.buildPathFrameInstanceTransformSetHand.execute(finalState, { maxPoints: 4096, maxInstances: 4096, stride: 2 }, {}).state;
  const sparseSet = sparseState.pathFrameInstanceTransformSets[source.id];
  if (instances.validatePathFrameInstanceTransformSet(sparseState, sparseSet, { maxPoints: 4096, maxInstances: 4096 }) !== true) {
    throw new Error("VFX path-frame sparse selection failed donor validation");
  }
  if (sparseSet.instanceSetHash === denseSet.instanceSetHash || sparseSet.instanceCount >= denseSet.instanceCount) {
    throw new Error("VFX path-frame derived stride selection did not produce a distinct sparser set");
  }
  const finalFrameIncluded = sparseSet.paths.every((path) => path.instances.at(-1)?.frameIndex === path.sourceFrameCount - 1);
  if (!finalFrameIncluded) throw new Error("VFX path-frame stride selection omitted a final frame");
  const sparseObserved = pathFrameInstanceSetToAxmScene(source, sourceHash, frameSet, sparseSet, prototype, { maxInstances: 4096 });

  const wideInitial = frame.makePathSweepFrameState(callerPaths, { id: "creative-render-neutral-instances-wide", halfWidth: 0.09 });
  const wideFinal = execute("machine", wideInitial).finalState;
  const wideSource = wideFinal.pathSweepFrameSource;
  const wideFrameSet = wideFinal.pathSweepFrameSets?.[wideSource?.id];
  const wideSet = wideFinal.pathFrameInstanceTransformSets?.[wideSource?.id];
  if (instances.validatePathFrameInstanceTransformSet(wideFinal, wideSet, { maxPoints: 4096, maxInstances: 4096 }) !== true) {
    throw new Error("VFX path-frame width-hint challenge failed donor validation");
  }
  const wideObserved = pathFrameInstanceSetToAxmScene(wideSource, wideFinal.pathSweepFrameSourceHash, wideFrameSet, wideSet, prototype, { maxInstances: 4096 });
  const widthHintDoesNotScaleGeometry = wideObserved.observation.geometry_sha256 === denseObserved.observation.geometry_sha256;
  if (!widthHintDoesNotScaleGeometry) throw new Error("neutral sweepHalfWidth hint silently scaled external prototype geometry");

  const tampered = structuredClone(denseSet);
  tampered.paths[0].instances[1].translation.x = Number((tampered.paths[0].instances[1].translation.x + 0.1).toFixed(6));
  tampered.instanceSetHash = runtime.hashValue(instanceSetHashPayload(tampered));
  let instanceTamperRejected = false;
  try { instances.validatePathFrameInstanceTransformSet(finalState, tampered, { maxPoints: 4096, maxInstances: 4096 }); }
  catch (error) { instanceTamperRejected = /does not rebuild from verified frame truth/.test(String(error)); }
  if (!instanceTamperRejected) throw new Error("self-consistent derived instance tamper was accepted");

  const frameTamperedState = structuredClone(finalState);
  const tamperedFrame = frameTamperedState.pathSweepFrameSets[source.id];
  tamperedFrame.paths[0].frames[1].tangent.x = Number((tamperedFrame.paths[0].frames[1].tangent.x + 0.125).toFixed(6));
  tamperedFrame.frameSetHash = runtime.hashValue(frameSetHashPayload(tamperedFrame));
  const launderingSet = structuredClone(denseSet);
  launderingSet.frameSetHash = tamperedFrame.frameSetHash;
  launderingSet.instanceSetHash = runtime.hashValue(instanceSetHashPayload(launderingSet));
  let frameTamperRejected = false;
  try { instances.validatePathFrameInstanceTransformSet(frameTamperedState, launderingSet, { maxPoints: 4096, maxInstances: 4096 }); }
  catch (error) { frameTamperRejected = /frame set does not rebuild from retained truth/.test(String(error)); }
  if (!frameTamperRejected) throw new Error("self-consistent frame tamper was laundered into instance lineage");

  const forgedState = structuredClone(finalState);
  forgedState.pathSweepFrameSource.algorithm = "invented-sweep-algorithm/v9";
  forgedState.pathSweepFrameSourceHash = runtime.hashValue(forgedState.pathSweepFrameSource);
  const forgedFrame = forgedState.pathSweepFrameSets[source.id];
  forgedFrame.sourceHash = forgedState.pathSweepFrameSourceHash;
  forgedFrame.frameSetHash = runtime.hashValue(frameSetHashPayload(forgedFrame));
  const forgedSet = structuredClone(denseSet);
  forgedSet.sweepSourceHash = forgedState.pathSweepFrameSourceHash;
  forgedSet.frameSetHash = forgedFrame.frameSetHash;
  forgedSet.instanceSetHash = runtime.hashValue(instanceSetHashPayload(forgedSet));
  let sourceForgeryRejected = false;
  try { instances.validatePathFrameInstanceTransformSet(forgedState, forgedSet, { maxPoints: 4096, maxInstances: 4096 }); }
  catch (error) { sourceForgeryRejected = /source algorithm is invalid/.test(String(error)); }
  if (!sourceForgeryRejected) throw new Error("self-consistent retained sweep semantic forgery was accepted");

  const oversizedPoints = Array.from({ length: 4097 }, (_, index) => ({ x: index / 4096, y: 0.5 }));
  let graphBudgetRejected = false;
  try {
    const oversized = frame.makePathSweepFrameState([{ id: "oversized", points: oversizedPoints }], { id: "oversized", halfWidth: source.halfWidth });
    execute("machine", oversized);
  } catch (error) { graphBudgetRejected = /point budget exceeded: 4097 > 4096/.test(String(error)); }
  if (!graphBudgetRejected) throw new Error("VFX path-frame graph default point capacity did not fail closed");

  const donorStateBytes = stableBytes(finalState);
  const denseSceneBytes = denseObserved.bytes;
  const sparseSceneBytes = sparseObserved.bytes;
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: instances.PATH_FRAME_INSTANCES_2D_GRAPH.id,
      graph_version: instances.PATH_FRAME_INSTANCES_2D_GRAPH.version,
      hand_ids: instances.PATH_FRAME_INSTANCES_2D_HANDS.map((hand) => hand.id),
      donor_graph_reused: true,
      source_files: sources,
      caller_neutral_replay: "PASS",
      caller_request_unchanged: true,
      caller_paths_unchanged: true,
      retained_sweep_source: {
        schema: source.schema,
        source_hash: sourceHash,
        path_source_hash: source.pathSource.sourceHash,
        path_count: source.pathSource.pathCount,
        point_count: source.pathSource.pointCount,
        algorithm: source.algorithm,
        profile: source.profile,
        frame_policy: source.framePolicy,
        reversal_fallback: source.reversalFallback,
        width_mode: source.widthMode,
        half_width: source.halfWidth,
      },
      selected_frame_set: frameSet,
      dense_instance_set: denseSet,
      sparse_instance_set: sparseSet,
    },
    external_prototype: prototype,
    dense_observer: denseObserved.observation,
    sparse_observer: sparseObserved.observation,
    challenges: {
      exact_vs_roomy_donor_capacity: exactSet.instanceSetHash === roomySet.instanceSetHash,
      one_below_donor_capacity_rejected: donorBudgetRejected,
      exact_vs_roomy_observer_capacity: denseObserved.observation.output_sha256 === roomyObserved.observation.output_sha256,
      one_below_observer_capacity_rejected: observerBudgetRejected,
      stride_changes_only_derived_selection: sparseSet.pathSourceHash === denseSet.pathSourceHash && sparseSet.sweepSourceHash === denseSet.sweepSourceHash && sparseSet.frameSetHash === denseSet.frameSetHash && sparseSet.instanceSetHash !== denseSet.instanceSetHash,
      stride_keeps_final_frame: finalFrameIncluded,
      sweep_width_hint_does_not_scale_external_prototype: widthHintDoesNotScaleGeometry,
      self_consistent_instance_tamper_rejected: instanceTamperRejected,
      self_consistent_frame_tamper_cannot_be_laundered: frameTamperRejected,
      self_consistent_retained_semantic_forgery_rejected: sourceForgeryRejected,
      graph_default_4096_point_budget_rejected_4097: graphBudgetRejected,
    },
    truth_boundary: {
      caller_paths_authority: "RETAINED_CALLER_SOURCE_TRUTH",
      sweep_source_authority: "RETAINED_VFX_SOURCE",
      frame_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      instance_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      stride_authority: "DERIVED_EXECUTION_SELECTION_ONLY",
      external_prototype_authority: "CALLER_OWNED_REPLACEABLE_OBSERVER_INPUT",
      native_scene_receipt_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
      donor_prototype_binding: "EXTERNAL_REQUIRED",
      donor_renderer_authority: "NONE",
      donor_mesh_authority: "NONE",
      donor_consumer_placement_authority: "NONE",
      sweep_width_used_as_geometry_scale: false,
      angle_convention_added_by_creative_render: false,
      canonical_mesh_authority_acquired: false,
      consumer_semantics_proven: false,
      sprite_particle_mesh_material_semantics_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
      realtime_performance_proven: false,
      gpu_equivalence_proven: false,
      cross_machine_bitwise_determinism_proven: false,
    },
    outputs: {
      donor_state: { sha256: sha256(donorStateBytes) },
      dense_scene: { sha256: sha256(denseSceneBytes) },
      sparse_scene: { sha256: sha256(sparseSceneBytes) },
    },
  };
  const receiptBytes = stableBytes(receipt);
  return {
    denseSceneBytes,
    sparseSceneBytes,
    donorStateBytes,
    receiptBytes,
    receipt,
    retained: { source, sourceHash },
    frameSet,
    denseSet,
    sparseSet,
  };
}
