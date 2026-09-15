import { parsePpmRgb8 } from "./post_render_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import {
  executeElectricEffect,
  rasterizeElectricStateToPpm,
  compositeElectricRasterWithUniversalCreation,
} from "./vfx_frame_bridge.mjs";

const MAX_SEQUENCE_FRAMES = 16;
const MAX_TOTAL_RGB_BYTES = 64 * 1024 * 1024;

function boundedInteger(value, label, low, high) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < low || n > high) {
    throw new Error(`${label} must be an integer in ${low}..${high}`);
  }
  return n;
}

export function normalizeTemporalVfxPolicy(options = {}) {
  const baseSeed = boundedInteger(options.baseSeed ?? 20260915, "baseSeed", -2_000_000_000, 2_000_000_000);
  const seedStep = boundedInteger(options.seedStep ?? 1, "seedStep", -1_000_000, 1_000_000);
  return { base_seed: baseSeed, seed_step: seedStep };
}

function compareDonorInvariant(expected, current, frameIndex) {
  for (const key of Object.keys(expected)) {
    if (expected[key] !== current[key]) {
      throw new Error(`temporal VFX donor invariant ${key} drifted at frame ${frameIndex}`);
    }
  }
}

export async function applyTemporalVfxPpms(ucRoot, vfxRoot, ppmFrames, options = {}) {
  if (!Array.isArray(ppmFrames) || ppmFrames.length < 2 || ppmFrames.length > MAX_SEQUENCE_FRAMES) {
    throw new Error(`temporal VFX requires 2..${MAX_SEQUENCE_FRAMES} PPM frames`);
  }

  let width = null;
  let height = null;
  let totalRgbBytes = 0;
  const sources = [];
  for (let index = 0; index < ppmFrames.length; index += 1) {
    const bytes = Buffer.isBuffer(ppmFrames[index]) ? ppmFrames[index] : Buffer.from(ppmFrames[index]);
    const parsed = parsePpmRgb8(bytes);
    if (width === null) {
      width = parsed.width;
      height = parsed.height;
    } else if (parsed.width !== width || parsed.height !== height) {
      throw new Error(`temporal VFX frame ${index} dimensions do not match the first frame`);
    }
    totalRgbBytes += parsed.rgb.length;
    sources.push({ bytes, sha256: sha256(bytes) });
  }
  if (totalRgbBytes > MAX_TOTAL_RGB_BYTES) throw new Error("temporal VFX sequence exceeds bounded RGB working-set budget");

  const policy = normalizeTemporalVfxPolicy(options);
  const rows = [];
  const artifacts = [];
  const outputPpms = [];
  let donorInvariant = null;

  for (let index = 0; index < sources.length; index += 1) {
    const seed = policy.base_seed + index * policy.seed_step;
    if (!Number.isSafeInteger(seed) || seed < -2_000_000_000 || seed > 2_000_000_000) {
      throw new Error(`derived VFX seed for frame ${index} is outside the bounded range`);
    }

    const effectFirst = await executeElectricEffect(vfxRoot, seed);
    const effectSecond = await executeElectricEffect(vfxRoot, seed);
    if (
      effectFirst.observation.final_state_hash !== effectSecond.observation.final_state_hash ||
      !effectFirst.stateBytes.equals(effectSecond.stateBytes) ||
      !effectFirst.svgBytes.equals(effectSecond.svgBytes)
    ) {
      throw new Error(`temporal VFX effect source ${index} repeat verification failed`);
    }

    const rasterFirst = rasterizeElectricStateToPpm(effectFirst.stateBytes, width, height);
    const rasterSecond = rasterizeElectricStateToPpm(effectSecond.stateBytes, width, height);
    if (!rasterFirst.ppmBytes.equals(rasterSecond.ppmBytes)) {
      throw new Error(`temporal VFX effect raster ${index} repeat verification failed`);
    }

    const compositeFirst = await compositeElectricRasterWithUniversalCreation(ucRoot, sources[index].bytes, rasterFirst.ppmBytes);
    const compositeSecond = await compositeElectricRasterWithUniversalCreation(ucRoot, sources[index].bytes, rasterFirst.ppmBytes);
    if (
      compositeFirst.observation.flow_digest !== compositeSecond.observation.flow_digest ||
      !compositeFirst.outputPpm.equals(compositeSecond.outputPpm)
    ) {
      throw new Error(`temporal VFX composite ${index} repeat verification failed`);
    }

    const currentInvariant = {
      vfx_runtime_sha256: effectFirst.observation.runtime_sha256,
      vfx_effect_module_sha256: effectFirst.observation.effect_module_sha256,
      vfx_graph_id: effectFirst.observation.graph_id,
      vfx_graph_version: effectFirst.observation.graph_version,
      uc_entry_sha256: compositeFirst.observation.entry_sha256,
      uc_hand_count: compositeFirst.observation.hand_count,
      uc_recipe_count: compositeFirst.observation.recipe_count,
      uc_hands_version: compositeFirst.observation.creative_hands_version,
      uc_flow_version: compositeFirst.observation.creative_flow_version,
    };
    if (donorInvariant === null) donorInvariant = currentInvariant;
    else compareDonorInvariant(donorInvariant, currentInvariant, index);

    const outputSha = sha256(compositeFirst.outputPpm);
    const row = {
      index,
      seed,
      source_ppm_sha256: sources[index].sha256,
      vfx_final_state_hash: effectFirst.observation.final_state_hash,
      vfx_state_sha256: sha256(effectFirst.stateBytes),
      vfx_svg_sha256: sha256(effectFirst.svgBytes),
      effect_raster_sha256: sha256(rasterFirst.ppmBytes),
      effect_path_count: effectFirst.observation.path_count,
      effect_segment_count: rasterFirst.evidence.segment_count,
      uc_flow_digest: compositeFirst.observation.flow_digest,
      uc_operation_ids: compositeFirst.observation.operation_ids,
      composite_ppm_sha256: outputSha,
      changed_from_source: outputSha !== sources[index].sha256,
      repeat_verification: "PASS",
    };
    if (!row.changed_from_source) throw new Error(`temporal VFX composite ${index} did not change source frame bytes`);

    rows.push(row);
    artifacts.push({
      index,
      seed,
      stateBytes: effectFirst.stateBytes,
      svgBytes: effectFirst.svgBytes,
      effectPpmBytes: rasterFirst.ppmBytes,
      outputPpmBytes: compositeFirst.outputPpm,
    });
    outputPpms.push(compositeFirst.outputPpm);
  }

  const distinctVfxStates = new Set(rows.map((row) => row.vfx_final_state_hash)).size;
  const distinctEffectRasters = new Set(rows.map((row) => row.effect_raster_sha256)).size;
  const distinctOutputs = new Set(rows.map((row) => row.composite_ppm_sha256)).size;

  return {
    outputPpms,
    artifacts,
    observation: {
      schema: "axm.creative-render.temporal-vfx-observation/v1",
      frame_count: rows.length,
      width,
      height,
      total_rgb_bytes: totalRgbBytes,
      policy,
      donor_invariant: donorInvariant,
      frames: rows,
      distinct_vfx_state_count: distinctVfxStates,
      distinct_effect_raster_count: distinctEffectRasters,
      distinct_composite_frame_count: distinctOutputs,
      changed_frame_count: rows.filter((row) => row.changed_from_source).length,
      repeat_verification: "PASS",
      truth_boundary: {
        proves: [
          "each exact source PPM can receive a real Visual Effect Fabric electric Hand-graph execution with explicit deterministic seed state",
          "each canonical electric path state is materialized through the bounded Creative Render path raster adapter",
          "each exact effect raster is composited over its exact source frame through public Universal Creation Creative Flow Hands",
          "the same source frames, seeds and donor revisions repeat to identical effect state, effect raster and composite PPM bytes in the exercised environment",
        ],
        does_not_prove: [
          "native Render Fabric VFX passes or physical scene-light interaction",
          "continuous-time effect simulation between sparse frames",
          "complete realization of all Visual Effect Fabric semantics",
          "visual or cinematic quality",
          "cross-machine bitwise identity outside the named runtime boundaries",
        ],
      },
    },
  };
}
