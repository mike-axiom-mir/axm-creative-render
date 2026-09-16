import test from "node:test";
import assert from "node:assert/strict";

import { electricPathLayoutSha256, electricPathsToAxmScene } from "../src/vfx_electric_field_modulation_bridge.mjs";
import { parseScene, sha256 } from "../src/creative_scene_operator.mjs";

const basePaths = [
  {
    id: "trunk",
    role: "trunk",
    points: [{ x: 0.1, y: 0.5 }, { x: 0.45, y: 0.47 }, { x: 0.9, y: 0.42 }],
    energy: 1,
    width: 1,
    phase: 0.1,
  },
  {
    id: "branch-1",
    role: "branch",
    parent: "trunk",
    anchorIndex: 1,
    points: [{ x: 0.45, y: 0.47 }, { x: 0.55, y: 0.3 }, { x: 0.63, y: 0.22 }],
    energy: 0.58,
    width: 0.56,
    phase: 0.273,
  },
];

const modulatedPaths = [
  { ...structuredClone(basePaths[0]), energy: 0.62, scalarModulation: { uv: [0.48, 0.46], sample: 0.4, factor: 0.62 } },
  { ...structuredClone(basePaths[1]), energy: 0.25, scalarModulation: { uv: [0.54, 0.33], sample: 0.2, factor: 0.431034 } },
];

const baseIdentity = { source_hash: "base-hash", source_schema: "VFX_RETAINED_ELECTRIC_PATHS_ARRAY" };
const modulatedIdentity = {
  source_hash: "modulated-hash",
  source_schema: "axm.electric-modulated-path-set/v0.1",
  base_paths_hash: "base-hash",
  derived: true,
  rebuildable: true,
};

test("base and modulated electric paths preserve exact renderer geometry while energy changes only albedo", () => {
  assert.equal(electricPathLayoutSha256(basePaths), electricPathLayoutSha256(modulatedPaths));
  const base = electricPathsToAxmScene(basePaths, "base", baseIdentity);
  const modulated = electricPathsToAxmScene(modulatedPaths, "modulated", modulatedIdentity);
  const a = parseScene(base.bytes.toString("utf8"));
  const b = parseScene(modulated.bytes.toString("utf8"));

  assert.equal(a.triangles.length, 8);
  assert.equal(a.triangles.length, b.triangles.length);
  assert.deepEqual(a.triangles.map((row) => row.vertices), b.triangles.map((row) => row.vertices));
  assert.notDeepEqual(a.triangles.map((row) => row.albedo), b.triangles.map((row) => row.albedo));
  assert.equal(base.observation.geometry_layout_sha256, modulated.observation.geometry_layout_sha256);
  assert.equal(base.observation.geometry_encodes_energy, false);
  assert.equal(base.observation.albedo_encodes_energy, true);
  assert.equal(modulated.observation.output_sha256, sha256(modulated.bytes));
});

test("renderer layout ignores energy, scalar annotations and phase but catches point or width drift", () => {
  const annotationOnly = structuredClone(modulatedPaths);
  annotationOnly[0].energy = 0.11;
  annotationOnly[0].phase = 0.77;
  annotationOnly[0].scalarModulation = { uv: [0.1, 0.9], sample: 0.9, factor: 0.1 };
  assert.equal(electricPathLayoutSha256(basePaths), electricPathLayoutSha256(annotationOnly));

  const moved = structuredClone(modulatedPaths);
  moved[0].points[1].x += 0.01;
  assert.notEqual(electricPathLayoutSha256(basePaths), electricPathLayoutSha256(moved));

  const widened = structuredClone(modulatedPaths);
  widened[0].width += 0.01;
  assert.notEqual(electricPathLayoutSha256(basePaths), electricPathLayoutSha256(widened));
});

test("native electric adapter fails closed on unbound or promoted derived state", () => {
  assert.throws(() => electricPathsToAxmScene(basePaths, "base", {}), /source identity hash/);
  assert.throws(() => electricPathsToAxmScene(modulatedPaths, "modulated", { ...modulatedIdentity, derived: false }), /derived and rebuildable/);
  assert.throws(() => electricPathsToAxmScene(modulatedPaths, "modulated", { ...modulatedIdentity, source_schema: "old" }), /unexpected modulated source schema/);
  const invalid = structuredClone(basePaths);
  invalid[0].points[0].x = -0.1;
  assert.throws(() => electricPathsToAxmScene(invalid, "base", baseIdentity), /must be within \[0,1\]/);
});
