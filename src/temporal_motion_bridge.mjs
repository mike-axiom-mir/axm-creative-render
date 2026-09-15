import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePpmRgb8, ppmToPrecisionRaster, precisionRasterToPpm } from "./post_render_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

const MAX_SEQUENCE_FRAMES = 16;
const MAX_TOTAL_RGBA_BYTES = 32 * 1024 * 1024;
const MAX_TRACK_WORK = 32_000_000;
const TRACK_HAND = "creative.frame-finish.block-match-track";
const STABILIZE_HAND = "creative.frame-finish.stabilize-translation";
const DIFFERENCE_HAND = "creative.frame-finish.difference-frame";
const TRAIL_HAND = "creative.frame-finish.motion-trail";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
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

function normalizeControls(policy = {}) {
  return {
    searchRadius: boundedInt(policy.searchRadius ?? 16, "searchRadius", 0, 64),
    trailWindow: boundedInt(policy.trailWindow ?? 3, "trailWindow", 1, 8),
    decay: boundedDecay(policy.decay ?? 0.65),
  };
}

function normalizeRegion(width, height, region, searchRadius) {
  region = object(region, "tracking region");
  const normalized = {
    x: boundedInt(region.x, "region x", 0, width - 2),
    y: boundedInt(region.y, "region y", 0, height - 2),
    width: boundedInt(region.width, "region width", 2, width),
    height: boundedInt(region.height, "region height", 2, height),
  };
  if (normalized.x + normalized.width > width || normalized.y + normalized.height > height) throw new Error("tracking region must remain inside the frame");
  const work = normalized.width * normalized.height * ((searchRadius * 2 + 1) ** 2);
  if (work > MAX_TRACK_WORK) throw new Error("tracking policy exceeds Universal Creation block-match work budget");
  return { ...normalized, work };
}

function pixelOffset(width, x, y) {
  return (y * width + x) * 3;
}

function edgeEnergy(rgb, frameWidth, x0, y0, width, height) {
  let score = 0;
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      const current = pixelOffset(frameWidth, x, y);
      if (x + 1 < x0 + width) {
        const right = current + 3;
        score += Math.abs(rgb[current] - rgb[right]);
        score += Math.abs(rgb[current + 1] - rgb[right + 1]);
        score += Math.abs(rgb[current + 2] - rgb[right + 2]);
      }
      if (y + 1 < y0 + height) {
        const down = current + frameWidth * 3;
        score += Math.abs(rgb[current] - rgb[down]);
        score += Math.abs(rgb[current + 1] - rgb[down + 1]);
        score += Math.abs(rgb[current + 2] - rgb[down + 2]);
      }
    }
  }
  return score;
}

