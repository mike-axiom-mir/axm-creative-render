import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { precisionMeshToAxmScene } from "./donor_bridge.mjs";
import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function finiteTime(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error(`${label} must be finite and in 0..2`);
  return n;
}

export function temporalSkeletonSpec() {
  return {
    id: "creative-render-temporal-rig",
    bones: [
      { id: "root", parent: null, rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { id: "upper", parent: "root", rest: { translation: [0, 0.8, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { id: "tip", parent: "upper", rest: { translation: [0, 0.8, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    ],
  };
}

export function temporalClipSpec() {
  const s = Math.SQRT1_2;
  return {
    id: "creative-render-temporal-clip",
    duration: 2,
    tracks: [
      {
        id: "root-translate",
        bone: "root",
        property: "translation",
        interpolation: "linear",
        keys: [
          { time: 0, value: [0, 0, 0] },
          { time: 2, value: [0.6, 0, 0] },
        ],
      },
      {
        id: "upper-rotate",
        bone: "upper",
        property: "rotation",
        interpolation: "smoothstep",
        keys: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 2, value: [0, 0, s, s] },
        ],
      },
    ],
  };
}

export function normalizeSampleTimes(times = [0, 1, 2]) {
  if (!Array.isArray(times) || times.length < 2 || times.length > 16) {
    throw new Error("sample times must contain 2..16 entries");
  }
  const normalized = times.map((value, index) => finiteTime(value, `sample time ${index}`));
  for (let i = 1; i < normalized.length; i += 1) {
    if (!(normalized[i] > normalized[i - 1])) throw new Error("sample times must be strictly increasing");
  }
  return normalized;
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function requireCleanPass(result, label, expectedReceipts) {
  object(result, label);
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) {
    throw new Error(`${label} did not pass cleanly: ${String(result.status)}`);
  }
  if (!Array.isArray(result.receipts) || result.receipts.length !== expectedReceipts) {
    throw new Error(`${label} receipt count drifted`);
  }
  return result;
}

export async function observeUniversalCreationTemporal(root, times = [0, 1, 2]) {
  const sampleTimes = normalizeSampleTimes(times);
  const rootPath = resolve(root);
  const entryPath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const entry = await digestFile(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands;
  const flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function") {
    throw new Error("Universal Creation donor does not expose creativeHands");
  }
  if (!flow || typeof flow.summary !== "function" || typeof flow.run !== "function") {
    throw new Error("Universal Creation donor does not expose creativeFlow");
  }

  const audit = object(hands.audit(), "creative hands audit");
  const recipes = object(hands.recipeRegistry(), "creative recipe registry");
  const flowSummary = object(flow.summary(), "creative flow summary");

  const baseline = requireCleanPass(
    flow.run({
      mode: "execute",
      goal: "build one bounded rigged mesh and animation clip for temporal render sampling",
      state: { bridge: "axm-creative-render-temporal-v0.3" },
      steps: [
        { id: "skeleton", hand_id: "creative.rig-skeleton.create", args: { spec: temporalSkeletonSpec() }, save_as: "skeleton" },
        { id: "mesh", hand_id: "creative.mesh-primitive.cube", args: { spec: { id: "temporal-rig-cube", detail: 8 } }, save_as: "mesh" },
        { id: "clip", hand_id: "creative.animation-clip.create", args: { skeleton: { $state: "skeleton" }, spec: temporalClipSpec() }, save_as: "clip" },
        { id: "skin", hand_id: "creative.rig-skin.nearest-bind", args: { mesh: { $state: "mesh" }, skeleton: { $state: "skeleton" } }, save_as: "skin" },
      ],
    }),
    "Universal Creation temporal baseline",
    4,
  );

  const baselineState = baseline.final_state;
  const samples = [];
  for (const time of sampleTimes) {
    const sampled = requireCleanPass(
      flow.run({
        mode: "execute",
        goal: `sample the rigged mesh at t=${time}`,
        state: {
          skeleton: baselineState.skeleton,
          mesh: baselineState.mesh,
          clip: baselineState.clip,
          skin: baselineState.skin,
        },
        steps: [
          { id: "sample", hand_id: "creative.animation-clip.sample-pose", args: { skeleton: { $state: "skeleton" }, clip: { $state: "clip" }, time }, save_as: "sample" },
          { id: "deform", hand_id: "creative.rig-skin.deform", args: { mesh: { $state: "mesh" }, skeleton: { $state: "skeleton" }, skin: { $state: "skin" }, pose: { $state: "sample.pose" } }, save_as: "deformed" },
          { id: "bounds", hand_id: "creative.mesh-analysis.bounds", args: { mesh: { $state: "deformed" } }, save_as: "bounds" },
        ],
      }),
      `Universal Creation temporal sample ${time}`,
      3,
    );

    const mesh = object(sampled.final_state?.deformed, `deformed mesh at ${time}`);
    const scene = precisionMeshToAxmScene(mesh, { scale: 0.38, albedo: [120, 206, 255] });
    const sceneBytes = Buffer.from(serializeScene(scene), "utf8");
    const bounds = object(sampled.final_state?.bounds, `bounds at ${time}`);
    samples.push({
      time,
      flow_digest: sampled.digest ?? null,
      receipt_digests: sampled.receipts.map((row) => row.digest ?? null),
      operation_ids: sampled.receipts.map((row) => row.operation_id ?? null),
      mesh_digest: mesh.digest ?? null,
      bounds_size: bounds.size ?? null,
      scene_bytes: sceneBytes,
      scene_sha256: sha256(sceneBytes),
    });
  }

  return {
    samples,
    observation: {
      schema: "axm.creative-render.temporal-uc-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      creative_hands_version: String(hands.version ?? "unknown"),
      hand_count: audit.total,
      recipe_count: recipes.count,
      hand_audit_digest: audit.digest ?? null,
      recipe_registry_digest: recipes.digest ?? null,
      creative_flow_version: String(flow.version ?? "unknown"),
      creative_flow_summary_digest: flowSummary.digest ?? null,
      baseline_flow_digest: baseline.digest ?? null,
      baseline_receipt_digests: baseline.receipts.map((row) => row.digest ?? null),
      sample_times: sampleTimes,
      sample_count: samples.length,
      distinct_scene_count: new Set(samples.map((sample) => sample.scene_sha256)).size,
      adapter: {
        input: "axm.precision-mesh/v1",
        output: "AXM_SCENE 1",
        coordinate_scale: 0.38,
        albedo_rgb: [120, 206, 255],
        lossy: true,
        omitted_semantics: ["normals", "uvs", "materials", "skin", "skeleton", "animation-clip"],
      },
      samples: samples.map(({ scene_bytes, ...sample }) => sample),
    },
  };
}
