import test from "node:test";
import assert from "node:assert/strict";

import { phaseRelationshipSetToAxmScene } from "../src/vfx_phase_relationship_native_bridge.mjs";

const sourceHash = "retained-phase-source-hash";
function source() {
  return {
    schema: "axm.phase-relationship-source/v0.1",
    id: "test-phase-group",
    algorithm: "integer-cycle-phase-relationship1d/v0.1",
    phaseDomain: "normalized-group-cycle",
    wrapMode: "loop",
    relationshipRule: "channel-phase=wrap(group-phase*cycles-per-group+phase-offset)",
    channels: [
      { id: "fast", cyclesPerGroup: 3, phaseOffset: 0.5 },
      { id: "slow", cyclesPerGroup: 1, phaseOffset: 0 },
    ],
    provenance: { sourceReuse: "none" },
  };
}

function set(phases = [0.2, 0.7]) {
  return {
    schema: "axm.phase-relationship-set/v0.1",
    sourceHash,
    groupPhase: 0.2,
    channels: [
      { id: "fast", phase: phases[0] },
      { id: "slow", phase: phases[1] },
    ],
    derived: true,
    rebuildable: true,
    phaseSetHash: `set-${phases.join("-")}`,
  };
}

test("phase relationship observer keeps geometry fixed while donor phases change only neutral albedo", () => {
  const first = phaseRelationshipSetToAxmScene(source(), sourceHash, set([0.1, 0.4]));
  const second = phaseRelationshipSetToAxmScene(source(), sourceHash, set([0.8, 0.9]));
  assert.equal(first.observation.geometry_sha256, second.observation.geometry_sha256);
  assert.notEqual(first.observation.output_sha256, second.observation.output_sha256);
  assert.deepEqual(first.scene.triangles.map((triangle) => triangle.vertices), second.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(first.scene.triangles.map((triangle) => triangle.albedo), second.scene.triangles.map((triangle) => triangle.albedo));
  assert.equal(first.observation.geometry_encodes_phase, false);
  assert.equal(first.observation.albedo_encodes_only_donor_derived_channel_phase, true);
  assert.equal(first.observation.consumer_semantics_assigned, false);
});

test("phase relationship observer treats channel capacity as structural and fails one below", () => {
  const exact = phaseRelationshipSetToAxmScene(source(), sourceHash, set(), { maxChannels: 2 });
  const roomy = phaseRelationshipSetToAxmScene(source(), sourceHash, set(), { maxChannels: 32 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(
    () => phaseRelationshipSetToAxmScene(source(), sourceHash, set(), { maxChannels: 1 }),
    /integer within \[2,32\]/,
  );
});

test("phase relationship observer rejects authority, semantics, and lineage drift", () => {
  const promoted = set();
  promoted.derived = false;
  assert.throws(() => phaseRelationshipSetToAxmScene(source(), sourceHash, promoted), /derived rebuildable/);

  const semantics = source();
  semantics.wrapMode = "clamp";
  assert.throws(() => phaseRelationshipSetToAxmScene(semantics, sourceHash, set()), /wrapMode drifted/);

  const lineage = set();
  lineage.sourceHash = "other-source";
  assert.throws(() => phaseRelationshipSetToAxmScene(source(), sourceHash, lineage), /source lineage mismatch/);
});

test("phase relationship observer rejects channel ordering and out-of-range derived phases", () => {
  const ordering = set();
  ordering.channels[0].id = "wrong";
  assert.throws(() => phaseRelationshipSetToAxmScene(source(), sourceHash, ordering), /lineage\/order mismatch/);

  const phase = set();
  phase.channels[1].phase = 1;
  assert.throws(() => phaseRelationshipSetToAxmScene(source(), sourceHash, phase), /must remain within \[0,1\)/);
});
