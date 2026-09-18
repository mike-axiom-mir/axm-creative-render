import test from "node:test";
import assert from "node:assert/strict";

import { phaseLinkedCurveFlickerSampleToAxmScene } from "../src/vfx_phase_linked_curve_flicker_native_bridge.mjs";

function retained() {
  return {
    parameterCurveSource: {
      schema: "axm.parameter-curve-source/v0.1",
      id: "curve",
      domain: "normalized-time",
      wrapMode: "loop",
      keyframes: [
        { t: 0, value: 0.1, interpolation: "linear" },
        { t: 1, value: 0.1, interpolation: "linear" },
      ],
      provenance: { sourceReuse: "none" },
    },
    parameterCurveSourceHash: "curve-hash",
    flickerCycleSource: {
      schema: "axm.flicker-cycle-source/v0.1",
      id: "flicker",
      algorithm: "periodic-slot-noise1d/v0.1",
      phaseDomain: "normalized-cycle",
      wrapMode: "loop",
      interpolation: "smoothstep3",
      slotDerivation: "axm.hashValue-sha256-first52/v0.1",
      seed: 1,
      slotCount: 8,
      minValue: 0,
      maxValue: 1,
      responsePower: 1,
      phaseOffset: 0,
      provenance: { sourceReuse: "none" },
    },
    flickerCycleSourceHash: "flicker-hash",
    phaseRelationshipSource: {
      schema: "axm.phase-relationship-source/v0.1",
      id: "relationship",
      algorithm: "integer-cycle-phase-relationship1d/v0.1",
      phaseDomain: "normalized-group-cycle",
      wrapMode: "loop",
      relationshipRule: "channel-phase=wrap(group-phase*cycles-per-group+phase-offset)",
      channels: [
        { id: "curve", cyclesPerGroup: 1, phaseOffset: 0 },
        { id: "flicker", cyclesPerGroup: 2, phaseOffset: 0.25 },
      ],
      provenance: { sourceReuse: "none" },
    },
    phaseRelationshipSourceHash: "relationship-hash",
  };
}

function sample(curveValue = 0.2, flickerValue = 0.7) {
  return {
    schema: "axm.phase-linked-curve-flicker-sample/v0.1",
    mapping: "relationship-channel-phase-to-independent-donor-sample",
    combination: "none",
    schedulerAuthority: "none",
    phaseSelection: "derived-only",
    phaseRelationshipSourceHash: "relationship-hash",
    phaseSetHash: "phase-set-hash",
    parameterCurveSourceHash: "curve-hash",
    flickerCycleSourceHash: "flicker-hash",
    groupPhase: 0.2,
    curve: { channelId: "curve", phase: 0.2, value: curveValue },
    flicker: { channelId: "flicker", phase: 0.65, value: flickerValue },
    derived: true,
    rebuildable: true,
    sampleHash: `sample-${curveValue}-${flickerValue}`,
  };
}

test("phase-linked observer keeps geometry fixed and values separate", () => {
  const first = phaseLinkedCurveFlickerSampleToAxmScene(retained(), sample(0.2, 0.7));
  const second = phaseLinkedCurveFlickerSampleToAxmScene(retained(), sample(0.8, 0.1));
  assert.equal(first.observation.geometry_sha256, second.observation.geometry_sha256);
  assert.notEqual(first.observation.output_sha256, second.observation.output_sha256);
  assert.deepEqual(first.scene.triangles.map((triangle) => triangle.vertices), second.scene.triangles.map((triangle) => triangle.vertices));
  assert.notDeepEqual(first.scene.triangles.map((triangle) => triangle.albedo), second.scene.triangles.map((triangle) => triangle.albedo));
  assert.equal(first.observation.geometry_encodes_values, false);
  assert.equal(first.observation.albedo_encodes_only_independent_donor_values, true);
  assert.equal(first.observation.values_combined, false);
  assert.equal(first.observation.scheduler_authority_acquired, false);
  assert.equal(first.observation.consumer_semantics_assigned, false);
});

test("phase-linked observer treats capacity as structural and fails one below", () => {
  const exact = phaseLinkedCurveFlickerSampleToAxmScene(retained(), sample(), { maxSignals: 2 });
  const roomy = phaseLinkedCurveFlickerSampleToAxmScene(retained(), sample(), { maxSignals: 16 });
  assert.equal(exact.observation.output_sha256, roomy.observation.output_sha256);
  assert.throws(
    () => phaseLinkedCurveFlickerSampleToAxmScene(retained(), sample(), { maxSignals: 1 }),
    /signal budget exceeded: 2 > 1/,
  );
});

test("phase-linked observer rejects promoted, combined, scheduler, and lineage drift", () => {
  const promoted = sample();
  promoted.derived = false;
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), promoted), /derived rebuildable/);

  const combined = sample();
  combined.combination = "multiply";
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), combined), /combination semantics drifted/);

  const invented = sample();
  invented.combinedValue = 0.4;
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), invented), /refuses invented combinedValue authority/);

  const scheduler = sample();
  scheduler.schedulerAuthority = "consumer";
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), scheduler), /schedulerAuthority semantics drifted/);

  const lineage = sample();
  lineage.flickerCycleSourceHash = "other";
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), lineage), /flicker lineage mismatch/);
});

test("phase-linked observer rejects ambiguous channels and out-of-domain values instead of clamping", () => {
  const ambiguous = sample();
  ambiguous.flicker.channelId = "curve";
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), ambiguous), /requires distinct curve and flicker channels/);

  const high = sample();
  high.curve.value = 1.1;
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), high), /curve value must remain within \[0,1\]/);

  const low = sample();
  low.flicker.value = -0.1;
  assert.throws(() => phaseLinkedCurveFlickerSampleToAxmScene(retained(), low), /flicker value must remain within \[0,1\]/);
});
