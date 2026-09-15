import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const MAX_VFX_POINTS = 24_000;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function boundedInteger(value, label, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return number;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function normalizedScene(source) {
  if (Buffer.isBuffer(source) || typeof source === "string") {
    const bytes = Buffer.isBuffer(source) ? Buffer.from(source) : Buffer.from(source, "utf8");
    return { scene: parseScene(bytes.toString("utf8")), bytes };
  }
  const scene = object(source, "AXM scene");
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  return { scene, bytes };
}

function pushPoint(points, xyz, size, role, phase, intensity = 1) {
  if (!Array.isArray(xyz) || xyz.length !== 3) throw new Error("sample point must contain xyz");
  points.push(
    round6(finite(xyz[0], "sample x")),
    round6(finite(xyz[1], "sample y")),
    round6(finite(xyz[2], "sample z")),
    round6(size),
    role,
    round6(phase),
    round6(intensity),
  );
}

export function axmSceneToHolographicSampleField(source, options = {}) {
  const { scene, bytes } = normalizedScene(source);
  if (scene.version !== 1 || !Array.isArray(scene.triangles) || scene.triangles.length === 0) {
    throw new Error("direct-sample bridge requires non-empty AXM_SCENE 1 triangle state");
  }

  const maxTriangles = boundedInteger(options.maxTriangles ?? 512, "maxTriangles", 1, 512);
  const samplesPerTriangle = boundedInteger(options.samplesPerTriangle ?? 24, "samplesPerTriangle", 4, 40);
  const pointSize = finite(options.pointSize ?? 1.6, "pointSize");
  if (pointSize < 0.25 || pointSize > 8) throw new Error("pointSize must be in [0.25,8]");

  const triangleCount = Math.min(scene.triangles.length, maxTriangles);
  const modeledPointCount = triangleCount * (samplesPerTriangle + 3);
  if (modeledPointCount > MAX_VFX_POINTS) {
    throw new Error(`direct-sample working set would exceed ${MAX_VFX_POINTS} points`);
  }

  const points = [];
  const phaseDenominator = Math.max(1, modeledPointCount - 1);
  let pointIndex = 0;
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const triangle = object(scene.triangles[triangleIndex], `triangle ${triangleIndex}`);
    if (!Array.isArray(triangle.vertices) || triangle.vertices.length !== 3) {
      throw new Error(`triangle ${triangleIndex} must contain exactly three vertices`);
    }
    const [a, b, c] = triangle.vertices;
    const role = triangleIndex % 8;

    for (const vertex of [a, b, c]) {
      pushPoint(points, vertex, pointSize * 1.08, role, pointIndex / phaseDenominator);
      pointIndex += 1;
    }

    for (let sample = 0; sample < samplesPerTriangle; sample += 1) {
      let u = (sample + 0.5) / samplesPerTriangle;
      let v = ((sample + 1) * 0.6180339887498949) % 1;
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const w = 1 - u - v;
      const xyz = [
        a[0] * w + b[0] * u + c[0] * v,
        a[1] * w + b[1] * u + c[1] * v,
        a[2] * w + b[2] * u + c[2] * v,
      ];
      pushPoint(points, xyz, pointSize, role, pointIndex / phaseDenominator);
      pointIndex += 1;
    }
  }

  const sourceSceneSha256 = sha256(bytes);
  const field = {
    id: String(options.id ?? "axm-scene-direct-sample"),
    sourceKind: "AXM_SCENE 1",
    sourceDigest: sourceSceneSha256,
    stride: 7,
    points,
    style: {
      pattern: String(options.pattern ?? "none"),
      amount: finite(options.amount ?? 0, "style amount"),
      scale: finite(options.patternScale ?? 7, "style scale"),
    },
  };
  if (field.style.amount < 0 || field.style.amount > 1) throw new Error("style amount must be in [0,1]");
  if (field.style.scale < 0.5 || field.style.scale > 30) throw new Error("style scale must be in [0.5,30]");

  return {
    field,
    observation: {
      schema: "axm.creative-render.direct-sample-adapter-observation/v1",
      source_contract: "AXM_SCENE 1",
      source_scene_sha256: sourceSceneSha256,
      source_triangle_count: scene.triangles.length,
      projected_triangle_count: triangleCount,
      samples_per_triangle: samplesPerTriangle,
      point_count: points.length / 7,
      stride: 7,
      point_ceiling: MAX_VFX_POINTS,
      bounded: triangleCount < scene.triangles.length,
      albedo_semantics_projected: false,
      adapter_policy: "three exact vertices plus deterministic bounded barycentric surface samples per admitted triangle",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export async function observeVisualEffectDirectSamples(root, sampleField, options = {}) {
  const rootPath = resolve(root);
  const runtimePath = resolve(rootPath, "hand-lab/src/hand-runtime.mjs");
  const streamPath = resolve(rootPath, "hand-lab/src/holographic-state-stream.mjs");
  const [runtimeSource, streamSource] = await Promise.all([fileDigest(runtimePath), fileDigest(streamPath)]);

  const runtime = await import(`${pathToFileURL(runtimePath).href}?sha=${runtimeSource.sha256}`);
  const stream = await import(`${pathToFileURL(streamPath).href}?sha=${streamSource.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the expected Hand runtime");
  }
  if (
    !Array.isArray(stream.DIRECT_SAMPLE_PROJECTOR_HANDS) ||
    !stream.DIRECT_SAMPLE_PROJECTOR_GRAPH ||
    typeof stream.makeDirectSampleState !== "function"
  ) {
    throw new Error("Visual Effect Fabric donor does not expose the direct-sample projector contract");
  }

  object(sampleField, "direct sample field");
  if (!Array.isArray(sampleField.points) || sampleField.points.length === 0 || sampleField.points.length % 7 !== 0) {
    throw new Error("direct sample field must be a non-empty packed stride-7 array");
  }
  const inputPointCount = sampleField.points.length / 7;
  if (inputPointCount > MAX_VFX_POINTS) throw new Error("direct sample field exceeds VFX point ceiling");

  const execute = () => {
    const registry = runtime.createHandRegistry(stream.DIRECT_SAMPLE_PROJECTOR_HANDS);
    return runtime.executeHandGraph({
      registry,
      graph: stream.DIRECT_SAMPLE_PROJECTOR_GRAPH,
      initialState: stream.makeDirectSampleState(sampleField, options.seed ?? 20260915),
      context: { callerKind: "axm-creative-render" },
    });
  };

  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("direct-sample VFX state repeat verification failed");

  const finalState = object(first.finalState, "direct-sample VFX final state");
  const realization = object(finalState.realizations?.holographicStateProjector, "direct-sample VFX realization");
  const workingSet = object(realization.workingSet, "direct-sample VFX working set");
  if (typeof realization.content !== "string" || !realization.content.includes("<canvas")) {
    throw new Error("direct-sample VFX projector did not produce HTML canvas content");
  }
  if (first.graph?.id !== "fx.holographic-state-projector-direct-sample") {
    throw new Error(`unexpected direct-sample graph: ${String(first.graph?.id)}`);
  }
  if (realization.renderer !== "axm.vfx.holographic-state-projector/v0.1") {
    throw new Error(`unexpected direct-sample renderer: ${String(realization.renderer)}`);
  }
  if (finalState.form?.sourceDigest !== sampleField.sourceDigest || finalState.form?.sourceKind !== sampleField.sourceKind) {
    throw new Error("direct-sample projector lost caller source identity");
  }
  if (finalState.sampleField?.pointCount !== inputPointCount || workingSet.pointCount !== inputPointCount) {
    throw new Error("direct-sample projector point-count continuity failed");
  }
  if (
    workingSet.canonicalFormRetained !== true ||
    workingSet.derivedSampleFieldEditable !== true ||
    workingSet.derivedGpuDataRebuildable !== true ||
    workingSet.fieldBufferBuildPolicy !== "once-per-sample-field-hash"
  ) {
    throw new Error("direct-sample projector lost its source/derived working-set boundary");
  }

  const htmlBytes = Buffer.from(realization.content, "utf8");
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  return {
    htmlBytes,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-direct-sample-observation/v1",
      donor: "axm-visual-effect-fabric",
      runtime_sha256: runtimeSource.sha256,
      stream_module_sha256: streamSource.sha256,
      graph_id: first.graph?.id ?? stream.DIRECT_SAMPLE_PROJECTOR_GRAPH.id,
      graph_version: first.graph?.version ?? stream.DIRECT_SAMPLE_PROJECTOR_GRAPH.version,
      graph_stage_count: stream.DIRECT_SAMPLE_PROJECTOR_GRAPH.stages.length,
      executed_stage_count: first.executedStageIds?.length ?? null,
      final_state_hash: first.finalStateHash,
      source_kind: finalState.form?.sourceKind ?? null,
      source_digest: finalState.form?.sourceDigest ?? null,
      sample_field_schema: finalState.sampleField?.schema ?? null,
      sample_field_hash: realization.sampleFieldHash ?? null,
      point_count: inputPointCount,
      renderer: realization.renderer,
      modeled_buffer_bytes: workingSet.modeledBufferBytes,
      source_identity_retained: true,
      derived_sample_field_editable: workingSet.derivedSampleFieldEditable,
      derived_gpu_data_rebuildable: workingSet.derivedGpuDataRebuildable,
      field_buffer_build_policy: workingSet.fieldBufferBuildPolicy,
      repeat_verification: "PASS",
      html_sha256: sha256(htmlBytes),
      state_sha256: sha256(stateBytes),
    },
  };
}
