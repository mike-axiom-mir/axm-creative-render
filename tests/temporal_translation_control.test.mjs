import test from "node:test";
import assert from "node:assert/strict";

import { createTranslationControlPpms } from "../src/temporal_translation_control.mjs";
import { serializePpmRgb8 } from "../src/post_render_bridge.mjs";

function source() {
  return serializePpmRgb8(192, 192, Buffer.alloc(192 * 192 * 3, 20));
}

test("translation control requires an unchanged 0,0 reference offset", async () => {
  await assert.rejects(
    () => createTranslationControlPpms("/definitely-missing-uc", source(), [{ dx: 1, dy: 0 }, { dx: 4, dy: 2 }]),
    /first offset must be 0,0/,
  );
});

test("translation control rejects duplicate and out-of-bound offsets before donor execution", async () => {
  await assert.rejects(
    () => createTranslationControlPpms("/definitely-missing-uc", source(), [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]),
    /offsets must be distinct/,
  );
  await assert.rejects(
    () => createTranslationControlPpms("/definitely-missing-uc", source(), [{ dx: 0, dy: 0 }, { dx: 65, dy: 0 }]),
    /offset 1 dx/,
  );
});
