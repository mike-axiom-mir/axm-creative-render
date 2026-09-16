import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const CONTRACT = "AXM_CREATIVE_UC_CONSTRAINT_PREFLIGHT_GUARD_NATIVE_RECEIPT";
const VERSION = 1;
const EXPECTED_GUARD_VERSION = "0.1.0";
const EXPECTED_STEP_SCHEMA = "axm.uc-constraint-preflight-guard-step/v0.1";

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
  if (!item) throw new Error(`constraint preflight guard proof lost body ${id}`);
  return { x: finite(item.position?.x, `${id} x`), y: finite(item.position?.y, `${id} y`) };
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

export function worldToConstraintPreflightGuardScene(world) {
  const triangles = [
    ...quad(point(world, "root"), 0.09, [90, 110, 145]),
    ...quad(point(world, "payload"), 0.12, [224, 166, 72]),
  ];
  const lines = [
    "# Derived constraint-preflight observation; caller physics state remains authoritative.",
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

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runUniversalCreationConstraintPreflightGuard(root, options = {}) {
  const ucRevision = revision(options.ucRevision, "Universal Creation revision");
  const rootPath = resolve(root);
  const guardPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-preflight-guard.js");
  const preflightPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-preflight.js");
  const composerPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-composer.js");
  const corePath = resolve(rootPath, "capabilities/physics-core/source/axm-physics-core.js");
  const [guardSourceSha256, preflightSourceSha256, composerSourceSha256, coreSourceSha256] = await Promise.all([
    digest(guardPath), digest(preflightPath), digest(composerPath), digest(corePath),
  ]);

  const require = createRequire(import.meta.url);
  const Guard = require(guardPath);
  const Composer = require(composerPath);
  const Core = require(corePath);

  if (Guard?.VERSION !== EXPECTED_GUARD_VERSION || Guard?.STEP_SCHEMA !== EXPECTED_STEP_SCHEMA) {
    throw new Error(`expected UC preflight guard ${EXPECTED_GUARD_VERSION}/${EXPECTED_STEP_SCHEMA}, got ${String(Guard?.VERSION)}/${String(Guard?.STEP_SCHEMA)}`);
  }
  if (typeof Guard.step !== "function" || typeof Composer?.step !== "function" || typeof Core?.checksum !== "function") {
    throw new Error("UC preflight-guard/composer/core public surface unavailable");
  }

  let sourceWorld = Core.createWorld({ gravity: { x: 0, y: 0 }, bounds: false, sleep: { enabled: false } });
  sourceWorld = Core.addBody(sourceWorld, {
    id: "root", type: "static", shape: { kind: "circle", radius: 0.2 }, position: { x: 0, y: 0 },
  }).world;
  sourceWorld = Core.addBody(sourceWorld, {
    id: "payload", type: "dynamic", shape: { kind: "circle", radius: 0.2 }, position: { x: 3, y: 2 }, mass: 1, linearDamping: 0,
  }).world;

  const blockedRequest = {
    mounts: [{ id: "caller-mount", a: "root", b: "payload", offset: { x: 0, y: 2 } }],
    axisLocks: [{ id: "caller-conflicting-x", a: "root", b: "payload", axis: "x", offset: 1 }],
  };
  const acceptedRequest = {
    axisLocks: [
      { id: "caller-x-target", a: "root", b: "payload", axis: "x", offset: 0.5 },
      { id: "caller-y-target", a: "root", b: "payload", axis: "y", offset: 0.25 },
    ],
  };
  const invalidRequest = {
    distanceJoints: [{ id: "caller-invalid-distance", a: "root", b: "missing", length: 1 }],
  };
  const unsupportedDistanceRequest = {
    distanceJoints: [{ id: "caller-distance", a: "root", b: "payload", length: Math.sqrt(13) }],
  };
  const composerOptions = { prePasses: 1, postPasses: 1, earlyExit: true };
  const dt = 1 / 60;

  const sourceWorldBytes = stableBytes(sourceWorld);
  const requestBytes = {
    blocked: stableBytes(blockedRequest),
    accepted: stableBytes(acceptedRequest),
    invalid: stableBytes(invalidRequest),
    unsupportedDistance: stableBytes(unsupportedDistanceRequest),
  };

  const executeBlocked = () => Guard.step(structuredClone(sourceWorld), structuredClone(blockedRequest), dt);
  const blocked = executeBlocked();
  const blockedReplay = executeBlocked();
  if (blocked?.schema !== EXPECTED_STEP_SCHEMA || blocked?.accepted !== false || blocked?.blocked !== true || blocked?.reason !== "PROVABLE_LOCAL_CONFLICT") {
    throw new Error("UC preflight guard did not block the locally provable caller conflict");
  }
  if (blocked.coreStepExecuted !== false || blocked.composer !== null) {
    throw new Error("blocked UC preflight guard path executed or exposed a composer step");
  }
  if (blocked.preflight?.counts?.conflicts !== 1 || blocked.preflight?.conflicts?.length !== 1) {
    throw new Error("blocked UC preflight guard evidence did not retain exactly one proven local conflict");
  }
  if (blocked.worldChecksumBefore !== blocked.worldChecksumAfter || !sameJson(blocked.world, sourceWorld)) {
    throw new Error("blocked UC preflight guard path changed caller world state");
  }
  if (blocked.decisionChecksum !== blockedReplay.decisionChecksum || blocked.preflight?.checksum !== blockedReplay.preflight?.checksum) {
    throw new Error("blocked UC preflight guard decision did not replay deterministically in one runtime");
  }

  const invalid = Guard.step(structuredClone(sourceWorld), structuredClone(invalidRequest), dt);
  if (invalid?.blocked !== true || invalid?.reason !== "INVALID_CONSTRAINTS" || invalid?.coreStepExecuted !== false) {
    throw new Error("UC preflight guard did not fail closed on invalid caller constraints");
  }
  if (!String((invalid.composerValidation?.errors || []).join(" ")).toLowerCase().includes("body")) {
    throw new Error("invalid UC preflight guard evidence lost the missing-body validation cause");
  }

  const executeAccepted = () => Guard.step(
    structuredClone(sourceWorld), structuredClone(acceptedRequest), dt, { composer: composerOptions },
  );
  const accepted = executeAccepted();
  const acceptedReplay = executeAccepted();
  const directAccepted = Composer.step(structuredClone(sourceWorld), structuredClone(acceptedRequest), dt, composerOptions);
  if (accepted?.accepted !== true || accepted?.blocked !== false || accepted?.reason !== "ACCEPTED" || accepted?.coreStepExecuted !== true) {
    throw new Error("UC preflight guard did not delegate the conflict-free caller request");
  }
  if (accepted.preflight?.counts?.conflicts !== 0) {
    throw new Error("accepted UC preflight guard path unexpectedly retained a proven conflict");
  }
  if (!sameJson(accepted.world, directAccepted.world) || !sameJson(accepted.composer, directAccepted)) {
    throw new Error("accepted UC preflight guard path drifted from direct composer behavior");
  }
  if (!sameJson(accepted.world, acceptedReplay.world) || accepted.decisionChecksum !== acceptedReplay.decisionChecksum) {
    throw new Error("accepted UC preflight guard path did not replay deterministically in one runtime");
  }

  const unsupportedDistance = Guard.step(
    structuredClone(sourceWorld), structuredClone(unsupportedDistanceRequest), dt, { composer: composerOptions },
  );
  if (unsupportedDistance?.accepted !== true || unsupportedDistance?.coreStepExecuted !== true ||
      unsupportedDistance.preflight?.counts?.unsupportedConstraints !== 1 || unsupportedDistance.preflight?.counts?.conflicts !== 0) {
    throw new Error("UC preflight guard misclassified a valid distance constraint outside the local conflict proof");
  }

  if (Buffer.compare(sourceWorldBytes, stableBytes(sourceWorld)) !== 0 ||
      Buffer.compare(requestBytes.blocked, stableBytes(blockedRequest)) !== 0 ||
      Buffer.compare(requestBytes.accepted, stableBytes(acceptedRequest)) !== 0 ||
      Buffer.compare(requestBytes.invalid, stableBytes(invalidRequest)) !== 0 ||
      Buffer.compare(requestBytes.unsupportedDistance, stableBytes(unsupportedDistanceRequest)) !== 0) {
    throw new Error("UC preflight guard proof mutated caller source state or requests");
  }

  const sourceSceneBytes = worldToConstraintPreflightGuardScene(sourceWorld);
  const blockedSceneBytes = worldToConstraintPreflightGuardScene(blocked.world);
  const acceptedSceneBytes = worldToConstraintPreflightGuardScene(accepted.world);
  if (sha256(sourceSceneBytes) !== sha256(blockedSceneBytes)) {
    throw new Error("blocked preflight branch invented a derived visual state despite executing zero donor-core steps");
  }
  if (sha256(sourceSceneBytes) === sha256(acceptedSceneBytes)) {
    throw new Error("accepted preflight branch did not produce observable derived state for the exercised request");
  }

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-universal-creation",
      revision: ucRevision,
      preflight_guard_version: Guard.VERSION,
      preflight_guard_step_schema: Guard.STEP_SCHEMA,
      physics_core_version: String(Core.VERSION),
      preflight_guard_source_sha256: guardSourceSha256,
      preflight_source_sha256: preflightSourceSha256,
      constraint_composer_source_sha256: composerSourceSha256,
      physics_core_source_sha256: coreSourceSha256,
    },
    caller_authority: {
      source_world_sha256: sha256(sourceWorldBytes),
      blocked_request_sha256: sha256(requestBytes.blocked),
      accepted_request_sha256: sha256(requestBytes.accepted),
      invalid_request_sha256: sha256(requestBytes.invalid),
      unsupported_distance_request_sha256: sha256(requestBytes.unsupportedDistance),
      source_state_mutated: false,
      requests_mutated: false,
      guard_is_opt_in: true,
    },
    blocked_branch: {
      accepted: blocked.accepted,
      blocked: blocked.blocked,
      reason: blocked.reason,
      core_step_executed: blocked.coreStepExecuted,
      composer_present: blocked.composer !== null,
      proven_conflict_count: blocked.preflight.counts.conflicts,
      world_checksum_before: blocked.worldChecksumBefore,
      world_checksum_after: blocked.worldChecksumAfter,
      world_unchanged: sameJson(blocked.world, sourceWorld),
      decision_checksum: blocked.decisionChecksum,
      repeat_verification: "PASS",
    },
    invalid_branch: {
      blocked: invalid.blocked,
      reason: invalid.reason,
      core_step_executed: invalid.coreStepExecuted,
      missing_body_rejected: true,
      world_unchanged: sameJson(invalid.world, sourceWorld),
    },
    accepted_branch: {
      accepted: accepted.accepted,
      blocked: accepted.blocked,
      reason: accepted.reason,
      core_step_executed: accepted.coreStepExecuted,
      proven_conflict_count: accepted.preflight.counts.conflicts,
      final_checksum: Core.checksum(accepted.world),
      direct_composer_world_equivalent: sameJson(accepted.world, directAccepted.world),
      direct_composer_receipt_equivalent: sameJson(accepted.composer, directAccepted),
      repeat_verification: "PASS",
      source_payload_position: point(sourceWorld, "payload"),
      final_payload_position: point(accepted.world, "payload"),
    },
    unsupported_distance_branch: {
      accepted: unsupportedDistance.accepted,
      core_step_executed: unsupportedDistance.coreStepExecuted,
      unsupported_constraint_count: unsupportedDistance.preflight.counts.unsupportedConstraints,
      proven_conflict_count: unsupportedDistance.preflight.counts.conflicts,
      unsupported_not_misclassified_as_conflict: true,
    },
    outputs: {
      source_scene: { sha256: sha256(sourceSceneBytes), authority: "DERIVED_SOURCE_VISUALIZATION" },
      blocked_scene: { sha256: sha256(blockedSceneBytes), authority: "DERIVED_BLOCK_EVIDENCE_VISUALIZATION_OF_UNCHANGED_CALLER_WORLD" },
      accepted_scene: { sha256: sha256(acceptedSceneBytes), authority: "DERIVED_ACCEPTED_RESULT_VISUALIZATION" },
      source_and_blocked_scenes_identical: true,
      source_and_accepted_scenes_differ: true,
    },
    truth_boundary: {
      proves: "the pinned current UC opt-in preflight guard blocks invalid or locally proven projected-translation conflicts before donor integration without changing caller state, delegates a conflict-free request exactly to the existing composer, preserves unsupported distance constraints as explicit non-claims rather than conflicts, and exposes derived observation state without inventing motion for a blocked branch",
      does_not_prove: "global satisfiability, convergence, stability, general collision correctness, nonlinear distance-conflict detection, scientific physical validity, gameplay quality, aesthetic quality, real-time performance or cross-machine bitwise determinism",
      canonical_authority: "caller source world plus explicit caller constraint requests and guard choice",
      derived_replaceable: ["guard/composer evidence", "accepted simulated world", "AXM_SCENE 1 observations", "render requests", "render receipts", "pixels"],
    },
  };

  return { sourceSceneBytes, blockedSceneBytes, acceptedSceneBytes, receipt };
}
