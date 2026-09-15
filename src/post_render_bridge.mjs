import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256 } from "./creative_scene_operator.mjs";

const PRECISION_RASTER_SCHEMA = "axm.precision-raster/v1";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function canonicalSha256(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function isWhitespace(byte) {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0b || byte === 0x0c;
}

function nextHeaderToken(bytes, start) {
  let i = start;
  while (i < bytes.length) {
    if (isWhitespace(bytes[i])) {
      i += 1;
      continue;
    }
    if (bytes[i] === 0x23) {
      while (i < bytes.length && bytes[i] !== 0x0a) i += 1;
      continue;
    }
    break;
  }
  if (i >= bytes.length) throw new Error("PPM header ended before all required tokens");
  const begin = i;
  while (i < bytes.length && !isWhitespace(bytes[i]) && bytes[i] !== 0x23) i += 1;
  return { token: bytes.subarray(begin, i).toString("ascii"), end: i };
}

export function parsePpmRgb8(ppmBytes) {
  if (!Buffer.isBuffer(ppmBytes)) ppmBytes = Buffer.from(ppmBytes);
  let cursor = 0;
  const magic = nextHeaderToken(ppmBytes, cursor); cursor = magic.end;
  const widthToken = nextHeaderToken(ppmBytes, cursor); cursor = widthToken.end;
  const heightToken = nextHeaderToken(ppmBytes, cursor); cursor = heightToken.end;
  const maxToken = nextHeaderToken(ppmBytes, cursor); cursor = maxToken.end;

  if (magic.token !== "P6") throw new Error("only binary P6 PPM is supported");
  if (!/^\d+$/.test(widthToken.token) || !/^\d+$/.test(heightToken.token)) throw new Error("PPM width/height must be positive integers");
  const width = Number(widthToken.token);
  const height = Number(heightToken.token);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error("PPM width/height invalid");
  if (width > 16384 || height > 16384 || width * height > 16777216) throw new Error("PPM exceeds precision-raster bounds");
  if (maxToken.token !== "255") throw new Error("only 8-bit PPM max value 255 is supported");
  if (cursor >= ppmBytes.length || !isWhitespace(ppmBytes[cursor])) throw new Error("PPM max value must be followed by whitespace");
  if (ppmBytes[cursor] === 0x0d && ppmBytes[cursor + 1] === 0x0a) cursor += 2;
  else cursor += 1;

  const expected = width * height * 3;
  const rgb = ppmBytes.subarray(cursor);
  if (rgb.length !== expected) throw new Error(`PPM pixel byte length mismatch: expected ${expected}, got ${rgb.length}`);
  return { width, height, rgb: Buffer.from(rgb) };
}

export function serializePpmRgb8(width, height, rgb) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error("PPM dimensions invalid");
  const bytes = Buffer.isBuffer(rgb) ? rgb : Buffer.from(rgb);
  if (bytes.length !== width * height * 3) throw new Error("PPM RGB byte length mismatch");
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii"), bytes]);
}

export function ppmToPrecisionRaster(ppmBytes) {
  const parsed = parsePpmRgb8(ppmBytes);
  const rgba = Buffer.alloc(parsed.width * parsed.height * 4);
  for (let source = 0, target = 0; source < parsed.rgb.length; source += 3, target += 4) {
    rgba[target] = parsed.rgb[source];
    rgba[target + 1] = parsed.rgb[source + 1];
    rgba[target + 2] = parsed.rgb[source + 2];
    rgba[target + 3] = 255;
  }
  const raster = {
    schema: PRECISION_RASTER_SCHEMA,
    version: "1.0.0",
    width: parsed.width,
    height: parsed.height,
    rgba8_base64: rgba.toString("base64"),
    colour_space: "srgb",
    source_digest: sha256(rgba),
  };
  raster.digest = canonicalSha256(raster);
  return raster;
}