export function chooseTrackingRegion(ppmBytes, searchRadius = 16) {
  const parsed = parsePpmRgb8(ppmBytes);
  const radius = boundedInt(searchRadius, "searchRadius", 0, 64);
  const availableWidth = parsed.width - radius * 2;
  const availableHeight = parsed.height - radius * 2;
  if (availableWidth < 12 || availableHeight < 12) throw new Error("frame is too small for the requested tracking radius");

  const tileWidth = clamp(Math.floor(parsed.width / 6), 16, Math.min(56, availableWidth));
  const tileHeight = clamp(Math.floor(parsed.height / 5), 16, Math.min(40, availableHeight));
  const xMin = radius;
  const yMin = radius;
  const xMax = parsed.width - radius - tileWidth;
  const yMax = parsed.height - radius - tileHeight;
  const stride = Math.max(2, Math.floor(Math.min(tileWidth, tileHeight) / 4));
  let best = null;
  let candidates = 0;

  const xs = [];
  const ys = [];
  for (let x = xMin; x <= xMax; x += stride) xs.push(x);
  for (let y = yMin; y <= yMax; y += stride) ys.push(y);
  if (xs.at(-1) !== xMax) xs.push(xMax);
  if (ys.at(-1) !== yMax) ys.push(yMax);

  for (const y of ys) {
    for (const x of xs) {
      const score = edgeEnergy(parsed.rgb, parsed.width, x, y, tileWidth, tileHeight);
      candidates += 1;
      if (best === null || score > best.score) best = { x, y, width: tileWidth, height: tileHeight, score };
    }
  }
  if (!best || best.score <= 0) throw new Error("no spatially distinctive tracking region was found in the reference frame");
  const work = best.width * best.height * ((radius * 2 + 1) ** 2);
  if (work > MAX_TRACK_WORK) throw new Error("selected tracking region exceeds Universal Creation block-match work budget");
  return {
    region: { x: best.x, y: best.y, width: best.width, height: best.height },
    selection: {
      method: "max-local-rgb-edge-energy/v1",
      score: best.score,
      candidate_count: candidates,
      stride,
      search_margin: radius,
      work,
    },
  };
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function progressiveAlignedRefs(index, trailWindow) {
  const refs = [];
  const start = Math.max(0, index - trailWindow + 1);
  for (let source = start; source <= index; source += 1) {
    refs.push(source === 0 ? { $state: "frames.0" } : { $state: `stable_${String(source).padStart(3, "0")}` });
  }
  return refs;
}

export function buildTemporalMotionRequest(rasters, policy = {}) {
  if (!Array.isArray(rasters) || rasters.length < 2 || rasters.length > MAX_SEQUENCE_FRAMES) {
    throw new Error(`temporal motion requires 2..${MAX_SEQUENCE_FRAMES} raster frames`);
  }
  const first = object(rasters[0], "first raster");
  const width = boundedInt(first.width, "first raster width", 2, 16384);
  const height = boundedInt(first.height, "first raster height", 2, 16384);
  const controls = normalizeControls(policy);
  const sourceRegion = policy.region ?? {
    x: Math.floor(width * 0.34),
    y: Math.floor(height * 0.39),
    width: Math.max(2, Math.floor(width * 0.25)),
    height: Math.max(2, Math.floor(height * 0.22)),
  };
  const region = normalizeRegion(width, height, sourceRegion, controls.searchRadius);
  const normalized = {
    region: { x: region.x, y: region.y, width: region.width, height: region.height },
    searchRadius: controls.searchRadius,
    trailWindow: controls.trailWindow,
    decay: controls.decay,
    work: region.work,
  };
  const steps = [
    {
      id: "trail-000",
      hand_id: TRAIL_HAND,
      args: { frames: [{ $state: "frames.0" }], spec: { decay: normalized.decay } },
      save_as: "finished_000",
    },
  ];
  for (let index = 1; index < rasters.length; index += 1) {
    const suffix = String(index).padStart(3, "0");
    steps.push(
      {
        id: `track-${suffix}`,
        hand_id: TRACK_HAND,
        args: {
          reference: { $state: "frames.0" },
          current: { $state: `frames.${index}` },
          spec: { ...normalized.region, search_radius: normalized.searchRadius },
        },
        save_as: `track_${suffix}`,
      },
      {
        id: `stabilize-${suffix}`,
        hand_id: STABILIZE_HAND,
        args: { image: { $state: `frames.${index}` }, track: { $state: `track_${suffix}` } },
        save_as: `stable_${suffix}`,
      },
      {
        id: `difference-${suffix}`,
        hand_id: DIFFERENCE_HAND,
        args: { a: { $state: "frames.0" }, b: { $state: `stable_${suffix}` } },
        save_as: `difference_${suffix}`,
      },
      {
        id: `trail-${suffix}`,
        hand_id: TRAIL_HAND,
        args: { frames: progressiveAlignedRefs(index, normalized.trailWindow), spec: { decay: normalized.decay } },
        save_as: `finished_${suffix}`,
      },
    );
  }
  return {
    mode: "execute",
    goal: "infer bounded image translation from rendered frames, stabilize against the first frame, preserve residual difference evidence, then apply sequence-aware finishing",
    state: { frames: rasters },
    steps,
    policy: normalized,
  };
}

function validateFlowResult(result, frameCount) {
  object(result, "temporal motion Creative Flow result");
  const expected = 1 + (frameCount - 1) * 4;
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) {
    throw new Error(`temporal motion Creative Flow did not pass cleanly: ${String(result.status)}`);
  }
  if (!Array.isArray(result.receipts) || result.receipts.length !== expected) throw new Error("temporal motion receipt count drifted");
  const tracks = [];
  const stabilized = [];
  const differences = [];
  const finished = [];
  for (let index = 0; index < frameCount; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const finish = object(result.final_state?.[`finished_${suffix}`], `finished raster ${index}`);
    if (finish.schema !== "axm.precision-raster/v1") throw new Error(`finished raster ${index} has wrong schema`);
    finished.push(finish);
    if (index === 0) {
      stabilized.push(result.final_state.frames[0]);
      differences.push(null);
      tracks.push(null);
      continue;
    }
    const track = object(result.final_state?.[`track_${suffix}`], `track ${index}`);
    if (track.schema !== "axm.precision-frame-track/v1") throw new Error(`track ${index} has wrong schema`);
    const stable = object(result.final_state?.[`stable_${suffix}`], `stabilized raster ${index}`);
    const difference = object(result.final_state?.[`difference_${suffix}`], `difference raster ${index}`);
    if (stable.schema !== "axm.precision-raster/v1" || difference.schema !== "axm.precision-raster/v1") throw new Error(`temporal motion raster schema drifted at ${index}`);
    tracks.push(track);
    stabilized.push(stable);
    differences.push(difference);
  }
  return { tracks, stabilized, differences, finished };
}

