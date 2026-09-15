import test from "node:test";
import assert from "node:assert/strict";

import { buildTemporalFinishRequest, finishTemporalPpms } from "../src/temporal_finish_bridge.mjs";
import { serializePpmRgb8 } from "../src/post_render_bridge.mjs";

function raster(id) {
  return {
    schema: "axm.precision-raster/v1",
    version: "1.0.0",
    width: 2,
    height: 2,
    rgba8_base64: Buffer.alloc(16, id).toString("base64"),
    colour_space: "srgb",
    source_digest: `source-${id}`,
    digest: `digest-${id}`,
  };
}

test("temporal finish request uses bounded progressive windows", () => {
  const request = buildTemporalFinishRequest([raster(1), raster(2), raster(3), raster(4)], { maxWindow: 3, decay: 0.5 });
  assert.equal(request.steps.length, 4);
  assert.deepEqual(request.steps[0].args.frames, [{ $state: "frames.0" }]);
  assert.deepEqual(request.steps[1].args.frames, [{ $state: "frames.0" }, { $state: "frames.1" }]);
  assert.deepEqual(request.steps[2].args.frames, [{ $state: "frames.0" }, { $state: "frames.1" }, { $state: "frames.2" }]);
  assert.deepEqual(request.steps[3].args.frames, [{ $state: "frames.1" }, { $state: "frames.2" }, { $state: "frames.3" }]);
  for (const step of request.steps) assert.equal(step.hand_id, "creative.frame-finish.motion-trail");
  assert.deepEqual(request.policy, { max_window: 3, decay: 0.5 });
});

test("temporal finish request fails closed on invalid window and decay", () => {
  const frames = [raster(1), raster(2)];
  assert.throws(() => buildTemporalFinishRequest(frames, { maxWindow: 0 }), /maxWindow/);
  assert.throws(() => buildTemporalFinishRequest(frames, { maxWindow: 9 }), /maxWindow/);
  assert.throws(() => buildTemporalFinishRequest(frames, { decay: -0.1 }), /decay/);
  assert.throws(() => buildTemporalFinishRequest(frames, { decay: 1.1 }), /decay/);
});

test("temporal finish rejects mixed PPM dimensions before donor execution", async () => {
  const a = serializePpmRgb8(2, 2, Buffer.alloc(12, 10));
  const b = serializePpmRgb8(3, 2, Buffer.alloc(18, 20));
  await assert.rejects(() => finishTemporalPpms("/definitely-missing-uc", [a, b]), /dimensions do not match/);
});
