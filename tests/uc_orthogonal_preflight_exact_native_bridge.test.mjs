import test from "node:test";
import assert from "node:assert/strict";
import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  runUniversalCreationOrthogonalPreflightExact,
  worldToOrthogonalPreflightScene,
} from "../src/uc_orthogonal_preflight_exact_native_bridge.mjs";

test("orthogonal preflight scene adapter is deterministic and bounded", () => {
  const world = {
    bodies: [
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 3, y: 4 } },
    ],
  };
  const first = worldToOrthogonalPreflightScene(world);
  const second = worldToOrthogonalPreflightScene(structuredClone(world));
  assert.deepEqual(first, second);
  const parsed = parseScene(first.toString("utf8"));
  assert.equal(parsed.triangles.length, 4);
  assert.deepEqual(parsed.triangles[0].albedo, [90, 110, 145]);
  assert.deepEqual(parsed.triangles[2].albedo, [224, 166, 72]);
});

test("orthogonal preflight bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    runUniversalCreationOrthogonalPreflightExact("/definitely/not/a/donor", { ucRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});

test("orthogonal preflight scene adapter fails closed when required bodies are absent", () => {
  assert.throws(
    () => worldToOrthogonalPreflightScene({ bodies: [{ id: "a", position: { x: 0, y: 0 } }] }),
    /lost body b/,
  );
});
