import test from "node:test";
import assert from "node:assert/strict";

import { directElectricFlickerSetToAxmScene } from "../src/vfx_direct_electric_flicker_bridge.mjs";

function selected(energy, suffix = "a") {
  return {
    schema: "axm.electric-flicker-modulated-path-set/v0.1",
    basePathsHash: "retained-electric-base-hash",
    flickerCycleSourceHash: "retained-flicker-source-hash",
    electricFlickerModulationSourceHash: "retained-binding-source-hash",
    phase: suffix === "a" ? 0.11 : 0.43,
    sampleValue: suffix === "a" ? 0.4 : 0.8,
    normalizedSample: suffix === "a" ? 0.4 : 0.8,
    factor: suffix === "a" ? 0.5 : 0.9,
    paths: [
      {
        id: "trunk",
        role: "trunk",
        points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.42 }, { x: 0.9, y: 0.48 }],
        energy,
        width: 1,
        phase: 0.2,
        metadata: { caller: "preserve-me" },
      },
    ],
    pathSetHash: `path-set-${suffix}`,
    pathCount: 1,
    pointCount: 3,
    derived: true,
    rebuildable: true,
    modulatedSetHash: `modulated-set-${suffix}`,
  };
}

test("direct donor electric flicker observer keeps geometry fixed while derived energy changes bytes", () => {
  const a = directElectricFlickerSetToAxmScene(selected(0.45, "a"));
  const b = directElectricFlickerSetToAxmScene(selected(0.95, "b"));
  assert.equal(a.observation.geometry_layout_sha256, b.observation.geometry_layout_sha256);
  assert.equal(a.observation.output_triangle_count, 4);
  assert.equal(a.observation.output_triangle_count, b.observation.output_triangle_count);
  assert.notEqual(a.observation.output_sha256, b.observation.output_sha256);
  for (let index = 0; index < a.scene.triangles.length; index += 1) {
    assert.deepEqual(a.scene.triangles[index].vertices, b.scene.triangles[index].vertices);
  }
  assert.notDeepEqual(a.scene.triangles.map((triangle) => triangle.albedo), b.scene.triangles.map((triangle) => triangle.albedo));
  assert.equal(a.observation.semantic_lighting_preserved, false);
});

test("direct donor electric flicker observer preserves retained lineage labels", () => {
  const observed = directElectricFlickerSetToAxmScene(selected(0.7, "a"));
  assert.equal(observed.observation.source_schema, "axm.electric-flicker-modulated-path-set/v0.1");
  assert.equal(observed.observation.retained_base_paths_hash, "retained-electric-base-hash");
  assert.equal(observed.observation.retained_flicker_source_hash, "retained-flicker-source-hash");
  assert.equal(observed.observation.retained_modulation_source_hash, "retained-binding-source-hash");
  assert.equal(observed.observation.path_count, 1);
  assert.equal(observed.observation.point_count, 3);
  assert.equal(observed.observation.segment_count, 2);
});

test("direct donor electric flicker observer rejects authority promotion and count drift", () => {
  const promoted = selected(0.7, "a");
  promoted.derived = false;
  assert.throws(() => directElectricFlickerSetToAxmScene(promoted), /must remain derived and rebuildable/);

  const wrongSchema = selected(0.7, "a");
  wrongSchema.schema = "axm.fake/v9";
  assert.throws(() => directElectricFlickerSetToAxmScene(wrongSchema), /unexpected direct electric flicker schema/);

  const wrongCount = selected(0.7, "a");
  wrongCount.pointCount = 999;
  assert.throws(() => directElectricFlickerSetToAxmScene(wrongCount), /point count drifted/);
});
