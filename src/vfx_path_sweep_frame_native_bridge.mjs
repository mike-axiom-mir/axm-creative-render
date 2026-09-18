import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PATH_SWEEP_FRAME_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_POINTS = 16384;
const FIXED_SEMANTICS = Object.freeze({
  algorithm: "polyline-bisector-sweep-frame2d/v0.1",
  profile: "symmetric-ribbon2d",
  framePolicy: "left-normal-bisector2d",
  reversalFallback: "outgoing-segment",
  widthMode: "constant-half-width",
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

function boundedInteger(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer within [${min},${max}]`);
  }
  return number;
}

function near(a, b, epsilon = 3e-6) {
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function geometryDigest(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
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

function validateSource(source, sourceHash, paths, frameSet) {
  if (!source || source.schema !== "axm.path-sweep-frame-source/v0.1") {
    throw new Error("path-sweep observer requires retained v0.1 sweep-frame source");
  }
  for (const [key, expected] of Object.entries(FIXED_SEMANTICS)) {
    if (source[key] !== expected) throw new Error(`path-sweep source ${key} drifted`);
  }
  if (!String(sourceHash || "").trim()) throw new Error("path-sweep observer requires retained source hash");
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("path-sweep observer requires retained caller paths");
  if (!source.pathSource || source.pathSource.sourceHash !== frameSet?.pathSourceHash) {
    throw new Error("path-sweep observer path-source lineage mismatch");
  }
  if (source.provenance?.rendererAuthority !== "none" || source.provenance?.meshAuthority !== "none") {
    throw new Error("path-sweep retained source unexpectedly claims renderer or mesh authority");
  }
}

function offset(frame, sign) {
  return [
    Number((frame.x + (sign * frame.normal.x * frame.halfWidth)).toFixed(9)),
    Number((frame.y + (sign * frame.normal.y * frame.halfWidth)).toFixed(9)),
    0,
  ];
}

export function pathSweepFrameSetToAxmScene(paths, source, sourceHash, frameSet, options = {}) {
  if (!frameSet || frameSet.schema !== "axm.path-sweep-frame-set/v0.1" || frameSet.derived !== true || frameSet.rebuildable !== true) {
    throw new Error("path-sweep observer accepts only derived rebuildable v0.1 frame sets");
  }
  validateSource(source, sourceHash, paths, frameSet);
  if (frameSet.sourceHash !== sourceHash) throw new Error("path-sweep observer source lineage mismatch");
  if (!String(frameSet.frameSetHash || "").trim()) throw new Error("path-sweep observer requires derived frame-set hash");
  if (frameSet.pathCount !== paths.length || frameSet.paths?.length !== paths.length) {
    throw new Error("path-sweep observer path cardinality mismatch");
  }

  const maxPoints = boundedInteger(options.maxPoints ?? 4096, 2, HARD_MAX_POINTS, "path-sweep observer maxPoints");
  if (frameSet.pointCount > maxPoints) {
    throw new Error(`path-sweep observer point budget exceeded: ${frameSet.pointCount} > ${maxPoints}`);
  }

  let counted = 0;
  const triangles = [];
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const retainedPath = paths[pathIndex];
    const derivedPath = frameSet.paths[pathIndex];
    if (!derivedPath || derivedPath.id !== retainedPath.id || derivedPath.frameCount !== retainedPath.points.length) {
      throw new Error(`path-sweep observer path lineage/count mismatch at ${pathIndex}`);
    }
    if (!Array.isArray(derivedPath.frames) || derivedPath.frames.length !== retainedPath.points.length) {
      throw new Error(`path-sweep observer frame cardinality mismatch for ${retainedPath.id}`);
    }

    for (let index = 0; index < derivedPath.frames.length; index += 1) {
      const frame = derivedPath.frames[index];
      const point = retainedPath.points[index];
      counted += 1;
      if (frame.index !== index || !near(frame.x, round6(point.x)) || !near(frame.y, round6(point.y))) {
        throw new Error(`path-sweep observer frame/canonical point mismatch at ${retainedPath.id}:${index}`);
      }
      if (!near(frame.halfWidth, source.halfWidth)) throw new Error("path-sweep observer half-width lineage drifted");
      const tangentLength = Math.hypot(frame.tangent?.x, frame.tangent?.y);
      const normalLength = Math.hypot(frame.normal?.x, frame.normal?.y);
      const dot = (frame.tangent?.x * frame.normal?.x) + (frame.tangent?.y * frame.normal?.y);
      if (!near(tangentLength, 1, 5e-6) || !near(normalLength, 1, 5e-6) || !near(dot, 0, 5e-6)) {
        throw new Error(`path-sweep observer received invalid orthonormal frame at ${retainedPath.id}:${index}`);
      }
      if (!near(frame.normal.x, -frame.tangent.y) || !near(frame.normal.y, frame.tangent.x)) {
        throw new Error(`path-sweep observer left-normal orientation drifted at ${retainedPath.id}:${index}`);
      }
    }

    for (let index = 0; index < derivedPath.frames.length - 1; index += 1) {
      const a = derivedPath.frames[index];
      const b = derivedPath.frames[index + 1];
      const aLeft = offset(a, 1);
      const aRight = offset(a, -1);
      const bLeft = offset(b, 1);
      const bRight = offset(b, -1);
      const gray = 176;
      triangles.push(
        { vertices: [aLeft, aRight, bRight], albedo: [gray, gray, gray] },
        { vertices: [aLeft, bRight, bLeft], albedo: [gray, gray, gray] },
      );
    }
  }
  if (counted !== frameSet.pointCount) throw new Error("path-sweep observer total point count drifted");

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-path-sweep-frame-to-native-ribbon/v1",
      retained_path_source_hash: frameSet.pathSourceHash,
      retained_sweep_source_hash: sourceHash,
      derived_frame_set_hash: frameSet.frameSetHash,
      input_path_count: frameSet.pathCount,
      input_point_count: frameSet.pointCount,
      output_triangle_count: triangles.length,
      output_contract: "AXM_SCENE 1",
      output_sha256: sha256(bytes),
      geometry_sha256: geometryDigest(scene),
      geometry_uses_only_retained_points_plus_donor_derived_normals_and_half_width: true,
      albedo_encodes_frame_semantics: false,
      mesh_authority_acquired: false,
      renderer_authority_acquired: false,
      consumer_semantics_assigned: false,
      observer_policy: "build a disposable neutral ribbon mesh from retained path points plus donor-derived left-normal sweep frames; keep caller paths canonical and do not infer stroke, road, border, seam, crease, material, physics, gameplay, UI, or world meaning",
    },
  };
}

function fixturePaths() {
  return [
    {
      id: "neutral-path-a",
      points: [
        { x: 0.12, y: 0.24 },
        { x: 0.31, y: 0.36 },
        { x: 0.55, y: 0.58 },
        { x: 0.84, y: 0.7 },
      ],
      callerMetadata: { role: "unspecified", retained: true },
    },
    {
      id: "neutral-path-b",
      points: [
        { x: 0.14, y: 0.78 },
        { x: 0.34, y: 0.68 },
        { x: 0.61, y: 0.5 },
        { x: 0.86, y: 0.3 },
      ],
      callerMetadata: { role: "unspecified", retained: true },
    },
  ];
}

export async function observeVisualEffectPathSweepFrameNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    sweep: resolve(rootPath, "hand-lab/src/path-sweep-frame2d.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const sweep = await import(`${pathToFileURL(paths.sweep).href}?sha=${sources.sweep.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(sweep.PATH_SWEEP_FRAME_2D_HANDS) || !sweep.PATH_SWEEP_FRAME_2D_GRAPH ||
      typeof sweep.makePathSweepFrameState !== "function" || typeof sweep.validatePathSweepFrameSet !== "function") {
    throw new Error("VFX donor path-sweep-frame2d boundary is unavailable");
  }
  if (sweep.PATH_SWEEP_FRAME_2D_GRAPH.id !== "fx.geometry.path-sweep-frame2d" || sweep.PATH_SWEEP_FRAME_2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX path-sweep-frame2d graph identity");
  }

  const callerPaths = fixturePaths();
  const initial = sweep.makePathSweepFrameState(callerPaths, {
    id: "creative-render-neutral-path-sweep",
    halfWidth: Number(options.halfWidth ?? 0.025),
  });
  initial.consumerMetadata = { owner: "creative-render-observer", untouched: true };
  const initialBytes = stableBytes(initial);
  const requestBytes = stableBytes(initial.pathSweepFrameRequest);
  const pathsBytes = stableBytes(initial.paths);
  const registry = runtime.createHandRegistry(sweep.PATH_SWEEP_FRAME_2D_HANDS);
  const execute = (callerKind) => runtime.executeHandGraph({
    registry,
    graph: sweep.PATH_SWEEP_FRAME_2D_GRAPH,
    initialState: initial,
    context: { callerKind },
  });
  const human = execute("human");
  const machine = execute("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX path-sweep caller-neutral replay failed");
  if (stableBytes(initial).compare(initialBytes) !== 0) throw new Error("VFX path-sweep initial state mutated during replay");
  if (stableBytes(human.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0 ||
      stableBytes(machine.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0) {
    throw new Error("VFX path-sweep caller request mutated");
  }
  if (stableBytes(human.finalState.paths).compare(pathsBytes) !== 0 || stableBytes(machine.finalState.paths).compare(pathsBytes) !== 0) {
    throw new Error("VFX path-sweep retained caller paths were rewritten");
  }

  const finalState = human.finalState;
  const source = finalState.pathSweepFrameSource;
  const sourceHash = finalState.pathSweepFrameSourceHash;
  const frameSet = finalState.pathSweepFrameSets?.[source?.id];
  if (sweep.validatePathSweepFrameSet(finalState, frameSet, { maxPoints: 4096 }) !== true) {
    throw new Error("VFX path-sweep donor validation failed");
  }

  const exactObserved = pathSweepFrameSetToAxmScene(finalState.paths, source, sourceHash, frameSet, { maxPoints: frameSet.pointCount });
  const roomyObserved = pathSweepFrameSetToAxmScene(finalState.paths, source, sourceHash, frameSet, { maxPoints: 4096 });
  if (exactObserved.observation.output_sha256 !== roomyObserved.observation.output_sha256) {
    throw new Error("path-sweep observer capacity changed derived observation bytes");
  }

  let observerBudgetRejected = false;
  try {
    pathSweepFrameSetToAxmScene(finalState.paths, source, sourceHash, frameSet, { maxPoints: frameSet.pointCount - 1 });
  } catch (error) {
    observerBudgetRejected = /point budget exceeded/.test(String(error));
  }
  if (!observerBudgetRejected) throw new Error("path-sweep observer one-below capacity did not fail closed");

  const normalized = sweep.normalizePathSweepFrameSourceHand.execute(initial, {}, {}).state;
  const donorExact = sweep.buildPathSweepFrameSetHand.execute(normalized, { maxPoints: frameSet.pointCount }, {}).state;
  const donorRoomy = sweep.buildPathSweepFrameSetHand.execute(normalized, { maxPoints: 4096 }, {}).state;
  const exactSet = donorExact.pathSweepFrameSets[source.id];
  const roomySet = donorRoomy.pathSweepFrameSets[source.id];
  if (exactSet.frameSetHash !== roomySet.frameSetHash) throw new Error("VFX path-sweep donor capacity changed derived frame identity");

  let donorBudgetRejected = false;
  try { sweep.buildPathSweepFrameSetHand.execute(normalized, { maxPoints: frameSet.pointCount - 1 }, {}); }
  catch (error) { donorBudgetRejected = /point budget exceeded/.test(String(error)); }
  if (!donorBudgetRejected) throw new Error("VFX path-sweep donor one-below capacity did not fail closed");

  const zeroSpanPaths = fixturePaths();
  zeroSpanPaths[0].points[2] = structuredClone(zeroSpanPaths[0].points[1]);
  let zeroSpanRejected = false;
  try {
    const zeroState = sweep.makePathSweepFrameState(zeroSpanPaths, { id: "zero-span", halfWidth: source.halfWidth });
    sweep.normalizePathSweepFrameSourceHand.execute(zeroState, {}, {});
  } catch (error) { zeroSpanRejected = /zero-length span/.test(String(error)); }
  if (!zeroSpanRejected) throw new Error("VFX path-sweep undefined zero-length span was accepted");

  const oversizedPoints = Array.from({ length: 4097 }, (_, index) => ({ x: index / 4096, y: 0.5 }));
  let graphBudgetRejected = false;
  try {
    const oversized = sweep.makePathSweepFrameState([{ id: "oversized", points: oversizedPoints }], { id: "oversized", halfWidth: source.halfWidth });
    runtime.executeHandGraph({ registry, graph: sweep.PATH_SWEEP_FRAME_2D_GRAPH, initialState: oversized, context: { callerKind: "machine" } });
  } catch (error) { graphBudgetRejected = /point budget exceeded: 4097 > 4096/.test(String(error)); }
  if (!graphBudgetRejected) throw new Error("VFX path-sweep graph default capacity did not fail closed");

  const tampered = structuredClone(frameSet);
  tampered.paths[0].frames[1].normal.x = round6(tampered.paths[0].frames[1].normal.x + 0.125);
  tampered.frameSetHash = runtime.hashValue(frameSetHashPayload(tampered));
  let derivedTamperRejected = false;
  try { sweep.validatePathSweepFrameSet(finalState, tampered, { maxPoints: 4096 }); }
  catch (error) { derivedTamperRejected = /does not rebuild from retained truth/.test(String(error)); }
  if (!derivedTamperRejected) throw new Error("self-consistent derived path-sweep tamper was accepted");

  const forgedState = structuredClone(finalState);
  forgedState.pathSweepFrameSource.algorithm = "invented-sweep-algorithm/v9";
  forgedState.pathSweepFrameSourceHash = runtime.hashValue(forgedState.pathSweepFrameSource);
  const forgedSet = structuredClone(frameSet);
  forgedSet.sourceHash = forgedState.pathSweepFrameSourceHash;
  forgedSet.frameSetHash = runtime.hashValue(frameSetHashPayload(forgedSet));
  let sourceForgeryRejected = false;
  try { sweep.validatePathSweepFrameSet(forgedState, forgedSet, { maxPoints: 4096 }); }
  catch (error) { sourceForgeryRejected = /source algorithm is invalid/.test(String(error)); }
  if (!sourceForgeryRejected) throw new Error("self-consistent retained path-sweep semantic forgery was accepted");

  const donorStateBytes = stableBytes(finalState);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: sweep.PATH_SWEEP_FRAME_2D_GRAPH.id,
      graph_version: sweep.PATH_SWEEP_FRAME_2D_GRAPH.version,
      hand_ids: sweep.PATH_SWEEP_FRAME_2D_HANDS.map((hand) => hand.id),
      donor_graph_reused: true,
      source_files: sources,
      caller_neutral_replay: "PASS",
      caller_request_unchanged: true,
      caller_paths_unchanged: true,
      retained_source: {
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
    },
    native_observer: exactObserved.observation,
    challenges: {
      exact_vs_roomy_donor_capacity: exactSet.frameSetHash === roomySet.frameSetHash,
      one_below_donor_capacity_rejected: donorBudgetRejected,
      exact_vs_roomy_observer_capacity: exactObserved.observation.output_sha256 === roomyObserved.observation.output_sha256,
      one_below_observer_capacity_rejected: observerBudgetRejected,
      zero_length_span_rejected: zeroSpanRejected,
      graph_default_4096_point_budget_rejected_4097: graphBudgetRejected,
      self_consistent_derived_tamper_rejected: derivedTamperRejected,
      self_consistent_retained_semantic_forgery_rejected: sourceForgeryRejected,
    },
    truth_boundary: {
      caller_paths_authority: "RETAINED_CALLER_SOURCE_TRUTH",
      sweep_source_authority: "RETAINED_VFX_SOURCE",
      frame_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      native_scene_receipt_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
      donor_renderer_authority: "NONE",
      donor_mesh_authority: "NONE",
      creative_render_mesh_authority_acquired: false,
      consumer_semantics_proven: false,
      physical_sweep_proven: false,
      curvature_correctness_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
      realtime_performance_proven: false,
      gpu_equivalence_proven: false,
      cross_machine_bitwise_determinism_proven: false,
    },
    outputs: {
      scene: { sha256: sha256(exactObserved.bytes), bytes: exactObserved.bytes.length },
      donor_state: { sha256: sha256(donorStateBytes), bytes: donorStateBytes.length },
    },
  };
  const receiptBytes = stableBytes(receipt);
  return {
    sceneBytes: exactObserved.bytes,
    donorStateBytes,
    receiptBytes,
    receipt,
    frameSet,
    retained: { source, sourceHash, paths: finalState.paths },
  };
}
