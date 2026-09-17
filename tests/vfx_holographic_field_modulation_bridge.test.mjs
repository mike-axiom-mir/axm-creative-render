import test from "node:test";
import assert from "node:assert/strict";

import {
  holographicSampleFieldToAxmScene,
  holographicSampleLayoutSha256,
} from "../src/vfx_holographic_field_modulation_bridge.mjs";
import { parseScene, sha256 } from "../src/creative_scene_operator.mjs";

const base = {
  schema: "axm.holographic-sample-field/v0.1",
  stride: 7,
  pointCount: 3,
  canonicalFormHash: "form-hash",
  points: [
    [-0.3, -0.2, 0, 3, 0, 0.1, 1],
    [0.0, 0.1, 0.02, 4, 1, 0.4, 0.8],
    [0.35, 0.25, -0.01, 2.5, 2, 0.8, 0.6],
  ].flat(),
};

const modulated = {
  ...structuredClone(base),
  schema: "axm.holographic-modulated-sample-field/v0.1",
  baseSampleFieldHash: "base-hash",
  fieldCompositionSourceHash: "composition-hash",
  inputAHash: "a-hash",
  inputBHash: "b-hash",
  holographicFieldModulationSourceHash: "modulation-hash",
  sampleFieldHash: "points-hash",
  factorStats: { min: 0.3, max: 0.8, mean: 0.55, samples: 3 },
  derived: true,
  rebuildable: true,
};
modulated.points[6] = 0.7;
modulated.points[13] = 0.32;
modulated.points[20] = 0.18;

const baseIdentity = { source_hash: "base-hash", source_schema: "axm.holographic-sample-field/v0.1" };
const modulatedIdentity = {
  source_hash: "points-hash",
  source_schema: "axm.holographic-modulated-sample-field/v0.1",
  base_sample_hash: "base-hash",
  derived: true,
  rebuildable: true,
};

test("base and modulated holographic samples keep exact geometry while intensity changes only albedo", () => {
  assert.equal(holographicSampleLayoutSha256(base), holographicSampleLayoutSha256(modulated));
  const aOut = holographicSampleFieldToAxmScene(base, "base", baseIdentity);
  const bOut = holographicSampleFieldToAxmScene(modulated, "modulated", modulatedIdentity);
  const a = parseScene(aOut.bytes.toString("utf8"));
  const b = parseScene(bOut.bytes.toString("utf8"));

  assert.equal(a.triangles.length, 6);
  assert.equal(a.triangles.length, b.triangles.length);
  assert.deepEqual(a.triangles.map((row) => row.vertices), b.triangles.map((row) => row.vertices));
  assert.notDeepEqual(a.triangles.map((row) => row.albedo), b.triangles.map((row) => row.albedo));
  assert.equal(aOut.observation.geometry_layout_sha256, bOut.observation.geometry_layout_sha256);
  assert.equal(aOut.observation.geometry_encodes_intensity, false);
  assert.equal(aOut.observation.albedo_encodes_intensity, true);
  assert.equal(bOut.observation.output_sha256, sha256(bOut.bytes));
});

test("holographic layout hash ignores intensity but catches position, size, role or phase drift", () => {
  const intensityOnly = structuredClone(base);
  intensityOnly.points[6] = 0.11;
  assert.equal(holographicSampleLayoutSha256(base), holographicSampleLayoutSha256(intensityOnly));

  for (const offset of [0, 3, 4, 5]) {
    const changed = structuredClone(base);
    changed.points[offset] += offset === 4 ? 1 : 0.01;
    assert.notEqual(holographicSampleLayoutSha256(base), holographicSampleLayoutSha256(changed));
  }
});

test("native holographic adapter fails closed on promoted, malformed or unbound derived state", () => {
  assert.throws(() => holographicSampleFieldToAxmScene(base, "base", {}), /source identity hash/);
  assert.throws(
    () => holographicSampleFieldToAxmScene(modulated, "modulated", { ...modulatedIdentity, derived: false }),
    /derived and rebuildable/,
  );
  assert.throws(
    () => holographicSampleFieldToAxmScene(modulated, "modulated", { ...modulatedIdentity, source_schema: "old" }),
    /unexpected modulated source schema/,
  );
  const invalid = structuredClone(base);
  invalid.points[3] = 0;
  assert.throws(() => holographicSampleFieldToAxmScene(invalid, "base", baseIdentity), /size must be within/);
});
