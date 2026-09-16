import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  observeVisualEffectParameterCurve,
  parameterCurveSampleToAxmScene,
} from "../src/vfx_parameter_curve_bridge.mjs";

test("parameter-curve scene adapter is deterministic and changes only albedo", () => {
  const low = parameterCurveSampleToAxmScene({ sourceHash: "curve-source", t: 0.1, value: 0.2 });
  const lowRepeat = parameterCurveSampleToAxmScene({ sourceHash: "curve-source", t: 0.1, value: 0.2 });
  const high = parameterCurveSampleToAxmScene({ sourceHash: "curve-source", t: 0.8, value: 0.9 });
  assert.deepEqual(low.bytes, lowRepeat.bytes);
  assert.notDeepEqual(low.bytes, high.bytes);
  assert.equal(low.observation.geometry_is_fixed, true);
  assert.equal(low.observation.albedo_encodes_only_sample_value, true);
  assert.equal(low.observation.consumer_semantics_assigned, false);

  const lowScene = parseScene(low.bytes.toString("utf8"));
  const highScene = parseScene(high.bytes.toString("utf8"));
  assert.equal(lowScene.triangles.length, 2);
  assert.equal(highScene.triangles.length, 2);
  assert.deepEqual(
    lowScene.triangles.map((triangle) => triangle.vertices),
    highScene.triangles.map((triangle) => triangle.vertices),
  );
  assert.notDeepEqual(lowScene.triangles[0].albedo, highScene.triangles[0].albedo);
});

test("parameter-curve observation adapter fails closed outside its explicit scalar domain", () => {
  assert.throws(
    () => parameterCurveSampleToAxmScene({ sourceHash: "curve-source", t: 0.5, value: 1.01 }),
    /within 0\.\.1/,
  );
  assert.throws(
    () => parameterCurveSampleToAxmScene({ sourceHash: "", t: 0.5, value: 0.5 }),
    /requires sourceHash/,
  );
});

test("parameter-curve bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectParameterCurve("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
