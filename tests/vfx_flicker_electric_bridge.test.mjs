import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveFlickerElectricEnergyView,
  flickerElectricViewToAxmScene,
} from "../src/vfx_flicker_electric_bridge.mjs";

const selected = {
  schema: "axm.electric-modulated-path-set/v0.1",
  pathSetHash: "selected-electric-path-set-hash",
  basePathsHash: "retained-electric-base-hash",
  paths: [
    {
      id: "trunk-0",
      role: "trunk",
      points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.42 }, { x: 0.9, y: 0.48 }],
      energy: 1,
      width: 1,
      phase: 0.2,
      metadata: { caller: "preserve-me" },
      scalarModulation: { factor: 0.8 },
    },
  ],
  derived: true,
  rebuildable: true,
};

test("flicker electric view changes only derived energy and keeps resource capacity non-creative", () => {
  const exact = deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 0.2, 0.5, { maxPaths: 1 });
  const roomy = deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 0.2, 0.5, { maxPaths: 32 });
  assert.equal(exact.view.viewHash, roomy.view.viewHash);
  assert.equal(exact.view.paths[0].energy, 0.5);
  assert.deepEqual(exact.view.paths[0].points, selected.paths[0].points);
  assert.deepEqual(exact.view.paths[0].metadata, selected.paths[0].metadata);
  assert.deepEqual(exact.view.paths[0].scalarModulation, selected.paths[0].scalarModulation);
  assert.equal(selected.paths[0].energy, 1);
  assert.throws(() => deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 0.2, 0.5, { maxPaths: 0 }), /positive integer|path budget exceeded/);
});

test("whole-cycle phase aliases share one derived identity when the donor scalar is equal", () => {
  const a = deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 0.17, 0.63, { maxPaths: 1 });
  const loop = deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 1.17, 0.63, { maxPaths: 1 });
  assert.equal(a.view.phase, loop.view.phase);
  assert.equal(a.view.viewHash, loop.view.viewHash);
});

test("native observation keeps geometry fixed while explicit derived energy can change bytes", () => {
  const a = deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 0.1, 0.35, { maxPaths: 1 });
  const b = deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 0.4, 0.9, { maxPaths: 1 });
  const sceneA = flickerElectricViewToAxmScene(a.view);
  const sceneB = flickerElectricViewToAxmScene(b.view);
  assert.equal(sceneA.observation.geometry_layout_sha256, sceneB.observation.geometry_layout_sha256);
  assert.equal(sceneA.observation.output_triangle_count, 4);
  assert.equal(sceneA.observation.output_triangle_count, sceneB.observation.output_triangle_count);
  assert.notEqual(sceneA.observation.output_sha256, sceneB.observation.output_sha256);
  for (let index = 0; index < sceneA.scene.triangles.length; index += 1) {
    assert.deepEqual(sceneA.scene.triangles[index].vertices, sceneB.scene.triangles[index].vertices);
  }
  assert.notDeepEqual(sceneA.scene.triangles.map((triangle) => triangle.albedo), sceneB.scene.triangles.map((triangle) => triangle.albedo));
});

test("native observer rejects forged view hash and non-derived authority promotion", () => {
  const { view } = deriveFlickerElectricEnergyView(selected, "flicker-source-hash", 0.2, 0.5, { maxPaths: 1 });
  const forgedHash = structuredClone(view);
  forgedHash.paths[0].energy = 0.9;
  assert.throws(() => flickerElectricViewToAxmScene(forgedHash), /view hash mismatch/);
  const promoted = structuredClone(view);
  promoted.derived = false;
  assert.throws(() => flickerElectricViewToAxmScene(promoted), /must remain derived and rebuildable/);
});
