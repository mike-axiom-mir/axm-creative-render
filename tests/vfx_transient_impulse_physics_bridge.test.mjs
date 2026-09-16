import test from "node:test";
import assert from "node:assert/strict";

import { transientImpulseEventToPhysicsAction } from "../src/vfx_transient_impulse_physics_bridge.mjs";

function event(overrides = {}) {
  return {
    schema: "axm.transient-impulse-event/v0.1",
    id: "unit-impulse",
    kind: "transient-impulse",
    seed: 1,
    origin: [0.5, 0.5],
    direction: [0.8, 0.6],
    energy: 0.9,
    radius: 0.25,
    duration: 0.8,
    controls: {},
    ...overrides,
  };
}

test("normalized neutral VFX event maps deterministically to explicit UC apply-impulse action", () => {
  const first = transientImpulseEventToPhysicsAction(event(), { impulseScale: 0.7 });
  const second = transientImpulseEventToPhysicsAction(event(), { impulseScale: 0.7 });
  assert.deepEqual(first, second);
  assert.equal(first.action.kind, "apply-impulse");
  assert.equal(first.action.bodyId, "surface-proxy");
  assert.equal(first.action.atStep, 1);
  assert.ok(Math.abs(first.action.impulse.x - 0.504) < 1e-12);
  assert.ok(Math.abs(first.action.impulse.y - 0.378) < 1e-12);
  assert.equal(first.observation.vfx_declares_physics_semantics, false);
  assert.equal(first.observation.derived_field_geometry_used_as_collision_or_force_data, false);
  assert.equal(first.observation.consumer_owns_mapping, true);
});

test("adapter rejects a VFX event that was not normalized by the donor", () => {
  assert.throws(
    () => transientImpulseEventToPhysicsAction(event({ direction: [2, 0] }), { impulseScale: 0.7 }),
    /must already be normalized/,
  );
});

test("adapter rejects wrong schema and refuses unbounded consumer scale", () => {
  assert.throws(
    () => transientImpulseEventToPhysicsAction(event({ schema: "made-up-event/v9" })),
    /requires normalized axm\.transient-impulse-event\/v0\.1/,
  );
  assert.throws(
    () => transientImpulseEventToPhysicsAction(event(), { impulseScale: 99 }),
    /consumer impulse scale must be in/,
  );
});
