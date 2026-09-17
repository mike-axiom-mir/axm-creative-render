import test from "node:test";
import assert from "node:assert/strict";

import { maskGuidedLightRaySetToAxmScene } from "../src/vfx_multi_family_mask_guided_light_rays_native_bridge.mjs";

function ray(index, weight, start = [0.2, 0.5], end = [0.8, 0.5]) {
  return {
    id: `rays:${index}`,
    index,
    angleTurns: 0,
    start,
    end,
    length: 0.6,
    coverageMean: weight,
    coverageMin: Math.max(0, weight - 0.1),
    coverageMax: Math.min(1, weight + 0.1),
    weight,
  };
}

function fixture(overrides = {}) {
  return {
    schema: "axm.mask-guided-light-ray-set/v0.1",
    raySourceHash: "ray-source-hash",
    fieldSourceHash: "field-source-hash",
    maskSourceHash: "mask-source-hash",
    rayCount: 3,
    samplesPerRay: 8,
    rays: [
      ray(0, 0.2, [0.2, 0.35], [0.8, 0.35]),
      ray(1, 0.5, [0.2, 0.5], [0.8, 0.5]),
      ray(2, 0.8, [0.2, 0.65], [0.8, 0.65]),
    ],
    raySetHash: "ray-set-hash",
    derived: true,
    rebuildable: true,
    ...overrides,
  };
}

test("mask-guided light-ray native adapter preserves a source-family-neutral derived observation boundary", () => {
  const result = maskGuidedLightRaySetToAxmScene(fixture());
  assert.equal(result.scene.version, 1);
  assert.equal(result.scene.triangles.length, 6);
  assert.equal(result.observation.input_schema, "axm.mask-guided-light-ray-set/v0.1");
  assert.equal(result.observation.ray_count, 3);
  assert.equal(result.observation.output_triangles, 6);
  assert.equal(result.observation.source_family_branching, false);
  assert.equal(result.observation.consumer_semantics_assigned, false);
  assert.equal(result.observation.canonical_source_rewritten, false);
  assert.equal(result.observation.derived, true);
  assert.equal(result.observation.replaceable, true);
  assert.deepEqual(result.scene.triangles[0].albedo, [80, 80, 80]);
  assert.deepEqual(result.scene.triangles.at(-1).albedo, [200, 200, 200]);
});

test("mask-guided light-ray native adapter keeps geometry identical when only derived weights differ", () => {
  const a = maskGuidedLightRaySetToAxmScene(fixture());
  const changed = fixture({
    fieldSourceHash: "other-field",
    maskSourceHash: "other-mask",
    raySourceHash: "other-ray-source",
    raySetHash: "other-ray-set",
    rays: fixture().rays.map((entry, index) => ({
      ...entry,
      weight: 1 - entry.weight,
      coverageMean: 1 - entry.coverageMean,
      coverageMin: Math.max(0, (1 - entry.coverageMean) - 0.1),
      coverageMax: Math.min(1, (1 - entry.coverageMean) + 0.1),
      id: `other:${index}`,
    })),
  });
  const b = maskGuidedLightRaySetToAxmScene(changed);
  assert.deepEqual(a.scene.triangles.map((triangle) => triangle.vertices), b.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(a.scene.triangles.map((triangle) => triangle.albedo), b.scene.triangles.map((triangle) => triangle.albedo));
  assert.notEqual(a.bytes.toString("utf8"), b.bytes.toString("utf8"));
});

test("mask-guided light-ray native adapter fails closed on non-derived input", () => {
  assert.throws(() => maskGuidedLightRaySetToAxmScene(fixture({ derived: false })), /derived rebuildable/);
});

test("mask-guided light-ray native adapter fails closed on ray cardinality mismatch", () => {
  assert.throws(() => maskGuidedLightRaySetToAxmScene(fixture({ rayCount: 4 })), /cardinality mismatch/);
});

test("mask-guided light-ray native adapter fails closed on out-of-range weights", () => {
  const rays = fixture().rays.slice();
  rays[0] = { ...rays[0], weight: 1.1 };
  assert.throws(() => maskGuidedLightRaySetToAxmScene(fixture({ rays })), /within 0..1/);
});

test("mask-guided light-ray native adapter fails closed on inconsistent coverage summaries", () => {
  const rays = fixture().rays.slice();
  rays[0] = { ...rays[0], coverageMin: 0.6, coverageMean: 0.2 };
  assert.throws(() => maskGuidedLightRaySetToAxmScene(fixture({ rays })), /coverage summaries/);
});

test("mask-guided light-ray native adapter does not silently realize zero-length rays", () => {
  const rays = fixture().rays.slice();
  rays[0] = { ...rays[0], start: [0.5, 0.5], end: [0.5, 0.5] };
  assert.throws(() => maskGuidedLightRaySetToAxmScene(fixture({ rays })), /zero-length ray/);
});
