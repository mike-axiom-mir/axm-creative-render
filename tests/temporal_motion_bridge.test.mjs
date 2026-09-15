import test from "node:test";
import assert from "node:assert/strict";

import { buildTemporalMotionRequest, analyzeAndFinishTemporalPpms } from "../src/temporal_motion_bridge.mjs";
import { serializePpmRgb8 } from "../src/post_render_bridge.mjs";

function raster(id, width = 320, height = 180) {
  return {
    schema: "axm.precision-raster/v1",
    version: "1.0.0",
    width,
    height,
    rgba8_base64: Buffer.alloc(width * height * 4, id).toString("base64"),
    colour_space: "srgb",
    source_digest: `source-${id}`,
    digest: `digest-${id}`,
  };
}

test("temporal motion request tracks against frame zero then stabilizes, differences and trails", () => {
  const request = buildTemporalMotionRequest([raster(1), raster(2), raster(3)], { searchRadius: 12, trailWindow: 3, decay: 0.5 });
  assert.equal(request.steps.length, 9);
  assert.deepEqual(request.steps.map((step) => step.hand_id), [
    "creative.frame-finish.motion-trail",
    "creative.frame-finish.block-match-track",
    "creative.frame-finish.stabilize-translation",
    "creative.frame-finish.difference-frame",
    "creative.frame-finish.motion-trail",
    "creative.frame-finish.block-match-track",
    "creative.frame-finish.stabilize-translation",
    "creative.frame-finish.difference-frame",
    "creative.frame-finish.motion-trail",
  ]);
  assert.deepEqual(request.steps[1].args.reference, { $state: "frames.0" });
  assert.deepEqual(request.steps[5].args.reference, { $state: "frames.0" });
  assert.deepEqual(request.steps[8].args.frames, [
    { $state: "frames.0" },
    { $state: "stable_001" },
    { $state: "stable_002" },
  ]);
  assert.equal(request.policy.searchRadius, 12);
  assert.equal(request.policy.trailWindow, 3);
  assert.equal(request.policy.decay, 0.5);
  assert(request.policy.work <= 32_000_000);
});

test("temporal motion request fails closed on tracking work overflow", () => {
  assert.throws(
    () => buildTemporalMotionRequest([raster(1), raster(2)], { searchRadius: 64 }),
    /work budget/,
  );
});

test("temporal motion rejects mixed PPM dimensions before donor execution", async () => {
  const a = serializePpmRgb8(4, 4, Buffer.alloc(4 * 4 * 3, 10));
  const b = serializePpmRgb8(5, 4, Buffer.alloc(5 * 4 * 3, 20));
  await assert.rejects(() => analyzeAndFinishTemporalPpms("/definitely-missing-uc", [a, b]), /dimensions do not match/);
});
