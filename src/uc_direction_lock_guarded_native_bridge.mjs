import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const CONTRACT = "AXM_CREATIVE_UC_DIRECTION_LOCK_GUARDED_NATIVE_RECEIPT";
const VERSION = 1;
const EXPECTED_GATE_VERSION = "0.4.0";
const EXPECTED_STEP_SCHEMA = "axm.uc-constraint-activity-step/v0.1";
const EXPECTED_FAMILIES = ["mounts", "distanceJoints", "distanceLimits", "axisLocks", "axisLimits", "directionLocks"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stableBytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");

function revision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function body(world, id) {
  return world?.bodies?.find((item) => item.id === id) || null;
}

function point(world, id) {
  const item = body(world, id);
  if (!item) throw new Error(`guarded direction-lock proof lost body ${id}`);
  return { x: finite(item.position?.x, `${id} x`), y: finite(item.position?.y, `${id} y`) };
}

function hasPairContact(world, a, b) {
  return (world?.contacts || []).some((contact) =>
    (contact.a === a && contact.b === b) || (contact.a === b && contact.b === a));
}

function formatNumber(value) {
  const number = finite(value, "scene coordinate");
  const normalized = Object.is(number, -0) ? 0 : number;
  return normalized.toFixed(6).replace(/\.?0+$/, "") || "0";
}

function quad(center, half, albedo) {
  const x0 = center.x - half;
  const x1 = center.x + half;
  const y0 = center.y - half;
  const y1 = center.y + half;
  return [
    { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], albedo },
    { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], albedo },
  ];
}

