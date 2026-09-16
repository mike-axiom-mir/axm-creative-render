import test from "node:test";
import assert from "node:assert/strict";

import { parseScene } from "../src/creative_scene_operator.mjs";
import {
  runUniversalCreationDirectionLock,
  worldToDirectionLockScene,
} from "../src/uc_direction_lock_native_bridge.mjs";

function world(payload = { x: -0.1, y: 0 }) {
  return {
    bodies: [
      { id: "anchor", position: { x: -0.6, y: -0.5 } },
      { id: "payload", position: payload },
    ],
  };
}

test("direction-lock render adapter changes only payload placement in the bounded fixture", () => {
  const before = parseScene(worldToDirectionLockScene(world()).toString("utf8"));
  const after = parseScene(worldToDirectionLockScene(world({ x: -0.45, y: 0.35 })).toString("utf8"));
  assert.equal(before.triangles.length, 4);
  assert.equal(after.triangles.length, 4);
  assert.deepEqual(before.triangles.slice(0, 2), after.triangles.slice(0, 2), "anchor evidence geometry must remain fixed");
  for (let index = 0; index < before.triangles.length; index++) {
    assert.deepEqual(before.triangles[index].albedo, after.triangles[index].albedo, "adapter must not invent an albedo change");
  }
  assert.notDeepEqual(before.triangles.slice(2), after.triangles.slice(2), "payload evidence geometry must move when the derived physics body moves");
});

test("direction-lock render adapter fails closed when the bounded body contract is missing", () => {
  assert.throws(
    () => worldToDirectionLockScene({ bodies: [{ id: "anchor", position: { x: 0, y: 0 } }] }),
    /requires anchor and payload bodies/,
  );
});

test("direction-lock donor bridge requires an exact immutable donor revision", async () => {
  await assert.rejects(
    () => runUniversalCreationDirectionLock(".", { ucRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
