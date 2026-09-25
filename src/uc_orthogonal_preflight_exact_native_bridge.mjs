import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const CONTRACT = "AXM_CREATIVE_UC_ORTHOGONAL_PREFLIGHT_EXACT_NATIVE_RECEIPT";
const VERSION = 1;
const EXPECTED_PREFLIGHT_VERSION = "0.3.0";
const EXPECTED_PREFLIGHT_SCHEMA = "axm.uc-orthogonal-projection-preflight/v0.3";
const EXPECTED_GUARD_VERSION = "0.2.0";
const EXPECTED_GUARD_SCHEMA = "axm.uc-orthogonal-projection-preflight-guard-step/v0.2";

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
  if (!item) throw new Error(`orthogonal preflight proof lost body ${id}`);
  return { x: finite(item.position?.x, `${id} x`), y: finite(item.position?.y, `${id} y`) };
}

function formatNumber(value) {
  const number = finite(value, "scene coordinate");
  const normalized = Object.is(number, -0) ? 0 : number;
  return normalized.toFixed(9).replace(/\.?0+$/, "") || "0";
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

export function worldToOrthogonalPreflightScene(world) {
  const triangles = [
    ...quad(point(world, "a"), 0.09, [90, 110, 145]),
    ...quad(point(world, "b"), 0.12, [224, 166, 72]),
  ];
  const lines = [
    "# Derived orthogonal-preflight observation; caller physics state remains authoritative.",
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

export async function runUniversalCreationOrthogonalPreflightExact(root, options = {}) {
  const ucRevision = revision(options.ucRevision, "Universal Creation revision");
  const rootPath = resolve(root);
  const preflightPath = resolve(rootPath, "capabilities/physics-core/uc-orthogonal-projection-preflight.js");
  const guardPath = resolve(rootPath, "capabilities/physics-core/uc-orthogonal-projection-preflight-guard.js");
  const exactGeometryPath = resolve(rootPath, "capabilities/physics-core/uc-exact-projection-geometry.js");
  const baseGuardPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-preflight-guard.js");
  const composerPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-composer.js");
  const corePath = resolve(rootPath, "capabilities/physics-core/source/axm-physics-core.js");
  const [preflightSourceSha256, guardSourceSha256, exactGeometrySourceSha256, baseGuardSourceSha256, composerSourceSha256, coreSourceSha256] = await Promise.all([
    digest(preflightPath), digest(guardPath), digest(exactGeometryPath), digest(baseGuardPath), digest(composerPath), digest(corePath),
  ]);

  const require = createRequire(import.meta.url);
  const Preflight = require(preflightPath);
  const Guard = require(guardPath);
  const BaseGuard = require(baseGuardPath);
  const Core = require(corePath);

  if (Preflight?.VERSION !== EXPECTED_PREFLIGHT_VERSION || Preflight?.REPORT_SCHEMA !== EXPECTED_PREFLIGHT_SCHEMA) {
    throw new Error(`expected UC orthogonal preflight ${EXPECTED_PREFLIGHT_VERSION}/${EXPECTED_PREFLIGHT_SCHEMA}, got ${String(Preflight?.VERSION)}/${String(Preflight?.REPORT_SCHEMA)}`);
  }
  if (Guard?.VERSION !== EXPECTED_GUARD_VERSION || Guard?.STEP_SCHEMA !== EXPECTED_GUARD_SCHEMA) {
    throw new Error(`expected UC orthogonal guard ${EXPECTED_GUARD_VERSION}/${EXPECTED_GUARD_SCHEMA}, got ${String(Guard?.VERSION)}/${String(Guard?.STEP_SCHEMA)}`);
  }
  if (typeof Preflight.analyze !== "function" || typeof Guard.step !== "function" || typeof BaseGuard.step !== "function" || typeof Core.checksum !== "function") {
    throw new Error("UC orthogonal-preflight/base-guard/core public surface unavailable");
  }

  let sourceWorld = Core.createWorld({ gravity: { x: 0, y: 0 }, bounds: false, sleep: { enabled: false } });
  sourceWorld = Core.addBody(sourceWorld, { id: "a", type: "static", position: { x: 0, y: 0 } }).world;
  sourceWorld = Core.addBody(sourceWorld, { id: "b", type: "dynamic", position: { x: 1, y: 2 }, mass: 1, linearDamping: 0 }).world;

  const blockedRequest = {
    axisLocks: [
      { id: "x-three", a: "a", b: "b", axis: "x", offset: 3 },
      { id: "y-four", a: "a", b: "b", axis: "y", offset: 4 },
    ],
    distanceLimits: [{ id: "radius-four-point-five", a: "a", b: "b", maxLength: 4.5 }],
  };
  const nearOrthogonalRequest = {
    directionLocks: [
      { id: "x-three", a: "a", b: "b", direction: { x: 1, y: 0 }, offset: 3 },
      { id: "almost-y-four", a: "a", b: "b", direction: { x: 1.4e-9, y: 1 }, offset: 4 },
    ],
    distanceLimits: [{ id: "radius-four-point-five", a: "a", b: "b", maxLength: 4.5 }],
  };
  const dt = 1 / 60;
  const preflightOptions = { orthogonalityTolerance: 1e-9 };
  const guardOptions = { preflight: preflightOptions };

  const sourceWorldBytes = stableBytes(sourceWorld);
  const blockedRequestBytes = stableBytes(blockedRequest);
  const nearOrthogonalRequestBytes = stableBytes(nearOrthogonalRequest);

  const blockedPreflight = Preflight.analyze(structuredClone(sourceWorld), structuredClone(blockedRequest), preflightOptions);
  const blockedPreflightReplay = Preflight.analyze(structuredClone(sourceWorld), structuredClone(blockedRequest), preflightOptions);
  if (blockedPreflight.proofGeometry !== "full-precision-normalized" || blockedPreflight.counts?.orthogonalProjectionRadialConflicts !== 1 || blockedPreflight.conflicts?.[0]?.code !== "ORTHOGONAL_PROJECTIONS_EXCEED_DISTANCE_MAX") {
    throw new Error("current UC exact-geometry orthogonal preflight did not retain the expected 3-4-5 conflict proof");
  }
  if (blockedPreflight.checksum !== blockedPreflightReplay.checksum) {
    throw new Error("current UC orthogonal conflict analysis did not replay deterministically in one runtime");
  }

  const blocked = Guard.step(structuredClone(sourceWorld), structuredClone(blockedRequest), dt, guardOptions);
  const blockedReplay = Guard.step(structuredClone(sourceWorld), structuredClone(blockedRequest), dt, guardOptions);
  if (blocked?.accepted !== false || blocked?.blocked !== true || blocked?.reason !== "PROVABLE_ORTHOGONAL_LOCAL_CONFLICT" || blocked?.coreStepExecuted !== false || blocked?.composer !== null) {
    throw new Error("current UC orthogonal guard did not block the exact local conflict before donor integration");
  }
  if (blocked.worldChecksumBefore !== blocked.worldChecksumAfter || !sameJson(blocked.world, sourceWorld)) {
    throw new Error("blocked exact-orthogonal branch changed caller world state");
  }
  if (blocked.decisionChecksum !== blockedReplay.decisionChecksum) {
    throw new Error("blocked exact-orthogonal guard decision did not replay deterministically");
  }

  const nearPreflight = Preflight.analyze(structuredClone(sourceWorld), structuredClone(nearOrthogonalRequest), preflightOptions);
  const nearPreflightReplay = Preflight.analyze(structuredClone(sourceWorld), structuredClone(nearOrthogonalRequest), preflightOptions);
  const nearDisplayGroup = nearPreflight.base?.groups?.find((group) => (group.constraints || []).some((item) => item.id === "almost-y-four"));
  const displayedDirectionX = nearDisplayGroup?.direction?.x;
  if (displayedDirectionX !== 1e-9) {
    throw new Error(`near-orthogonal base receipt no longer exposes the exercised 1e-9 rounded presentation value: ${String(displayedDirectionX)}`);
  }
  if (!(nearOrthogonalRequest.directionLocks[1].direction.x > preflightOptions.orthogonalityTolerance)) {
    throw new Error("near-orthogonal caller fixture no longer sits above the strict orthogonality tolerance");
  }
  if (nearPreflight.proofGeometry !== "full-precision-normalized" || nearPreflight.counts?.orthogonalProjectionRadialChecks !== 0 || nearPreflight.counts?.orthogonalProjectionRadialConflicts !== 0 || nearPreflight.conflictFree !== true) {
    throw new Error("full-precision proof incorrectly promoted the rounded near-orthogonal presentation into a conflict");
  }
  if (nearPreflight.checksum !== nearPreflightReplay.checksum) {
    throw new Error("near-orthogonal preflight decision did not replay deterministically");
  }

  const nearAccepted = Guard.step(structuredClone(sourceWorld), structuredClone(nearOrthogonalRequest), dt, guardOptions);
  const nearAcceptedReplay = Guard.step(structuredClone(sourceWorld), structuredClone(nearOrthogonalRequest), dt, guardOptions);
  const directBaseGuard = BaseGuard.step(structuredClone(sourceWorld), structuredClone(nearOrthogonalRequest), dt, guardOptions);
  if (nearAccepted?.accepted !== true || nearAccepted?.blocked !== false || nearAccepted?.coreStepExecuted !== true) {
    throw new Error("near-orthogonal rounding-boundary request was not delegated through the established guard/composer path");
  }
  if (!sameJson(nearAccepted, directBaseGuard)) {
    throw new Error("near-orthogonal accepted path drifted from direct established base-guard behavior");
  }
  if (!sameJson(nearAccepted, nearAcceptedReplay)) {
    throw new Error("near-orthogonal accepted guard result did not replay deterministically");
  }

  if (Buffer.compare(sourceWorldBytes, stableBytes(sourceWorld)) !== 0 ||
      Buffer.compare(blockedRequestBytes, stableBytes(blockedRequest)) !== 0 ||
      Buffer.compare(nearOrthogonalRequestBytes, stableBytes(nearOrthogonalRequest)) !== 0) {
    throw new Error("UC exact-geometry orthogonal proof mutated caller source state or requests");
  }

  const sourceSceneBytes = worldToOrthogonalPreflightScene(sourceWorld);
  const blockedSceneBytes = worldToOrthogonalPreflightScene(blocked.world);
  const acceptedSceneBytes = worldToOrthogonalPreflightScene(nearAccepted.world);
  if (sha256(sourceSceneBytes) !== sha256(blockedSceneBytes)) {
    throw new Error("blocked exact-orthogonal branch invented derived visual state despite zero donor-core steps");
  }
  if (sha256(sourceSceneBytes) === sha256(acceptedSceneBytes)) {
    throw new Error("accepted near-orthogonal branch did not produce observable derived state for the exercised request");
  }

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-universal-creation",
      revision: ucRevision,
      orthogonal_preflight_version: Preflight.VERSION,
      orthogonal_preflight_schema: Preflight.REPORT_SCHEMA,
      orthogonal_guard_version: Guard.VERSION,
      orthogonal_guard_schema: Guard.STEP_SCHEMA,
      physics_core_version: String(Core.VERSION),
      orthogonal_preflight_source_sha256: preflightSourceSha256,
      orthogonal_guard_source_sha256: guardSourceSha256,
      exact_geometry_source_sha256: exactGeometrySourceSha256,
      base_guard_source_sha256: baseGuardSourceSha256,
      constraint_composer_source_sha256: composerSourceSha256,
      physics_core_source_sha256: coreSourceSha256,
    },
    caller_authority: {
      source_world_sha256: sha256(sourceWorldBytes),
      exact_conflict_request_sha256: sha256(blockedRequestBytes),
      near_orthogonal_request_sha256: sha256(nearOrthogonalRequestBytes),
      source_state_mutated: false,
      requests_mutated: false,
      stronger_guard_is_opt_in: true,
    },
    exact_orthogonal_block: {
      proof_geometry: blockedPreflight.proofGeometry,
      preflight_checksum: blockedPreflight.checksum,
      conflict_code: blockedPreflight.conflicts[0].code,
      minimum_required_distance: blockedPreflight.conflicts[0].minimumRequiredDistance,
      maximum_allowed_distance: blockedPreflight.conflicts[0].maximumAllowedDistance,
      accepted: blocked.accepted,
      blocked: blocked.blocked,
      reason: blocked.reason,
      core_step_executed: blocked.coreStepExecuted,
      composer_present: blocked.composer !== null,
      world_unchanged: sameJson(blocked.world, sourceWorld),
      world_checksum_before: blocked.worldChecksumBefore,
      world_checksum_after: blocked.worldChecksumAfter,
      repeat_verification: "PASS",
    },
    near_orthogonal_rounding_boundary: {
      caller_direction_x: nearOrthogonalRequest.directionLocks[1].direction.x,
      presentation_direction_x: displayedDirectionX,
      orthogonality_tolerance: nearPreflight.orthogonalityTolerance,
      proof_geometry: nearPreflight.proofGeometry,
      orthogonal_checks: nearPreflight.counts.orthogonalProjectionRadialChecks,
      orthogonal_conflicts: nearPreflight.counts.orthogonalProjectionRadialConflicts,
      conflict_free: nearPreflight.conflictFree,
      guard_accepted: nearAccepted.accepted,
      core_step_executed: nearAccepted.coreStepExecuted,
      exact_base_guard_equivalent: sameJson(nearAccepted, directBaseGuard),
      repeat_verification: "PASS",
      source_body_b_position: point(sourceWorld, "b"),
      final_body_b_position: point(nearAccepted.world, "b"),
    },
    outputs: {
      source_scene: { sha256: sha256(sourceSceneBytes), authority: "DERIVED_SOURCE_VISUALIZATION" },
      blocked_scene: { sha256: sha256(blockedSceneBytes), authority: "DERIVED_ZERO_STEP_BLOCK_VISUALIZATION" },
      accepted_scene: { sha256: sha256(acceptedSceneBytes), authority: "DERIVED_ACCEPTED_RESULT_VISUALIZATION" },
      source_and_blocked_scenes_identical: true,
      source_and_accepted_scenes_differ: true,
    },
    truth_boundary: {
      proves: "the pinned current UC orthogonal preflight uses its declared full-precision normalized geometry for bounded proof decisions, blocks an exact same-pair orthogonal projection/radial contradiction before donor integration, and declines a near-orthogonal case whose rounded presentation sits on the tolerance boundary while delegating that accepted request exactly through the established base guard",
      does_not_prove: "global satisfiability, oblique-direction conflict solving, more than two projected directions, multi-pair or loop reasoning, convergence, stability, general collision correctness, scientific physical validity, gameplay quality, aesthetic quality, real-time performance or cross-machine bitwise determinism",
      canonical_authority: "caller source world plus explicit caller constraint requests and opt-in stronger-guard choice",
      presentation_only: "rounded direction and interval values in donor public receipts",
      derived_replaceable: ["preflight/guard/composer evidence", "accepted simulated world", "AXM_SCENE 1 observations", "render requests", "render receipts", "pixels"],
    },
  };

  return { sourceSceneBytes, blockedSceneBytes, acceptedSceneBytes, receipt };
}