export function worldToGuardedDirectionLockScene(world) {
  const triangles = [
    ...quad(point(world, "root"), 0.09, [90, 110, 145]),
    ...quad(point(world, "payload"), 0.12, [224, 166, 72]),
  ];
  const lines = [
    "# Derived guarded direction-lock visualization; caller physics state remains authoritative.",
    "AXM_SCENE 1",
  ];
  for (const triangle of triangles) {
    lines.push(`triangle ${[...triangle.vertices.flat().map(formatNumber), ...triangle.albedo].join(" ")}`);
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

async function digest(path) {
  return sha256(await readFile(path));
}

function assertGateStep(result, sourceStepIndex, expectedActive, expectedDisabled) {
  if (result?.schema !== EXPECTED_STEP_SCHEMA || result?.ok !== true || result?.mode !== "ISOLATED_COMPOSER") {
    throw new Error("UC guarded direction-lock path returned an unexpected activity step contract");
  }
  const activity = result.activityDiagnostics || {};
  if (activity.activeCount !== expectedActive || activity.disabledCount !== expectedDisabled) {
    throw new Error("UC guarded direction-lock active/disabled counts drifted");
  }
  if (activity.disabledExcludedFromSolve !== true || activity.disabledExcludedFromIsolationTopology !== true) {
    throw new Error("UC activity gate no longer explicitly excludes disabled constraints from solve/topology");
  }
  if (result.world?.stepIndex !== sourceStepIndex + 1) {
    throw new Error("UC guarded direction-lock path did not execute exactly one donor-core integration step");
  }
}

export async function runUniversalCreationGuardedDirectionLock(root, options = {}) {
  const ucRevision = revision(options.ucRevision, "Universal Creation revision");
  const rootPath = resolve(root);
  const gatePath = resolve(rootPath, "capabilities/physics-core/uc-constraint-activity-gate.js");
  const isolationPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-collision-isolation.js");
  const composerPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-composer.js");
  const corePath = resolve(rootPath, "capabilities/physics-core/source/axm-physics-core.js");
  const [gateSourceSha256, isolationSourceSha256, composerSourceSha256, coreSourceSha256] = await Promise.all([
    digest(gatePath), digest(isolationPath), digest(composerPath), digest(corePath),
  ]);

  const require = createRequire(import.meta.url);
  const Gate = require(gatePath);
  const Core = require(corePath);

  if (Gate?.VERSION !== EXPECTED_GATE_VERSION || Gate?.STEP_SCHEMA !== EXPECTED_STEP_SCHEMA) {
    throw new Error(`expected UC activity gate ${EXPECTED_GATE_VERSION}/${EXPECTED_STEP_SCHEMA}, got ${String(Gate?.VERSION)}/${String(Gate?.STEP_SCHEMA)}`);
  }
  if (JSON.stringify(Gate.FAMILY_KEYS) !== JSON.stringify(EXPECTED_FAMILIES)) {
    throw new Error("UC activity-gate six-family boundary drifted");
  }
  if (typeof Gate.step !== "function" || typeof Gate.validate !== "function") {
    throw new Error("UC activity-gate public step/validate surface unavailable");
  }
  if (typeof Core?.createWorld !== "function" || typeof Core.addBody !== "function" || typeof Core.checksum !== "function") {
    throw new Error("UC donor physics-core public surface unavailable");
  }

  let sourceWorld = Core.createWorld({ gravity: { x: 0, y: 0 }, bounds: false, sleep: { enabled: false } });
  sourceWorld = Core.addBody(sourceWorld, {
    id: "root", type: "static", shape: { kind: "circle", radius: 1 }, position: { x: 0, y: 0 },
  }).world;
  sourceWorld = Core.addBody(sourceWorld, {
    id: "payload", type: "dynamic", shape: { kind: "circle", radius: 1 }, position: { x: 0.5, y: 0 }, mass: 1, linearDamping: 0,
  }).world;

  const requestedOffset = 0.75;
  const disabledRequest = {
    directionLocks: [{ id: "caller-diagonal", a: "root", b: "payload", direction: { x: 1, y: 1 }, offset: requestedOffset, enabled: false }],
  };
  const enabledRequest = {
    directionLocks: [{ id: "caller-diagonal", a: "root", b: "payload", direction: { x: 1, y: 1 }, offset: requestedOffset, enabled: true }],
  };

  const sourceWorldBytes = stableBytes(sourceWorld);
  const disabledRequestBytes = stableBytes(disabledRequest);
  const enabledRequestBytes = stableBytes(enabledRequest);

  const disabledValidation = Gate.validate(sourceWorld, disabledRequest);
  const enabledValidation = Gate.validate(sourceWorld, enabledRequest);
  if (disabledValidation?.ok !== true || disabledValidation.activeCount !== 0 || disabledValidation.disabledCount !== 1) {
    throw new Error(`disabled direction-lock validation failed: ${(disabledValidation?.errors || []).join("; ")}`);
  }
  if (enabledValidation?.ok !== true || enabledValidation.activeCount !== 1 || enabledValidation.disabledCount !== 0) {
    throw new Error(`enabled direction-lock validation failed: ${(enabledValidation?.errors || []).join("; ")}`);
  }

  const invalidDisabled = Gate.validate(sourceWorld, {
    directionLocks: [{ id: "invalid-disabled", a: "root", b: "missing", direction: { x: 1, y: 1 }, enabled: false }],
  });
  if (invalidDisabled?.ok !== false || !String((invalidDisabled?.errors || []).join(" ")).toLowerCase().includes("body")) {
    throw new Error("disabled direction lock no longer fails closed on invalid body references");
  }

  const execute = (request) => Gate.step(structuredClone(sourceWorld), request, 0.01, { isolateCollisions: true });
  const disabled = execute(disabledRequest);
  const disabledReplay = execute(disabledRequest);
  const enabled = execute(enabledRequest);
  const enabledReplay = execute(enabledRequest);

  assertGateStep(disabled, sourceWorld.stepIndex, 0, 1);
  assertGateStep(enabled, sourceWorld.stepIndex, 1, 0);

  if (Core.checksum(disabled.world) !== Core.checksum(disabledReplay.world) ||
      Core.checksum(enabled.world) !== Core.checksum(enabledReplay.world)) {
    throw new Error("UC guarded direction-lock same-runtime replay verification failed");
  }
  if (JSON.stringify(disabled.activityDiagnostics?.disabledIds?.directionLocks) !== JSON.stringify(["caller-diagonal"])) {
    throw new Error("disabled direction-lock identity was not retained in activity evidence");
  }
  if (JSON.stringify(enabled.activityDiagnostics?.activeIds?.directionLocks) !== JSON.stringify(["caller-diagonal"])) {
    throw new Error("enabled direction-lock identity was not delegated through activity evidence");
  }

  if (disabled.isolationDiagnostics?.componentCount !== 0 || disabled.isolationDiagnostics?.appliedComponents !== 0) {
    throw new Error("disabled direction lock entered collision-isolation topology");
  }
  if (enabled.isolationDiagnostics?.componentCount !== 1 || enabled.isolationDiagnostics?.appliedComponents !== 1) {
    throw new Error("enabled direction lock did not enter one collision-isolation component");
  }
  const isolationReceipt = enabled.isolationDiagnostics?.receipts?.[0];
  if (isolationReceipt?.applied !== true || isolationReceipt?.temporaryGroup !== -1 || enabled.isolationDiagnostics?.groupsRestored !== true) {
    throw new Error("enabled direction-lock isolation did not apply and restore its deterministic temporary collision group");
  }

  const disabledCoreContact = hasPairContact(disabled.core?.worldAsIntegratedWithTemporaryGroups, "root", "payload");
  const enabledCoreContact = hasPairContact(enabled.core?.worldAsIntegratedWithTemporaryGroups, "root", "payload");
  if (!disabledCoreContact) throw new Error("disabled direction lock unexpectedly suppressed ordinary donor-core contact");
  if (enabledCoreContact) throw new Error("enabled isolated direction lock failed to suppress in-component donor-core contact");

  const disabledResidual = finite(disabled.composerDiagnostics?.after?.maxDirectionLockError, "disabled direction-lock residual");
  const enabledResidual = finite(enabled.composerDiagnostics?.after?.maxDirectionLockError, "enabled direction-lock residual");
  if (Math.abs(disabledResidual) > 1e-12) throw new Error("disabled direction lock entered composer residual solving");
  if (Math.abs(enabledResidual) > 1e-8) throw new Error(`enabled direction-lock projection residual exceeded proof tolerance: ${enabledResidual}`);

  for (const id of ["root", "payload"]) {
    const finalBody = body(enabled.world, id);
    if (!finalBody || Number(finalBody.collision?.group || 0) !== 0) {
      throw new Error(`caller collision group for ${id} was not restored`);
    }
  }

  if (Buffer.compare(sourceWorldBytes, stableBytes(sourceWorld)) !== 0 ||
      Buffer.compare(disabledRequestBytes, stableBytes(disabledRequest)) !== 0 ||
      Buffer.compare(enabledRequestBytes, stableBytes(enabledRequest)) !== 0) {
    throw new Error("guarded direction-lock execution mutated caller source state or requests");
  }

  const sourceSceneBytes = worldToGuardedDirectionLockScene(sourceWorld);
  const disabledSceneBytes = worldToGuardedDirectionLockScene(disabled.world);
  const enabledSceneBytes = worldToGuardedDirectionLockScene(enabled.world);
  if (sha256(disabledSceneBytes) === sha256(enabledSceneBytes)) {
    throw new Error("guarded direction-lock disabled/enabled branches did not produce distinct derived visualization state");
  }

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-universal-creation",
      revision: ucRevision,
      activity_gate_version: Gate.VERSION,
      activity_gate_step_schema: Gate.STEP_SCHEMA,
      activity_gate_family_keys: [...Gate.FAMILY_KEYS],
      physics_core_version: String(Core.VERSION),
      activity_gate_source_sha256: gateSourceSha256,
      collision_isolation_source_sha256: isolationSourceSha256,
      constraint_composer_source_sha256: composerSourceSha256,
      physics_core_source_sha256: coreSourceSha256,
    },
    caller_authority: {
      source_world_sha256: sha256(sourceWorldBytes),
      disabled_request_sha256: sha256(disabledRequestBytes),
      enabled_request_sha256: sha256(enabledRequestBytes),
      source_state_mutated: false,
      constraint_requests_mutated: false,
      explicit_toggle_only: true,
      invalid_disabled_body_reference_rejected: true,
    },
    disabled_branch: {
      active_count: disabled.activityDiagnostics.activeCount,
      disabled_count: disabled.activityDiagnostics.disabledCount,
      disabled_ids: structuredClone(disabled.activityDiagnostics.disabledIds),
      disabled_excluded_from_solve: disabled.activityDiagnostics.disabledExcludedFromSolve,
      disabled_excluded_from_isolation_topology: disabled.activityDiagnostics.disabledExcludedFromIsolationTopology,
      isolation_component_count: disabled.isolationDiagnostics.componentCount,
      isolation_applied_components: disabled.isolationDiagnostics.appliedComponents,
      donor_core_contact_present: disabledCoreContact,
      max_direction_lock_error_after_stabilization: disabledResidual,
      final_checksum: Core.checksum(disabled.world),
      repeat_verification: "PASS",
      payload_position: point(disabled.world, "payload"),
    },
    enabled_branch: {
      active_count: enabled.activityDiagnostics.activeCount,
      disabled_count: enabled.activityDiagnostics.disabledCount,
      active_ids: structuredClone(enabled.activityDiagnostics.activeIds),
      isolation_component_count: enabled.isolationDiagnostics.componentCount,
      isolation_applied_components: enabled.isolationDiagnostics.appliedComponents,
      temporary_group: isolationReceipt.temporaryGroup,
      groups_restored: enabled.isolationDiagnostics.groupsRestored,
      donor_core_contact_present: enabledCoreContact,
      max_direction_lock_error_after_stabilization: enabledResidual,
      requested_offset: requestedOffset,
      final_checksum: Core.checksum(enabled.world),
      repeat_verification: "PASS",
      payload_position: point(enabled.world, "payload"),
    },
    outputs: {
      source_scene: { sha256: sha256(sourceSceneBytes), authority: "DERIVED_SOURCE_VISUALIZATION" },
      disabled_scene: { sha256: sha256(disabledSceneBytes), authority: "DERIVED_DISABLED_BRANCH_VISUALIZATION" },
      enabled_scene: { sha256: sha256(enabledSceneBytes), authority: "DERIVED_ENABLED_BRANCH_VISUALIZATION" },
      disabled_and_enabled_scenes_differ: true,
    },
    truth_boundary: {
      proves: "the pinned current UC activity gate now treats fixed world-space direction locks as a guarded family: disabled definitions remain validated evidence but are excluded from solving and collision-isolation topology, while an explicitly enabled direction lock enters component isolation, suppresses in-component contact only during the donor-core collision stage, restores caller collision groups, stabilizes the selected projection, preserves caller bytes, and repeats deterministically in one runtime",
      does_not_prove: "full prismatic or slider joints, rotating/local-axis constraints, edge-only collision suppression, general collision correctness, angular joints or motors, 3D physics, scientific validity, gameplay quality, aesthetic quality, real-time performance or cross-machine bitwise determinism",
      canonical_authority: "caller source world plus explicit enabled/disabled direction-lock requests",
      derived_replaceable: ["simulated branch worlds", "AXM_SCENE 1 visualizations", "render requests", "render receipts", "pixels"],
    },
  };

  return { sourceSceneBytes, disabledSceneBytes, enabledSceneBytes, receipt };
}
