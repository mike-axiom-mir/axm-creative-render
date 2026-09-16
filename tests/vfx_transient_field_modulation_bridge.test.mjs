import test from "node:test";
import assert from "node:assert/strict";

import { impulseFieldLayoutSha256, impulseFieldToAxmScene } from "../src/vfx_transient_field_modulation_bridge.mjs";
import { parseScene, sha256 } from "../src/creative_scene_operator.mjs";

const event = {
  schema: "axm.transient-impulse-event/v0.1",
  id: "fixture-event",
  kind: "transient-impulse",
  seed: 7,
  origin: [0.5, 0.5],
  direction: [1, 0],
  energy: 1,
  radius: 0.3,
  duration: 0.7,
  controls: {},
};

const baseGeometry = {
  rings: [{ id: "ring-1", radiusScale: 0.8, widthScale: 0.7, intensity: 0.9, phase: 0.1, axisRatio: 0.8, rotation: 0.2 }],
  spokes: [{ id: "spoke-1", angle: 0.1, startScale: 0.1, lengthScale: 0.8, widthScale: 0.9, intensity: 1.1, bend: 0.03, phase: 0.2 }],
  fragments: [{ id: "fragment-1", angle: 1.1, radialScale: 0.65, lengthScale: 0.06, tangentScale: 0.02, intensity: 0.8, phase: 0.3 }],
};

const baseField = {
  schema: "axm.transient-impulse-field/v0.1",
  canonicalEventHash: "event-hash",
  geometry: baseGeometry,
  geometryHash: "base-geometry-hash",
  counts: { rings: 1, spokes: 1, fragments: 1 },
  derived: true,
  rebuildable: true,
};

const modulatedField = {
  schema: "axm.transient-impulse-modulated-field/v0.1",
  canonicalEventHash: "event-hash",
  baseFieldGeometryHash: "base-geometry-hash",
  fieldCompositionSourceHash: "composition-hash",
  inputAHash: "a-hash",
  inputBHash: "b-hash",
  fieldModulationSourceHash: "modulation-hash",
  geometry: {
    rings: structuredClone(baseGeometry.rings),
    spokes: [{ ...baseGeometry.spokes[0], intensity: 0.55, scalarModulation: { uv: [0.5, 0.5], sample: 0.4, factor: 0.5 } }],
    fragments: [{ ...baseGeometry.fragments[0], intensity: 0.4, scalarModulation: { uv: [0.2, 0.8], sample: 0.3, factor: 0.5 } }],
  },
  geometryHash: "modulated-geometry-hash",
  counts: { rings: 1, spokes: 1, fragments: 1 },
  factorStats: { min: 0.5, max: 0.5, mean: 0.5, samples: 2 },
  derived: true,
  rebuildable: true,
};

test("base and modulated fields share exact scene geometry while derived intensity changes only albedo", () => {
  assert.equal(impulseFieldLayoutSha256(baseField), impulseFieldLayoutSha256(modulatedField));
  const base = impulseFieldToAxmScene(event, "event-hash", baseField, "base");
  const modulated = impulseFieldToAxmScene(event, "event-hash", modulatedField, "modulated");
  const baseScene = parseScene(base.bytes.toString("utf8"));
  const modulatedScene = parseScene(modulated.bytes.toString("utf8"));

  assert.equal(baseScene.triangles.length, 44);
  assert.equal(baseScene.triangles.length, modulatedScene.triangles.length);
  assert.deepEqual(baseScene.triangles.map((row) => row.vertices), modulatedScene.triangles.map((row) => row.vertices));
  assert.notDeepEqual(baseScene.triangles.map((row) => row.albedo), modulatedScene.triangles.map((row) => row.albedo));
  assert.equal(base.observation.geometry_layout_sha256, modulated.observation.geometry_layout_sha256);
  assert.equal(base.observation.geometry_encodes_intensity, false);
  assert.equal(base.observation.albedo_encodes_intensity, true);
  assert.equal(modulated.observation.output_sha256, sha256(modulated.bytes));
});

test("layout identity ignores modulation annotations and intensity but catches spatial drift", () => {
  const annotationOnly = structuredClone(modulatedField);
  annotationOnly.geometry.spokes[0].scalarModulation = { uv: [0.1, 0.9], sample: 0.9, factor: 0.2 };
  annotationOnly.geometry.spokes[0].intensity = 0.1;
  assert.equal(impulseFieldLayoutSha256(baseField), impulseFieldLayoutSha256(annotationOnly));

  const moved = structuredClone(modulatedField);
  moved.geometry.spokes[0].angle += 0.01;
  assert.notEqual(impulseFieldLayoutSha256(baseField), impulseFieldLayoutSha256(moved));
});

test("scene adapter fails closed on broken authority or derived-body evidence", () => {
  assert.throws(() => impulseFieldToAxmScene(event, "other-event", baseField, "base"), /lost canonical event identity/);
  assert.throws(() => impulseFieldToAxmScene(event, "event-hash", { ...baseField, derived: false }, "base"), /derived and rebuildable/);
  assert.throws(() => impulseFieldToAxmScene(event, "event-hash", { ...baseField, schema: "old" }, "base"), /unexpected base impulse field schema/);
  assert.throws(() => impulseFieldToAxmScene(event, "event-hash", { ...baseField, counts: { rings: 2, spokes: 1, fragments: 1 } }, "base"), /primitive counts drifted/);
});
