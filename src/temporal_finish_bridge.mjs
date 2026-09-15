import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePpmRgb8, ppmToPrecisionRaster, precisionRasterToPpm } from "./post_render_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

const MAX_SEQUENCE_FRAMES = 32;
const MAX_TOTAL_RGBA_BYTES = 32 * 1024 * 1024;
const FRAME_FINISH_HAND = "creative.frame-finish.motion-trail";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function boundedInt(value, label, low, high) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < low || n > high) throw new Error(`${label} must be an integer in ${low}..${high}`);
  return n;
}

function boundedDecay(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("decay must be a finite number in 0..1");
  return n;
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export function buildTemporalFinishRequest(rasters, options = {}) {
  if (!Array.isArray(rasters) || rasters.length < 2 || rasters.length > MAX_SEQUENCE_FRAMES) {
    throw new Error(`temporal finishing requires 2..${MAX_SEQUENCE_FRAMES} raster frames`);
  }
  const maxWindow = boundedInt(options.maxWindow ?? 3, "maxWindow", 1, 8);
  const decay = boundedDecay(options.decay ?? 0.65);
  const state = { frames: rasters };
  const steps = rasters.map((_, index) => {
    const start = Math.max(0, index - maxWindow + 1);
    const refs = [];
    for (let source = start; source <= index; source += 1) refs.push({ $state: `frames.${source}` });
    return {
      id: `finish-${String(index).padStart(3, "0")}`,
      hand_id: FRAME_FINISH_HAND,
      args: { frames: refs, spec: { decay } },
      save_as: `finished_${String(index).padStart(3, "0")}`,
    };
  });
  return {
    mode: "execute",
    goal: "apply bounded sequence-aware motion-trail finishing to exact rendered frames",
    state,
    steps,
    policy: { max_window: maxWindow, decay },
  };
}

function validateResult(result, expectedCount) {
  object(result, "temporal finish Creative Flow result");
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) {
    throw new Error(`temporal finish Creative Flow did not pass cleanly: ${String(result.status)}`);
  }
  if (!Array.isArray(result.receipts) || result.receipts.length !== expectedCount) throw new Error("temporal finish receipt count drifted");
  const rasters = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const key = `finished_${String(index).padStart(3, "0")}`;
    const raster = object(result.final_state?.[key], `temporal finish output ${index}`);
    if (raster.schema !== "axm.precision-raster/v1") throw new Error(`temporal finish output ${index} has wrong schema`);
    rasters.push(raster);
  }
  return rasters;
}

export async function finishTemporalPpms(root, ppmFrames, options = {}) {
  if (!Array.isArray(ppmFrames) || ppmFrames.length < 2 || ppmFrames.length > MAX_SEQUENCE_FRAMES) {
    throw new Error(`temporal finishing requires 2..${MAX_SEQUENCE_FRAMES} PPM frames`);
  }

  let width = null;
  let height = null;
  let rgbaBytes = 0;
  const inputHashes = [];
  for (let index = 0; index < ppmFrames.length; index += 1) {
    const bytes = Buffer.isBuffer(ppmFrames[index]) ? ppmFrames[index] : Buffer.from(ppmFrames[index]);
    const parsed = parsePpmRgb8(bytes);
    if (width === null) {
      width = parsed.width;
      height = parsed.height;
    } else if (parsed.width !== width || parsed.height !== height) {
      throw new Error(`temporal finish frame ${index} dimensions do not match the first frame`);
    }
    rgbaBytes += parsed.width * parsed.height * 4;
    inputHashes.push(sha256(bytes));
  }
  if (rgbaBytes > MAX_TOTAL_RGBA_BYTES) throw new Error("temporal finishing sequence exceeds bounded in-memory raster budget");

  const rootPath = resolve(root);
  const entryPath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const entry = await digestFile(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands;
  const flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function" || typeof hands.get !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeHands service");
  }
  if (!flow || typeof flow.summary !== "function" || typeof flow.run !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeFlow service");
  }
  const descriptor = hands.get(FRAME_FINISH_HAND);
  if (!descriptor || descriptor.state !== "EXECUTABLE") throw new Error(`Universal Creation donor does not expose ${FRAME_FINISH_HAND}`);

  const rasters = ppmFrames.map((bytes) => ppmToPrecisionRaster(bytes));
  const request = buildTemporalFinishRequest(rasters, options);
  const first = flow.run(request);
  const firstRasters = validateResult(first, rasters.length);
  const second = flow.run(request);
  const secondRasters = validateResult(second, rasters.length);
  const outputPpms = firstRasters.map((raster) => precisionRasterToPpm(raster));
  const repeatedPpms = secondRasters.map((raster) => precisionRasterToPpm(raster));

  if (first.digest !== second.digest) throw new Error("temporal finish Creative Flow digest did not repeat");
  for (let index = 0; index < outputPpms.length; index += 1) {
    if (firstRasters[index].digest !== secondRasters[index].digest || !outputPpms[index].equals(repeatedPpms[index])) {
      throw new Error(`temporal finish output ${index} repeat verification failed`);
    }
  }

  const audit = object(hands.audit(), "creative hands audit");
  const recipes = object(hands.recipeRegistry(), "creative recipe registry");
  const flowSummary = object(flow.summary(), "creative flow summary");
  const outputHashes = outputPpms.map((bytes) => sha256(bytes));
  const changedFrames = outputHashes.filter((hash, index) => hash !== inputHashes[index]).length;
  const maxWindow = boundedInt(options.maxWindow ?? 3, "maxWindow", 1, 8);
  const decay = boundedDecay(options.decay ?? 0.65);

  return {
    outputPpms,
    observation: {
      schema: "axm.creative-render.temporal-frame-finish-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      creative_hands_version: String(hands.version ?? "unknown"),
      hand_count: audit.total,
      hand_audit_digest: audit.digest ?? null,
      recipe_count: recipes.count,
      recipe_registry_digest: recipes.digest ?? null,
      creative_flow_version: String(flow.version ?? "unknown"),
      creative_flow_summary_digest: flowSummary.digest ?? null,
      finishing_hand_id: FRAME_FINISH_HAND,
      finishing_hand_digest: descriptor.digest ?? null,
      flow_digest: first.digest ?? null,
      flow_receipts: first.receipts,
      operation_ids: first.receipts.map((row) => row.operation_id ?? null),
      frame_count: ppmFrames.length,
      width,
      height,
      total_rgba_bytes: rgbaBytes,
      max_window: maxWindow,
      decay,
      changed_frame_count: changedFrames,
      input_ppm_sha256: inputHashes,
      output_ppm_sha256: outputHashes,
      repeat_verification: "PASS",
      truth_boundary: {
        proves: [
          "the exact rendered PPM sequence can be converted into Universal Creation precision-raster state",
          "the public Creative Flow can invoke the executable frame-finish motion-trail Hand over bounded progressive frame windows",
          "the same explicit sequence and policy repeat to identical output raster and PPM bytes in the exercised environment",
        ],
        does_not_prove: [
          "optical flow or semantic motion understanding",
          "camera solve or object tracking",
          "continuous-time interpolation between sparse frames",
          "visual or artistic quality",
          "cross-machine bitwise identity outside the named runtime boundaries",
        ],
      },
    },
  };
}