function regionMse(referencePpm, candidatePpm, region) {
  const a = parsePpmRgb8(referencePpm);
  const b = parsePpmRgb8(candidatePpm);
  if (a.width !== b.width || a.height !== b.height) throw new Error("MSE frames must have equal dimensions");
  let sum = 0;
  let samples = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const base = (y * a.width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = a.rgb[base + channel] - b.rgb[base + channel];
        sum += delta * delta;
        samples += 1;
      }
    }
  }
  return samples ? sum / samples : 0;
}

export async function analyzeAndFinishTemporalPpms(root, ppmFrames, policy = {}) {
  if (!Array.isArray(ppmFrames) || ppmFrames.length < 2 || ppmFrames.length > MAX_SEQUENCE_FRAMES) {
    throw new Error(`temporal motion requires 2..${MAX_SEQUENCE_FRAMES} PPM frames`);
  }
  const parsed = ppmFrames.map((bytes, index) => {
    const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const row = parsePpmRgb8(value);
    return { bytes: value, ...row, index };
  });
  const width = parsed[0].width;
  const height = parsed[0].height;
  let rgbaBytes = 0;
  for (const row of parsed) {
    if (row.width !== width || row.height !== height) throw new Error(`temporal motion frame ${row.index} dimensions do not match the first frame`);
    rgbaBytes += row.width * row.height * 4;
  }
  if (rgbaBytes > MAX_TOTAL_RGBA_BYTES) throw new Error("temporal motion sequence exceeds bounded in-memory raster budget");

  const controls = normalizeControls(policy);
  const selected = policy.region
    ? { region: normalizeRegion(width, height, policy.region, controls.searchRadius), selection: { method: "caller-explicit/v1" } }
    : chooseTrackingRegion(parsed[0].bytes, controls.searchRadius);
  const requestPolicy = {
    ...controls,
    region: {
      x: selected.region.x,
      y: selected.region.y,
      width: selected.region.width,
      height: selected.region.height,
    },
  };

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
  if (!flow || typeof flow.summary !== "function" || typeof flow.run !== "function") throw new Error("Universal Creation donor does not expose the expected creativeFlow service");
  for (const id of [TRACK_HAND, STABILIZE_HAND, DIFFERENCE_HAND, TRAIL_HAND]) {
    const descriptor = hands.get(id);
    if (!descriptor || descriptor.state !== "EXECUTABLE") throw new Error(`Universal Creation donor does not expose executable ${id}`);
  }

  const rasters = parsed.map((row) => ppmToPrecisionRaster(row.bytes));
  const request = buildTemporalMotionRequest(rasters, requestPolicy);
  const first = flow.run(request);
  const firstState = validateFlowResult(first, rasters.length);
  const second = flow.run(request);
  const secondState = validateFlowResult(second, rasters.length);
  if (first.digest !== second.digest) throw new Error("temporal motion Creative Flow digest did not repeat");

  const outputPpms = [];
  const stabilizationPpms = [];
  const differencePpms = [];
  const motion = [];
  for (let index = 0; index < rasters.length; index += 1) {
    const finishedA = precisionRasterToPpm(firstState.finished[index]);
    const finishedB = precisionRasterToPpm(secondState.finished[index]);
    if (firstState.finished[index].digest !== secondState.finished[index].digest || !finishedA.equals(finishedB)) throw new Error(`finished frame ${index} did not repeat exactly`);
    outputPpms.push(finishedA);

    const stableA = precisionRasterToPpm(firstState.stabilized[index]);
    const stableB = precisionRasterToPpm(secondState.stabilized[index]);
    if (firstState.stabilized[index].digest !== secondState.stabilized[index].digest || !stableA.equals(stableB)) throw new Error(`stabilized frame ${index} did not repeat exactly`);
    stabilizationPpms.push(stableA);

    if (index === 0) {
      differencePpms.push(null);
      motion.push({ index, reference: true, dx: 0, dy: 0, tracker_mse: 0, pre_region_mse: 0, post_region_mse: 0, improved_or_equal: true });
      continue;
    }

    const trackA = firstState.tracks[index];
    const trackB = secondState.tracks[index];
    if (trackA.digest !== trackB.digest || trackA.dx !== trackB.dx || trackA.dy !== trackB.dy || trackA.mse !== trackB.mse) throw new Error(`track ${index} did not repeat exactly`);
    const diffA = precisionRasterToPpm(firstState.differences[index]);
    const diffB = precisionRasterToPpm(secondState.differences[index]);
    if (firstState.differences[index].digest !== secondState.differences[index].digest || !diffA.equals(diffB)) throw new Error(`difference frame ${index} did not repeat exactly`);
    differencePpms.push(diffA);
    const pre = regionMse(parsed[0].bytes, parsed[index].bytes, request.policy.region);
    const post = regionMse(parsed[0].bytes, stableA, request.policy.region);
    motion.push({
      index,
      reference: false,
      dx: trackA.dx,
      dy: trackA.dy,
      tracker_mse: trackA.mse,
      track_digest: trackA.digest,
      pre_region_mse: pre,
      post_region_mse: post,
      improved_or_equal: post <= pre,
    });
  }

  const audit = object(hands.audit(), "creative hands audit");
  const recipes = object(hands.recipeRegistry(), "creative recipe registry");
  const flowSummary = object(flow.summary(), "creative flow summary");
  const nonzeroTracks = motion.slice(1).filter((row) => row.dx !== 0 || row.dy !== 0).length;
  const improvedTracks = motion.slice(1).filter((row) => row.post_region_mse < row.pre_region_mse).length;

  return {
    outputPpms,
    stabilizationPpms,
    differencePpms,
    observation: {
      schema: "axm.creative-render.temporal-motion-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      creative_hands_version: String(hands.version ?? "unknown"),
      hand_count: audit.total,
      hand_audit_digest: audit.digest ?? null,
      recipe_count: recipes.count,
      recipe_registry_digest: recipes.digest ?? null,
      creative_flow_version: String(flow.version ?? "unknown"),
      creative_flow_summary_digest: flowSummary.digest ?? null,
      flow_digest: first.digest ?? null,
      operation_ids: first.receipts.map((row) => row.operation_id ?? null),
      frame_count: ppmFrames.length,
      width,
      height,
      total_rgba_bytes: rgbaBytes,
      policy: request.policy,
      region_selection: {
        ...selected.selection,
        region: request.policy.region,
      },
      motion,
      nonzero_track_count: nonzeroTracks,
      strictly_improved_track_count: improvedTracks,
      input_ppm_sha256: parsed.map((row) => sha256(row.bytes)),
      stabilized_ppm_sha256: stabilizationPpms.map((bytes) => sha256(bytes)),
      output_ppm_sha256: outputPpms.map((bytes) => sha256(bytes)),
      repeat_verification: "PASS",
      truth_boundary: {
        proves: [
          "the tracking region was deterministically selected from explicit reference-frame edge evidence unless a caller supplied one",
          "Universal Creation block-match tracking executes over that caller-bounded region on exact rendered frames",
          "the resulting track receipts bind exact reference/current raster digests and can drive Universal Creation translation stabilization",
          "stabilized frames, residual difference frames and aligned motion-trail outputs repeat exactly under the same input and policy",
          "region MSE before/after stabilization is measured explicitly by the bridge without claiming semantic correctness",
        ],
        does_not_prove: [
          "optical flow, feature tracking, perspective or camera solving",
          "semantic object identity or occlusion reasoning",
          "rotation/scale stabilization beyond the exercised translation Hand",
          "continuous-time interpolation between samples",
          "visual or cinematic quality",
        ],
      },
    },
  };
}
