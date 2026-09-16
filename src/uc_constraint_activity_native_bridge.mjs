import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const CONTRACT = "AXM_CREATIVE_UC_CONSTRAINT_ACTIVITY_NATIVE_RECEIPT";
const VERSION = 1;
const EXPECTED_GATE_VERSION = "0.3.0";
const EXPECTED_STEP_SCHEMA = "axm.uc-constraint-activity-step/v0.1";
const EXPECTED_FAMILIES = ["mounts", "distanceJoints", "distanceLimits", "axisLocks", "axisLimits"];

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
  if (!item) throw new Error(`activity proof lost body ${id}`);
  return { x: finite(item.position?.x, `${id} x`), y: finite(item.position?.y, `${id} y`) };
}

function formatNumber(value) {
  const number = finite(value, "scene coordinate");
  const normalized = Object.is(number, -0) ? 0 : number;
  return normalized.toFixed(6).replace(/\.?0+$/, "") || "0";
}

function quad(center, half, albedo) {
  const x0 = center.x - half, x1 = center.x + half, y0 = center.y - half, y1 = center.y + half;
  return [
    { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], albedo },
    { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], albedo },
  ];
}

export function worldToConstraintActivityScene(world) {
  const triangles = [
    ...quad(point(world, "anchor"), 0.09, [90, 110, 145]),
    ...quad(point(world, "payload"), 0.12, [224, 166, 72]),
  ];
  const lines = [
    "# Derived activity-gate visualization; caller physics state remains authoritative.",
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

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function assertStep(result, sourceStepIndex, activeCount, disabledCount) {
  if (result?.schema !== EXPECTED_STEP_SCHEMA || result?.ok !== true || result?.mode !== "ISOLATED_COMPOSER") {
    throw new Error("UC activity gate returned an unexpected step contract");
  }
  const activity = result.activityDiagnostics || {};
  if (activity.activeCount !== activeCount || activity.disabledCount !== disabledCount) {
    throw new Error("UC activity-gate active/disabled counts drifted");
  }
  if (activity.disabledExcludedFromSolve !== true || activity.disabledExcludedFromIsolationTopology !== true) {
    throw new Error("disabled constraints are no longer explicitly excluded from solve/topology");
  }
  if (result.world?.stepIndex !== sourceStepIndex + 1) {
    throw new Error("UC activity gate did not execute exactly one donor-core integration step");
  }
}

export async function runUniversalCreationConstraintActivity(root, options = {}) {
  const ucRevision = revision(options.ucRevision, "Universal Creation revision");
  const rootPath = resolve(root);
  const gatePath = resolve(rootPath, "capabilities/physics-core/uc-constraint-activity-gate.js");
  const corePath = resolve(rootPath, "capabilities/physics-core/source/axm-physics-core.js");
  const [gateSourceSha256, coreSourceSha256] = await Promise.all([digest(gatePath), digest(corePath)]);
  const require = createRequire(import.meta.url);
  const Gate = require(gatePath);
  const Core = require(corePath);

  if (Gate?.VERSION !== EXPECTED_GATE_VERSION || Gate?.STEP_SCHEMA !== EXPECTED_STEP_SCHEMA) {
    throw new Error(`expected UC activity gate ${EXPECTED_GATE_VERSION}/${EXPECTED_STEP_SCHEMA}`);
  }
  if (JSON.stringify(Gate.FAMILY_KEYS) !== JSON.stringify(EXPECTED_FAMILIES)) {
    throw new Error("UC activity-gate family boundary drifted");
  }
  if (typeof Gate.step !== "function" || typeof Gate.validate !== "function") throw new Error("UC activity-gate public surface unavailable");
  if (typeof Core?.createWorld !== "function" || typeof Core.addBody !== "function" || typeof Core.checksum !== "function") {
    throw new Error("UC donor physics-core public surface unavailable");
  }

  let sourceWorld = Core.createWorld({ gravity: { x: 0, y: 0 }, bounds: false, sleep: { enabled: false } });
  sourceWorld = Core.addBody(sourceWorld, { id: "anchor", type: "static", position: { x: -0.65, y: -0.25 } }).world;
  sourceWorld = Core.addBody(sourceWorld, {
    id: "payload", type: "dynamic", position: { x: 0.55, y: 0.15 }, mass: 1, linearDamping: 0,
  }).world;

  const retainedDisabled = {
    distanceJoints: [{ id: "retained-disabled-joint", a: "anchor", b: "payload", length: 9, enabled: false }],
    distanceLimits: [{ id: "retained-disabled-limit", a: "anchor", b: "payload", minLength: 8, enabled: false }],
    axisLocks: [],
    axisLimits: [],
  };
  const disabledRequest = {
    mounts: [{ id: "caller-mount", a: "anchor", b: "payload", offset: { x: 0.35, y: 0.25 }, enabled: false }],
    ...structuredClone(retainedDisabled),
  };
  const enabledRequest = {
    mounts: [{ id: "caller-mount", a: "anchor", b: "payload", offset: { x: 0.35, y: 0.25 }, enabled: true }],
    ...structuredClone(retainedDisabled),
  };

  const sourceWorldBytes = stableBytes(sourceWorld);
  const disabledRequestBytes = stableBytes(disabledRequest);
  const enabledRequestBytes = stableBytes(enabledRequest);
  const disabledValidation = Gate.validate(sourceWorld, disabledRequest);
  const enabledValidation = Gate.validate(sourceWorld, enabledRequest);
  if (disabledValidation?.ok !== true || disabledValidation.activeCount !== 0 || disabledValidation.disabledCount !== 3) {
    throw new Error(`disabled activity request validation failed: ${(disabledValidation?.errors || []).join("; ")}`);
  }
  if (enabledValidation?.ok !== true || enabledValidation.activeCount !== 1 || enabledValidation.disabledCount !== 2) {
    throw new Error(`enabled activity request validation failed: ${(enabledValidation?.errors || []).join("; ")}`);
  }

  const execute = (request) => Gate.step(structuredClone(sourceWorld), request, 0.01, { isolateCollisions: true });
  const disabled = execute(disabledRequest);
  const disabledReplay = execute(disabledRequest);
  const enabled = execute(enabledRequest);
  const enabledReplay = execute(enabledRequest);

  assertStep(disabled, sourceWorld.stepIndex, 0, 3);
  assertStep(enabled, sourceWorld.stepIndex, 1, 2);
  if (Core.checksum(disabled.world) !== Core.checksum(disabledReplay.world) || Core.checksum(enabled.world) !== Core.checksum(enabledReplay.world)) {
    throw new Error("UC activity-gate same-runtime replay verification failed");
  }
  if (disabled.isolationDiagnostics?.componentCount !== 0 || disabled.isolationDiagnostics?.appliedComponents !== 0) {
    throw new Error("disabled constraints entered collision-isolation topology");
  }
  if (enabled.isolationDiagnostics?.componentCount !== 1 || enabled.isolationDiagnostics?.appliedComponents !== 1) {
    throw new Error("enabled mount did not enter collision-isolation topology");
  }
  if (JSON.stringify(disabled.activityDiagnostics?.disabledIds?.mounts) !== JSON.stringify(["caller-mount"])) {
    throw new Error("disabled mount identity was not retained in evidence");
  }
  if (JSON.stringify(enabled.activityDiagnostics?.activeIds?.mounts) !== JSON.stringify(["caller-mount"])) {
    throw new Error("enabled mount identity was not delegated");
  }
  const enabledMountError = Number(enabled.composerDiagnostics?.after?.maxMountError);
  if (!Number.isFinite(enabledMountError) || enabledMountError > 1e-8) {
    throw new Error("enabled mount did not converge inside proof tolerance");
  }

  if (Buffer.compare(sourceWorldBytes, stableBytes(sourceWorld)) !== 0 ||
      Buffer.compare(disabledRequestBytes, stableBytes(disabledRequest)) !== 0 ||
      Buffer.compare(enabledRequestBytes, stableBytes(enabledRequest)) !== 0) {
    throw new Error("activity-gate execution mutated caller source state or requests");
  }

  const sourcePayload = point(sourceWorld, "payload");
  const disabledPayload = point(disabled.world, "payload");
  const enabledPayload = point(enabled.world, "payload");
  const disabledDelta = distance(sourcePayload, disabledPayload);
  const enabledDelta = distance(sourcePayload, enabledPayload);
  if (disabledDelta > 1e-12) throw new Error(`disabled constraints moved payload by ${disabledDelta}`);
  if (!(enabledDelta > 0.25)) throw new Error("enabled fixture did not create observable constrained motion");

  const sourceSceneBytes = worldToConstraintActivityScene(sourceWorld);
  const disabledSceneBytes = worldToConstraintActivityScene(disabled.world);
  const enabledSceneBytes = worldToConstraintActivityScene(enabled.world);
  if (sha256(sourceSceneBytes) !== sha256(disabledSceneBytes)) throw new Error("disabled branch changed derived visualization bytes");
  if (sha256(sourceSceneBytes) === sha256(enabledSceneBytes)) throw new Error("enabled branch did not change derived visualization bytes");

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
      physics_core_source_sha256: coreSourceSha256,
    },
    caller_authority: {
      source_world_sha256: sha256(sourceWorldBytes),
      disabled_request_sha256: sha256(disabledRequestBytes),
      enabled_request_sha256: sha256(enabledRequestBytes),
      source_state_mutated: false,
      constraint_requests_mutated: false,
      explicit_toggle_only: true,
    },
    disabled_branch: {
      mode: disabled.mode,
      active_count: disabled.activityDiagnostics.activeCount,
      disabled_count: disabled.activityDiagnostics.disabledCount,
      disabled_ids: structuredClone(disabled.activityDiagnostics.disabledIds),
      disabled_excluded_from_solve: disabled.activityDiagnostics.disabledExcludedFromSolve,
      disabled_excluded_from_isolation_topology: disabled.activityDiagnostics.disabledExcludedFromIsolationTopology,
      isolation_component_count: disabled.isolationDiagnostics.componentCount,
      isolation_applied_components: disabled.isolationDiagnostics.appliedComponents,
      final_checksum: Core.checksum(disabled.world),
      repeat_verification: "PASS",
      payload_position: disabledPayload,
      payload_translation_from_source: disabledDelta,
    },
    enabled_branch: {
      mode: enabled.mode,
      active_count: enabled.activityDiagnostics.activeCount,
      disabled_count: enabled.activityDiagnostics.disabledCount,
      active_ids: structuredClone(enabled.activityDiagnostics.activeIds),
      disabled_ids: structuredClone(enabled.activityDiagnostics.disabledIds),
      isolation_component_count: enabled.isolationDiagnostics.componentCount,
      isolation_applied_components: enabled.isolationDiagnostics.appliedComponents,
      max_mount_error_after_stabilization: enabledMountError,
      final_checksum: Core.checksum(enabled.world),
      repeat_verification: "PASS",
      payload_position: enabledPayload,
      payload_translation_from_source: enabledDelta,
    },
    outputs: {
      source_scene: { sha256: sha256(sourceSceneBytes), authority: "DERIVED_SOURCE_VISUALIZATION" },
      disabled_scene: { sha256: sha256(disabledSceneBytes), authority: "DERIVED_DISABLED_BRANCH_VISUALIZATION" },
      enabled_scene: { sha256: sha256(enabledSceneBytes), authority: "DERIVED_ENABLED_BRANCH_VISUALIZATION" },
      source_and_disabled_scene_bytes_equal: true,
      enabled_scene_differs: true,
    },
    truth_boundary: {
      proves: "the pinned current UC activity gate retains disabled five-family constraint definitions as validated evidence while excluding them from solving and isolation topology, delegates an explicitly enabled mount through exactly one donor-core step, preserves caller source/request bytes, and produces replaceable visual evidence where the disabled branch stays byte-identical to the source scene while the enabled branch changes",
      does_not_prove: "direction-lock activity gating, general collision correctness, rotating/local-axis constraints, angular joints, 3D physics, scientific validity, gameplay quality, aesthetic quality, real-time performance or cross-machine bitwise determinism",
      canonical_authority: "caller source world plus explicit enabled/disabled constraint requests",
      derived_replaceable: ["simulated branch worlds", "AXM_SCENE 1 visualizations", "render requests", "render receipts", "pixels"],
    },
  };

  return { sourceSceneBytes, disabledSceneBytes, enabledSceneBytes, receipt };
}
