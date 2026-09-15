import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePpmRgb8, ppmToPrecisionRaster, precisionRasterToPpm } from "./post_render_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

const MAX_SEQUENCE_FRAMES = 12;
const MAX_TOTAL_RGBA_BYTES = 32 * 1024 * 1024;
const MAX_TRACK_WORK_PER_HAND = 32_000_000;
const MAX_TOTAL_TRACK_WORK = 64_000_000;
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

function controls(policy = {}) {
  const regionCount = boundedInt(policy.regionCount ?? 3, "regionCount", 3, 5);
  if (regionCount % 2 === 0) throw new Error("regionCount must be odd so consensus median is one observed integer coordinate");
  return {
    regionCount,
    searchRadius: boundedInt(policy.searchRadius ?? 16, "searchRadius", 0, 64),
    maxAxisSpread: boundedInt(policy.maxAxisSpread ?? 4, "maxAxisSpread", 0, 32),
    trailWindow: boundedInt(policy.trailWindow ?? 3, "trailWindow", 1, 8),
    decay: boundedDecay(policy.decay ?? 0.65),
  };
}

function offset(width, x, y) {
  return (y * width + x) * 3;
}

function edgeEnergy(rgb, frameWidth, x0, y0, width, height) {
  let score = 0;
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      const current = offset(frameWidth, x, y);
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

function intersectionArea(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function sufficientlyDistinct(candidate, selected) {
  for (const prior of selected) {
    const overlap = intersectionArea(candidate, prior);
    const smallerArea = Math.min(candidate.width * candidate.height, prior.width * prior.height);
    if (smallerArea > 0 && overlap / smallerArea > 0.25) return false;
  }
  return true;
}

export function chooseConsensusTrackingRegions(ppmBytes, policy = {}) {
  const parsed = parsePpmRgb8(ppmBytes);
  const c = controls(policy);
  const availableWidth = parsed.width - c.searchRadius * 2;
  const availableHeight = parsed.height - c.searchRadius * 2;
  if (availableWidth < 18 || availableHeight < 18) throw new Error("frame is too small for the requested consensus tracking radius");

  const tileWidth = clamp(Math.floor(parsed.width / 8), 18, Math.min(44, availableWidth));
  const tileHeight = clamp(Math.floor(parsed.height / 6), 18, Math.min(32, availableHeight));
  const xMin = c.searchRadius;
  const yMin = c.searchRadius;
  const xMax = parsed.width - c.searchRadius - tileWidth;
  const yMax = parsed.height - c.searchRadius - tileHeight;
  const stride = Math.max(2, Math.floor(Math.min(tileWidth, tileHeight) / 4));
  const xs = [], ys = [];
  for (let x = xMin; x <= xMax; x += stride) xs.push(x);
  for (let y = yMin; y <= yMax; y += stride) ys.push(y);
  if (xs.at(-1) !== xMax) xs.push(xMax);
  if (ys.at(-1) !== yMax) ys.push(yMax);

  const candidates = [];
  for (const y of ys) {
    for (const x of xs) {
      const score = edgeEnergy(parsed.rgb, parsed.width, x, y, tileWidth, tileHeight);
      if (score > 0) candidates.push({ x, y, width: tileWidth, height: tileHeight, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const selected = [];
  for (const candidate of candidates) {
    if (!sufficientlyDistinct(candidate, selected)) continue;
    selected.push(candidate);
    if (selected.length === c.regionCount) break;
  }
  if (selected.length !== c.regionCount) throw new Error(`could not find ${c.regionCount} spatially distinct evidence-rich tracking regions`);

  const perRegionWork = tileWidth * tileHeight * ((c.searchRadius * 2 + 1) ** 2);
  if (perRegionWork > MAX_TRACK_WORK_PER_HAND) throw new Error("selected consensus region exceeds Universal Creation block-match work budget");
  return {
    regions: selected.map(({ x, y, width, height }, index) => ({ id: `region-${String(index).padStart(2, "0")}`, x, y, width, height })),
    selection: {
      method: "diverse-local-rgb-edge-energy/v1",
      scores: selected.map((row) => row.score),
      candidate_count: candidates.length,
      stride,
      overlap_fraction_limit: 0.25,
      search_margin: c.searchRadius,
      per_region_work: perRegionWork,
    },
  };
}

function lowerMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function summarizeTrackConsensus(tracks, maxAxisSpread = 4) {
  if (!Array.isArray(tracks) || tracks.length < 3 || tracks.length > 5 || tracks.length % 2 === 0) throw new Error("consensus requires 3 or 5 observed tracks");
  tracks.forEach((track, index) => {
    object(track, `track ${index}`);
    if (track.schema !== "axm.precision-frame-track/v1") throw new Error(`track ${index} has wrong schema`);
  });
  const threshold = boundedInt(maxAxisSpread, "maxAxisSpread", 0, 32);
  const medianDx = lowerMedian(tracks.map((track) => track.dx));
  const medianDy = lowerMedian(tracks.map((track) => track.dy));
  const minDx = Math.min(...tracks.map((track) => track.dx)), maxDx = Math.max(...tracks.map((track) => track.dx));
  const minDy = Math.min(...tracks.map((track) => track.dy)), maxDy = Math.max(...tracks.map((track) => track.dy));
  const spreadDx = maxDx - minDx, spreadDy = maxDy - minDy;
  const ranked = tracks.map((track, index) => ({
    index,
    track,
    distance: Math.abs(track.dx - medianDx) + Math.abs(track.dy - medianDy),
    mse: Number(track.mse),
  })).sort((a, b) => a.distance - b.distance || a.mse - b.mse || a.index - b.index);
  const representative = ranked[0];
  return {
    median_dx: medianDx,
    median_dy: medianDy,
    spread_dx: spreadDx,
    spread_dy: spreadDy,
    max_axis_spread: threshold,
    agreement: spreadDx <= threshold && spreadDy <= threshold,
    representative_index: representative.index,
    representative_track: representative.track,
    representative_distance: representative.distance,
  };
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function buildTrackRequest(rasters, regions, searchRadius) {
  const steps = [];
  for (let frame = 1; frame < rasters.length; frame += 1) {
    const fs = String(frame).padStart(3, "0");
    for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
      const rs = String(regionIndex).padStart(2, "0");
      const region = regions[regionIndex];
      steps.push({
        id: `track-${fs}-${rs}`,
        hand_id: TRACK_HAND,
        args: {
          reference: { $state: "frames.0" },
          current: { $state: `frames.${frame}` },
          spec: { x: region.x, y: region.y, width: region.width, height: region.height, search_radius: searchRadius },
        },
        save_as: `track_${fs}_${rs}`,
      });
    }
  }
  return {
    mode: "execute",
    goal: "measure the same rendered translation from several independently selected spatial evidence regions",
    state: { frames: rasters },
    steps,
  };
}

function validateTrackFlow(result, frameCount, regionCount) {
  object(result, "consensus track Creative Flow result");
  const expected = (frameCount - 1) * regionCount;
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) throw new Error(`consensus track flow did not pass cleanly: ${String(result.status)}`);
  if (!Array.isArray(result.receipts) || result.receipts.length !== expected) throw new Error("consensus track receipt count drifted");
  const byFrame = [null];
  for (let frame = 1; frame < frameCount; frame += 1) {
    const fs = String(frame).padStart(3, "0");
    const tracks = [];
    for (let regionIndex = 0; regionIndex < regionCount; regionIndex += 1) {
      const rs = String(regionIndex).padStart(2, "0");
      const track = object(result.final_state?.[`track_${fs}_${rs}`], `track frame ${frame} region ${regionIndex}`);
      if (track.schema !== "axm.precision-frame-track/v1") throw new Error(`track frame ${frame} region ${regionIndex} has wrong schema`);
      tracks.push(track);
    }
    byFrame.push(tracks);
  }
  return byFrame;
}

function progressiveAlignedRefs(index, trailWindow) {
  const refs = [];
  const start = Math.max(0, index - trailWindow + 1);
  for (let source = start; source <= index; source += 1) refs.push(source === 0 ? { $state: "frames.0" } : { $state: `stable_${String(source).padStart(3, "0")}` });
  return refs;
}

function buildPostRequest(rasters, representatives, trailWindow, decay) {
  const steps = [{
    id: "trail-000",
    hand_id: TRAIL_HAND,
    args: { frames: [{ $state: "frames.0" }], spec: { decay } },
    save_as: "finished_000",
  }];
  for (let frame = 1; frame < rasters.length; frame += 1) {
    const fs = String(frame).padStart(3, "0");
    steps.push(
      {
        id: `stabilize-${fs}`,
        hand_id: STABILIZE_HAND,
        args: { image: { $state: `frames.${frame}` }, track: { $state: `representatives.${frame}` } },
        save_as: `stable_${fs}`,
      },
      {
        id: `difference-${fs}`,
        hand_id: DIFFERENCE_HAND,
        args: { a: { $state: "frames.0" }, b: { $state: `stable_${fs}` } },
        save_as: `difference_${fs}`,
      },
      {
        id: `trail-${fs}`,
        hand_id: TRAIL_HAND,
        args: { frames: progressiveAlignedRefs(frame, trailWindow), spec: { decay } },
        save_as: `finished_${fs}`,
      },
    );
  }
  return {
    mode: "execute",
    goal: "use one real Universal Creation track receipt nearest the multi-region median consensus to stabilize and finish each rendered frame",
    state: { frames: rasters, representatives },
    steps,
  };
}

function validatePostFlow(result, frameCount) {
  object(result, "consensus post Creative Flow result");
  const expected = 1 + (frameCount - 1) * 3;
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) throw new Error(`consensus post flow did not pass cleanly: ${String(result.status)}`);
  if (!Array.isArray(result.receipts) || result.receipts.length !== expected) throw new Error("consensus post receipt count drifted");
  const stabilized = [], differences = [], finished = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const fs = String(frame).padStart(3, "0");
    const finish = object(result.final_state?.[`finished_${fs}`], `finished raster ${frame}`);
    if (finish.schema !== "axm.precision-raster/v1") throw new Error(`finished raster ${frame} has wrong schema`);
    finished.push(finish);
    if (frame === 0) {
      stabilized.push(result.final_state.frames[0]);
      differences.push(null);
    } else {
      const stable = object(result.final_state?.[`stable_${fs}`], `stabilized raster ${frame}`);
      const difference = object(result.final_state?.[`difference_${fs}`], `difference raster ${frame}`);
      if (stable.schema !== "axm.precision-raster/v1" || difference.schema !== "axm.precision-raster/v1") throw new Error(`consensus post raster schema drifted at ${frame}`);
      stabilized.push(stable);
      differences.push(difference);
    }
  }
  return { stabilized, differences, finished };
}

function regionMse(referencePpm, candidatePpm, region) {
  const a = parsePpmRgb8(referencePpm), b = parsePpmRgb8(candidatePpm);
  if (a.width !== b.width || a.height !== b.height) throw new Error("MSE frames must have equal dimensions");
  let sum = 0, samples = 0;
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

function runOnePass(flow, rasters, regions, c) {
  const trackFlow = flow.run(buildTrackRequest(rasters, regions, c.searchRadius));
  const tracksByFrame = validateTrackFlow(trackFlow, rasters.length, regions.length);
  const consensusByFrame = [null];
  const representatives = [null];
  for (let frame = 1; frame < rasters.length; frame += 1) {
    const consensus = summarizeTrackConsensus(tracksByFrame[frame], c.maxAxisSpread);
    if (!consensus.agreement) throw new Error(`multi-region track disagreement at frame ${frame}: spread dx=${consensus.spread_dx}, dy=${consensus.spread_dy}`);
    consensusByFrame.push(consensus);
    representatives.push(consensus.representative_track);
  }
  const postFlow = flow.run(buildPostRequest(rasters, representatives, c.trailWindow, c.decay));
  const post = validatePostFlow(postFlow, rasters.length);
  return { trackFlow, tracksByFrame, consensusByFrame, representatives, postFlow, post };
}

export async function analyzeConsensusTemporalPpms(root, ppmFrames, policy = {}) {
  if (!Array.isArray(ppmFrames) || ppmFrames.length < 2 || ppmFrames.length > MAX_SEQUENCE_FRAMES) throw new Error(`temporal consensus requires 2..${MAX_SEQUENCE_FRAMES} PPM frames`);
  const parsed = ppmFrames.map((bytes, index) => {
    const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return { index, bytes: value, ...parsePpmRgb8(value) };
  });
  const width = parsed[0].width, height = parsed[0].height;
  let rgbaBytes = 0;
  for (const row of parsed) {
    if (row.width !== width || row.height !== height) throw new Error(`temporal consensus frame ${row.index} dimensions do not match the first frame`);
    rgbaBytes += row.width * row.height * 4;
  }
  if (rgbaBytes > MAX_TOTAL_RGBA_BYTES) throw new Error("temporal consensus sequence exceeds bounded in-memory raster budget");
  const c = controls(policy);
  const selected = chooseConsensusTrackingRegions(parsed[0].bytes, c);
  const totalTrackWork = selected.selection.per_region_work * c.regionCount * (parsed.length - 1);
  if (totalTrackWork > MAX_TOTAL_TRACK_WORK) throw new Error("temporal consensus total modeled tracking work exceeds bridge budget");

  const rootPath = resolve(root);
  const entryPath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const entry = await digestFile(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands, flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function" || typeof hands.get !== "function") throw new Error("Universal Creation donor does not expose the expected creativeHands service");
  if (!flow || typeof flow.summary !== "function" || typeof flow.run !== "function") throw new Error("Universal Creation donor does not expose the expected creativeFlow service");
  for (const id of [TRACK_HAND, STABILIZE_HAND, DIFFERENCE_HAND, TRAIL_HAND]) {
    const descriptor = hands.get(id);
    if (!descriptor || descriptor.state !== "EXECUTABLE") throw new Error(`Universal Creation donor does not expose executable ${id}`);
  }

  const rasters = parsed.map((row) => ppmToPrecisionRaster(row.bytes));
  const first = runOnePass(flow, rasters, selected.regions, c);
  const second = runOnePass(flow, rasters, selected.regions, c);
  if (first.trackFlow.digest !== second.trackFlow.digest || first.postFlow.digest !== second.postFlow.digest) throw new Error("temporal consensus Creative Flow digests did not repeat");

  const stabilizedPpms = [], differencePpms = [], outputPpms = [], motion = [];
  for (let frame = 0; frame < rasters.length; frame += 1) {
    const stableA = precisionRasterToPpm(first.post.stabilized[frame]), stableB = precisionRasterToPpm(second.post.stabilized[frame]);
    const finishedA = precisionRasterToPpm(first.post.finished[frame]), finishedB = precisionRasterToPpm(second.post.finished[frame]);
    if (first.post.stabilized[frame].digest !== second.post.stabilized[frame].digest || !stableA.equals(stableB)) throw new Error(`consensus stabilized frame ${frame} did not repeat exactly`);
    if (first.post.finished[frame].digest !== second.post.finished[frame].digest || !finishedA.equals(finishedB)) throw new Error(`consensus finished frame ${frame} did not repeat exactly`);
    stabilizedPpms.push(stableA); outputPpms.push(finishedA);
    if (frame === 0) {
      differencePpms.push(null);
      motion.push({ index: 0, reference: true, consensus_dx: 0, consensus_dy: 0, agreement: true, representative_region_index: null, pre_mean_region_mse: 0, post_mean_region_mse: 0 });
      continue;
    }
    const diffA = precisionRasterToPpm(first.post.differences[frame]), diffB = precisionRasterToPpm(second.post.differences[frame]);
    if (first.post.differences[frame].digest !== second.post.differences[frame].digest || !diffA.equals(diffB)) throw new Error(`consensus difference frame ${frame} did not repeat exactly`);
    differencePpms.push(diffA);
    const firstTracks = first.tracksByFrame[frame], secondTracks = second.tracksByFrame[frame];
    for (let regionIndex = 0; regionIndex < firstTracks.length; regionIndex += 1) {
      const a = firstTracks[regionIndex], b = secondTracks[regionIndex];
      if (a.digest !== b.digest || a.dx !== b.dx || a.dy !== b.dy || a.mse !== b.mse) throw new Error(`consensus track frame ${frame} region ${regionIndex} did not repeat exactly`);
    }
    const consensusA = first.consensusByFrame[frame], consensusB = second.consensusByFrame[frame];
    if (consensusA.median_dx !== consensusB.median_dx || consensusA.median_dy !== consensusB.median_dy || consensusA.representative_track.digest !== consensusB.representative_track.digest) throw new Error(`consensus summary frame ${frame} did not repeat exactly`);
    const regionEvidence = selected.regions.map((region, regionIndex) => ({
      region_index: regionIndex,
      region,
      dx: firstTracks[regionIndex].dx,
      dy: firstTracks[regionIndex].dy,
      mse: firstTracks[regionIndex].mse,
      track_digest: firstTracks[regionIndex].digest,
      pre_region_mse: regionMse(parsed[0].bytes, parsed[frame].bytes, region),
      post_region_mse: regionMse(parsed[0].bytes, stableA, region),
    }));
    const preMean = regionEvidence.reduce((sum, row) => sum + row.pre_region_mse, 0) / regionEvidence.length;
    const postMean = regionEvidence.reduce((sum, row) => sum + row.post_region_mse, 0) / regionEvidence.length;
    motion.push({
      index: frame,
      reference: false,
      consensus_dx: consensusA.median_dx,
      consensus_dy: consensusA.median_dy,
      spread_dx: consensusA.spread_dx,
      spread_dy: consensusA.spread_dy,
      agreement: consensusA.agreement,
      representative_region_index: consensusA.representative_index,
      representative_track_digest: consensusA.representative_track.digest,
      representative_dx: consensusA.representative_track.dx,
      representative_dy: consensusA.representative_track.dy,
      region_tracks: regionEvidence,
      pre_mean_region_mse: preMean,
      post_mean_region_mse: postMean,
      mean_improved: postMean < preMean,
    });
  }

  const audit = object(hands.audit(), "creative hands audit"), recipes = object(hands.recipeRegistry(), "creative recipe registry"), summary = object(flow.summary(), "creative flow summary");
  return {
    stabilizedPpms,
    differencePpms,
    outputPpms,
    observation: {
      schema: "axm.creative-render.temporal-consensus-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      creative_hands_version: String(hands.version ?? "unknown"),
      hand_count: audit.total,
      hand_audit_digest: audit.digest ?? null,
      recipe_count: recipes.count,
      recipe_registry_digest: recipes.digest ?? null,
      creative_flow_version: String(flow.version ?? "unknown"),
      creative_flow_summary_digest: summary.digest ?? null,
      track_flow_digest: first.trackFlow.digest,
      post_flow_digest: first.postFlow.digest,
      track_operation_ids: first.trackFlow.receipts.map((row) => row.operation_id ?? null),
      post_operation_ids: first.postFlow.receipts.map((row) => row.operation_id ?? null),
      frame_count: parsed.length,
      width,
      height,
      total_rgba_bytes: rgbaBytes,
      policy: { ...c, total_modeled_track_work: totalTrackWork },
      region_selection: { ...selected.selection, regions: selected.regions },
      motion,
      agreement_frame_count: motion.slice(1).filter((row) => row.agreement).length,
      nonzero_consensus_frame_count: motion.slice(1).filter((row) => row.consensus_dx !== 0 || row.consensus_dy !== 0).length,
      mean_improved_frame_count: motion.slice(1).filter((row) => row.mean_improved).length,
      input_ppm_sha256: parsed.map((row) => sha256(row.bytes)),
      stabilized_ppm_sha256: stabilizedPpms.map((bytes) => sha256(bytes)),
      output_ppm_sha256: outputPpms.map((bytes) => sha256(bytes)),
      repeat_verification: "PASS",
      truth_boundary: {
        proves: [
          "several spatially distinct reference-frame regions are selected deterministically from local RGB edge evidence",
          "each region is tracked by the unchanged Universal Creation block-match Hand and every returned track remains separately receipt-bound",
          "median translation is used only as consensus evidence; stabilization uses the nearest real Universal Creation track receipt rather than a synthetic consensus receipt",
          "track disagreement fails closed above an explicit axis-spread threshold",
          "tracks, representative selection, stabilized frames, residual differences and finished PPM bytes repeat exactly under the same inputs and policy",
        ],
        does_not_prove: [
          "optical flow, semantic object tracking, camera solving or perspective reconstruction",
          "that median regional translation is globally correct under parallax or independently moving objects",
          "rotation or scale stabilization",
          "continuous-time interpolation or visual quality",
        ],
      },
    },
  };
}
