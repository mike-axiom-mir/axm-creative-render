import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePpmRgb8, ppmToPrecisionRaster, precisionRasterToPpm, serializePpmRgb8 } from "./post_render_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

const OVERLAY_HAND = "creative.frame-finish.overlay-at";
const MAX_FRAMES = 8;
const MAX_OFFSET = 64;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function boundedOffset(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < -MAX_OFFSET || n > MAX_OFFSET) throw new Error(`${label} must be an integer in -${MAX_OFFSET}..${MAX_OFFSET}`);
  return n;
}

function normalizeOffsets(offsets) {
  if (!Array.isArray(offsets) || offsets.length < 2 || offsets.length > MAX_FRAMES) throw new Error(`translation control requires 2..${MAX_FRAMES} offsets`);
  const normalized = offsets.map((row, index) => {
    object(row, `offset ${index}`);
    return { dx: boundedOffset(row.dx, `offset ${index} dx`), dy: boundedOffset(row.dy, `offset ${index} dy`) };
  });
  if (normalized[0].dx !== 0 || normalized[0].dy !== 0) throw new Error("translation control first offset must be 0,0 so the verified renderer frame remains the reference");
  const keys = normalized.map((row) => `${row.dx}:${row.dy}`);
  if (new Set(keys).size !== keys.length) throw new Error("translation control offsets must be distinct");
  return normalized;
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function buildRequest(sourceRaster, blankRaster, offsets) {
  return {
    mode: "execute",
    goal: "create a bounded ground-truth image-translation control sequence from one exact verified rendered frame",
    state: { source: sourceRaster, blank: blankRaster },
    steps: offsets.slice(1).map((row, index) => {
      const frame = index + 1;
      return {
        id: `translate-${String(frame).padStart(3, "0")}`,
        hand_id: OVERLAY_HAND,
        args: {
          base: { $state: "blank" },
          top: { $state: "source" },
          spec: { x: row.dx, y: row.dy, opacity: 1 },
        },
        save_as: `translated_${String(frame).padStart(3, "0")}`,
      };
    }),
  };
}

function validateResult(result, frameCount) {
  object(result, "translation-control Creative Flow result");
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) throw new Error(`translation-control Creative Flow did not pass cleanly: ${String(result.status)}`);
  if (!Array.isArray(result.receipts) || result.receipts.length !== frameCount - 1) throw new Error("translation-control receipt count drifted");
  const outputs = [];
  for (let frame = 1; frame < frameCount; frame += 1) {
    const raster = object(result.final_state?.[`translated_${String(frame).padStart(3, "0")}`], `translated raster ${frame}`);
    if (raster.schema !== "axm.precision-raster/v1") throw new Error(`translated raster ${frame} has wrong schema`);
    outputs.push(raster);
  }
  return outputs;
}

export async function createTranslationControlPpms(root, sourcePpm, offsets = [{ dx: 0, dy: 0 }, { dx: 4, dy: 2 }, { dx: 8, dy: 5 }]) {
  const normalizedOffsets = normalizeOffsets(offsets);
  const sourceBytes = Buffer.isBuffer(sourcePpm) ? sourcePpm : Buffer.from(sourcePpm);
  const parsed = parsePpmRgb8(sourceBytes);
  if (parsed.width < MAX_OFFSET * 2 + 32 || parsed.height < MAX_OFFSET * 2 + 32) throw new Error("translation-control source frame is too small for the bounded offset/search proof envelope");

  const sourceRaster = ppmToPrecisionRaster(sourceBytes);
  const blankPpm = serializePpmRgb8(parsed.width, parsed.height, Buffer.alloc(parsed.width * parsed.height * 3));
  const blankRaster = ppmToPrecisionRaster(blankPpm);

  const entryPath = resolve(resolve(root), "capabilities/platform-hands/index.js");
  const entry = await digestFile(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands;
  const flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function" || typeof hands.get !== "function") throw new Error("Universal Creation donor does not expose the expected creativeHands service");
  if (!flow || typeof flow.run !== "function" || typeof flow.summary !== "function") throw new Error("Universal Creation donor does not expose the expected creativeFlow service");
  const descriptor = hands.get(OVERLAY_HAND);
  if (!descriptor || descriptor.state !== "EXECUTABLE") throw new Error(`Universal Creation donor does not expose executable ${OVERLAY_HAND}`);

  const request = buildRequest(sourceRaster, blankRaster, normalizedOffsets);
  const first = flow.run(request), firstOutputs = validateResult(first, normalizedOffsets.length);
  const second = flow.run(request), secondOutputs = validateResult(second, normalizedOffsets.length);
  if (first.digest !== second.digest) throw new Error("translation-control Creative Flow digest did not repeat");

  const outputPpms = [sourceBytes];
  for (let index = 0; index < firstOutputs.length; index += 1) {
    const a = precisionRasterToPpm(firstOutputs[index]), b = precisionRasterToPpm(secondOutputs[index]);
    if (firstOutputs[index].digest !== secondOutputs[index].digest || !a.equals(b)) throw new Error(`translation-control output ${index + 1} did not repeat exactly`);
    outputPpms.push(a);
  }

  const audit = object(hands.audit(), "creative hands audit"), recipes = object(hands.recipeRegistry(), "creative recipe registry"), summary = object(flow.summary(), "creative flow summary");
  return {
    outputPpms,
    observation: {
      schema: "axm.creative-render.translation-control-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      hand_count: audit.total,
      recipe_count: recipes.count,
      creative_flow_summary_digest: summary.digest ?? null,
      overlay_hand_id: OVERLAY_HAND,
      overlay_hand_digest: descriptor.digest ?? null,
      flow_digest: first.digest,
      flow_receipts: first.receipts,
      width: parsed.width,
      height: parsed.height,
      source_ppm_sha256: sha256(sourceBytes),
      offsets: normalizedOffsets,
      output_ppm_sha256: outputPpms.map((bytes) => sha256(bytes)),
      repeat_verification: "PASS",
      truth_boundary: {
        proves: [
          "one exact verified renderer PPM remained unchanged as the reference frame",
          "subsequent control frames were created by the real Universal Creation overlay-at Hand through public Creative Flow over an explicit black same-size raster",
          "the requested integer image-space translation offsets are explicit ground-truth control state",
          "the same source frame and offsets repeated to identical translated raster and PPM bytes in the exercised environment",
        ],
        does_not_prove: [
          "scene-space or camera-space motion",
          "optical flow, semantic tracking or object identity",
          "that image-space overlay translation preserves content outside clipped frame boundaries",
          "visual quality",
        ],
      },
    },
  };
}
