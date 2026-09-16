import test from "node:test";
import assert from "node:assert/strict";
import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  runUniversalCreationConstraintPreflightGuard,
  worldToConstraintPreflightGuardScene,
} from "../src/uc_constraint_preflight_guard_native_bridge.mjs";

test("constraint preflight guard scene adapter is deterministic and bounded", () => {
  const world = {
    bodies: [
      { id: "root", position: { x: 0, y: 0 } },
      { id: "payload", position: { x: 0.5, y: 0.25 } },
    ],
  };
  const first = worldToConstraintPreflightGuardScene(world);
  const second = worldToConstraintPreflightGuardScene(structuredClone(world));
  assert.deepEqual(first, second);
  const parsed = parseScene(first.toString("utf8"));
  assert.equal(parsed.triangles.length, 4);
  assert.deepEqual(parsed.triangles[0].albedo, [90, 110, 145]);
  assert.deepEqual(parsed.triangles[2].albedo, [224, 166, 72]);
});

test("constraint preflight guard bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    runUniversalCreationConstraintPreflightGuard("/definitely/not/a/donor", { ucRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});

test("constraint preflight guard scene adapter fails closed when required bodies are absent", () => {
  assert.throws(
    () => worldToConstraintPreflightGuardScene({ bodies: [{ id: "root", position: { x: 0, y: 0 } }] }),
    /lost body payload/,
  );
});
