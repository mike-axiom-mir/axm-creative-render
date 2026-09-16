import test from "node:test";
import assert from "node:assert/strict";
import { runUniversalCreationConstraintActivity, worldToConstraintActivityScene } from "../src/uc_constraint_activity_native_bridge.mjs";
import { parseScene } from "../src/creative_scene_operator.mjs";

function world(payloadX = 0.55) {
  return {
    bodies: [
      { id: "anchor", position: { x: -0.65, y: -0.25 } },
      { id: "payload", position: { x: payloadX, y: 0.15 } },
    ],
  };
}

test("activity visualization is deterministic and changes only when observed positions change", () => {
  const a = worldToConstraintActivityScene(world());
  const b = worldToConstraintActivityScene(world());
  const moved = worldToConstraintActivityScene(world(-0.3));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, moved);
  const source = parseScene(a.toString("utf8"));
  const changed = parseScene(moved.toString("utf8"));
  assert.equal(source.triangles.length, 4);
  assert.equal(changed.triangles.length, 4);
  assert.deepEqual(source.triangles.slice(0, 2), changed.triangles.slice(0, 2));
  assert.notDeepEqual(source.triangles.slice(2), changed.triangles.slice(2));
  assert.deepEqual(source.triangles.map((item) => item.albedo), changed.triangles.map((item) => item.albedo));
});

test("activity bridge fails before donor access when revision identity is not exact", async () => {
  await assert.rejects(
    () => runUniversalCreationConstraintActivity("/definitely/missing", { ucRevision: "main" }),
    /40-character lowercase git SHA/,
  );
});

test("activity visualization rejects missing required bodies", () => {
  assert.throws(() => worldToConstraintActivityScene({ bodies: [] }), /lost body anchor/);
});
