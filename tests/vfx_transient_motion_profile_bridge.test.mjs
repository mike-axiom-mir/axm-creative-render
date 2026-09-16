import test from "node:test";
import assert from "node:assert/strict";

import { selectTransientImpulseMotionProfile } from "../src/vfx_transient_motion_profile_bridge.mjs";

function observation() {
  return {
    canonical_event_hash: "event-hash",
    field_geometry_hash: "field-hash",
    envelope_sha256: "envelope-hash",
    canvas: {
      renderer: "axm.vfx.transient-impulse-canvas2d/v0.1",
      media_type: "text/html",
      artifact_sha256: "canvas-artifact",
    },
    static: {
      renderer: "axm.vfx.transient-impulse-static-svg/v0.1",
      media_type: "image/svg+xml",
      artifact_sha256: "static-artifact",
    },
  };
}

test("caller can select either derived motion profile without changing shared lineage", () => {
  const observed = observation();
  const before = JSON.stringify(observed);
  const full = selectTransientImpulseMotionProfile(observed, "full-motion");
  const motionFree = selectTransientImpulseMotionProfile(observed, "motion-free");

  assert.equal(full.renderer, "axm.vfx.transient-impulse-canvas2d/v0.1");
  assert.equal(motionFree.renderer, "axm.vfx.transient-impulse-static-svg/v0.1");
  for (const selected of [full, motionFree]) {
    assert.equal(selected.canonical_event_hash, "event-hash");
    assert.equal(selected.field_geometry_hash, "field-hash");
    assert.equal(selected.envelope_sha256, "envelope-hash");
    assert.equal(selected.authority, "DERIVED_REPLACEABLE_VISUAL_REALIZATION_SELECTION");
    assert.equal(Object.isFrozen(selected), true);
  }
  assert.equal(JSON.stringify(observed), before);
});

test("motion-profile selection fails closed on an undeclared preference", () => {
  assert.throws(
    () => selectTransientImpulseMotionProfile(observation(), "auto"),
    /motion profile must be 'full-motion' or 'motion-free'/,
  );
});
