import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  observeVisualEffectTransientImpulseCurve,
  transientImpulseIntensityToAxmScene,
} from "../src/vfx_transient_impulse_curve_bridge.mjs";

test("transient impulse intensity adapter is deterministic and changes only albedo", () => {
  const base = transientImpulseIntensityToAxmScene({ eventHash: "event", lineageHash: "base", t: 0.25, intensity: 0.6 });
  const repeat = transientImpulseIntensityToAxmScene({ eventHash: "event", lineageHash: "base", t: 0.25, intensity: 0.6 });
  const shaped = transientImpulseIntensityToAxmScene({ eventHash: "event", lineageHash: "derived", t: 0.25, intensity: 1.1 });
  assert.deepEqual(base.bytes, repeat.bytes);
  assert.notDeepEqual(base.bytes, shaped.bytes);
  assert.equal(base.observation.geometry_is_fixed, true);
  assert.equal(base.observation.albedo_encodes_only_intensity, true);
  assert.equal(base.observation.consumer_semantics_assigned, false);

  const baseScene = parseScene(base.bytes.toString("utf8"));
  const shapedScene = parseScene(shaped.bytes.toString("utf8"));
  assert.equal(baseScene.triangles.length, 2);
  assert.equal(shapedScene.triangles.length, 2);
  assert.deepEqual(
    baseScene.triangles.map((triangle) => triangle.vertices),
    shapedScene.triangles.map((triangle) => triangle.vertices),
  );
  assert.notDeepEqual(baseScene.triangles[0].albedo, shapedScene.triangles[0].albedo);
});

test("transient impulse observation adapter fails closed outside explicit bounds", () => {
  assert.throws(
    () => transientImpulseIntensityToAxmScene({ eventHash: "event", lineageHash: "lineage", t: 0.25, intensity: 2.01 }),
    /within 0\.\.2/,
  );
  assert.throws(
    () => transientImpulseIntensityToAxmScene({ eventHash: "", lineageHash: "lineage", t: 0.25, intensity: 0.5 }),
    /requires eventHash/,
  );
  assert.throws(
    () => transientImpulseIntensityToAxmScene({ eventHash: "event", lineageHash: "", t: 0.25, intensity: 0.5 }),
    /requires lineageHash/,
  );
});

test("transient impulse curve bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectTransientImpulseCurve("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