export function precisionRasterToPpm(raster) {
  object(raster, "precision raster");
  if (raster.schema !== PRECISION_RASTER_SCHEMA) throw new Error(`unsupported raster schema: ${String(raster.schema)}`);
  const width = Number(raster.width);
  const height = Number(raster.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16777216) {
    throw new Error("precision raster dimensions invalid");
  }
  const rgba = Buffer.from(String(raster.rgba8_base64 ?? ""), "base64");
  if (rgba.length !== width * height * 4) throw new Error("precision raster rgba byte length mismatch");
  const rgb = Buffer.alloc(width * height * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source];
    rgb[target + 1] = rgba[source + 1];
    rgb[target + 2] = rgba[source + 2];
  }
  return serializePpmRgb8(width, height, rgb);
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function validateFlowResult(result, expectedSteps) {
  object(result, "post-render Creative Flow result");
  if (result.status !== "PASS" || result.candidate_ready !== true || result.source_state_mutated !== false) {
    throw new Error(`post-render Creative Flow did not pass cleanly: ${String(result.status)}`);
  }
  if (!Array.isArray(result.receipts) || result.receipts.length !== expectedSteps) throw new Error("post-render Creative Flow receipt count drifted");
  const raster = object(result.final_state?.styled, "post-render styled raster");
  if (raster.schema !== PRECISION_RASTER_SCHEMA) throw new Error("post-render Creative Flow returned the wrong raster schema");
  return raster;
}

export async function applyUniversalCreationToRenderedPpm(root, ppmBytes) {
  const rootPath = resolve(root);
  const entryPath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const entry = await digestFile(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands;
  const flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeHands service");
  }
  if (!flow || typeof flow.summary !== "function" || typeof flow.run !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeFlow service");
  }

  const audit = object(hands.audit(), "creative hands audit");
  const recipes = object(hands.recipeRegistry(), "creative recipe registry");
  const flowSummary = object(flow.summary(), "creative flow summary");
  const inputRaster = ppmToPrecisionRaster(ppmBytes);
  const request = {
    mode: "execute",
    goal: "apply an explicit bounded creative treatment directly to a rendered frame",
    state: { frame: inputRaster },
    steps: [
      {
        id: "tint",
        hand_id: "creative.adjust.tint",
        args: { image: { $state: "frame" }, spec: { rgb: [72, 220, 255], amount: 0.32 } },
        save_as: "tinted",
      },
      {
        id: "contrast",
        hand_id: "creative.adjust.contrast",
        args: { image: { $state: "tinted" }, spec: { factor: 1.12 } },
        save_as: "styled",
      },
    ],
  };

  const first = flow.run(request);
  const firstRaster = validateFlowResult(first, 2);
  const second = flow.run(request);
  const secondRaster = validateFlowResult(second, 2);
  const outputPpm = precisionRasterToPpm(firstRaster);
  const repeatPpm = precisionRasterToPpm(secondRaster);
  if (first.digest !== second.digest || firstRaster.digest !== secondRaster.digest || !outputPpm.equals(repeatPpm)) {
    throw new Error("post-render Creative Flow repeat verification failed");
  }
  if (outputPpm.equals(ppmBytes)) throw new Error("post-render creative operation produced unchanged PPM bytes");

  return {
    outputPpm,
    observation: {
      schema: "axm.creative-render.post-render-uc-observation/v1",
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
      flow_receipts: first.receipts,
      operation_ids: first.receipts.map((row) => row.operation_id ?? null),
      input_raster_digest: inputRaster.digest,
      output_raster_digest: firstRaster.digest ?? null,
      input_ppm_sha256: sha256(ppmBytes),
      output_ppm_sha256: sha256(outputPpm),
      width: inputRaster.width,
      height: inputRaster.height,
      repeat_verification: "PASS",
      adapter: {
        input: "ppm-rgb8",
        working_state: PRECISION_RASTER_SCHEMA,
        output: "ppm-rgb8",
        alpha_policy: "opaque-255-on-intake; alpha discarded on PPM export",
      },
    },
  };
}
