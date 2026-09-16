import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const CONTRACT = "AXM_CREATIVE_UC_DIRECTION_LOCK_NATIVE_RECEIPT";
const VERSION = 1;
const EXPECTED_COMPOSER_VERSION = "0.6.0";
const EXPECTED_FAMILY_ORDER = [
  "translation-mounts",
  "distance-joints",
  "distance-limits",
  "axis-locks",
  "axis-limits",
  "direction-locks",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function integer(value, label, min, max, fallback) {
  const number = Math.round(value == null ? fallback : finite(value, label));
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return number;
}

function bounded(value, label, min, max, fallback) {
  const number = value == null ? fallback : finite(value, label);
  if (number < min || number > max) throw new Error(`${label} must be in ${min}..${max}`);
  return number;
}

function revision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function formatNumber(value) {
  const number = finite(value, "scene coordinate");
  const normalized = Object.is(number, -0) ? 0 : number;
  return normalized.toFixed(6).replace(/\.?0+$/, "") || "0";
}

function body(world, id) {
  return world?.bodies?.find((item) => item.id === id) || null;
}

function quadTriangles(center, halfExtent, albedo) {
  const x0 = center.x - halfExtent;
  const x1 = center.x + halfExtent;
  const y0 = center.y - halfExtent;
  const y1 = center.y + halfExtent;
  const z = 0;
  return [
    { vertices: [[x0, y0, z], [x1, y0, z], [x1, y1, z]], albedo },
    { vertices: [[x0, y0, z], [x1, y1, z], [x0, y1, z]], albedo },
  ];
}

export function worldToDirectionLockScene(world) {
  const anchor = body(world, "anchor");
  const payload = body(world, "payload");
  if (!anchor || !payload) throw new Error("direction-lock render adapter requires anchor and payload bodies");
  const triangles = [
    ...quadTriangles(
      { x: finite(anchor.position?.x, "anchor x"), y: finite(anchor.position?.y, "anchor y") },
      0.09,
      [90, 110, 145],
    ),
    ...quadTriangles(
      { x: finite(payload.position?.x, "payload x"), y: finite(payload.position?.y, "payload y") },
      0.12,
      [224, 166, 72],
    ),
  ];
  const lines = [
    "# Derived AXM Creative Render evidence scene; caller physics state remains authoritative.",
    "AXM_SCENE 1",
  ];
  for (const triangle of triangles) {
    const coords = triangle.vertices.flat().map(formatNumber);
    lines.push(`triangle ${[...coords, ...triangle.albedo].join(" ")}`);
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function relativeProjection(world, direction) {
  const anchor = body(world, "anchor");
  const payload = body(world, "payload");
  if (!anchor || !payload) throw new Error("direction-lock proof lost anchor or payload body");
  const dx = finite(payload.position?.x, "payload x") - finite(anchor.position?.x, "anchor x");
  const dy = finite(payload.position?.y, "payload y") - finite(anchor.position?.y, "anchor y");
  return dx * direction.x + dy * direction.y;
}

function perpendicularProjection(world, direction) {
  const perpendicular = { x: -direction.y, y: direction.x };
  return relativeProjection(world, perpendicular);
}

async function digest(path) {
  const bytes = await readFile(path);
  return { path, sha256: sha256(bytes), bytes };
}

export async function runUniversalCreationDirectionLock(root, options = {}) {
  const ucRevision = revision(options.ucRevision, "Universal Creation revision");
  const steps = integer(options.steps, "steps", 2, 120, 10);
  const dt = bounded(options.dt, "dt", 1 / 1000, 0.1, 0.05);
  const gravityY = bounded(options.gravityY, "gravityY", 0.1, 10, 1.5);
  const impulse = bounded(options.perpendicularImpulse, "perpendicularImpulse", 0.05, 4, 0.6);

  const rootPath = resolve(root);
  const composerPath = resolve(rootPath, "capabilities/physics-core/uc-constraint-composer.js");
  const corePath = resolve(rootPath, "capabilities/physics-core/source/axm-physics-core.js");
  const [composerSource, coreSource] = await Promise.all([digest(composerPath), digest(corePath)]);
  const require = createRequire(import.meta.url);
  const Composer = require(composerPath);
  const Core = require(corePath);

  if (Composer?.VERSION !== EXPECTED_COMPOSER_VERSION) {
    throw new Error(`expected UC constraint composer ${EXPECTED_COMPOSER_VERSION}, got ${String(Composer?.VERSION)}`);
  }
  if (JSON.stringify(Composer.FAMILY_ORDER) !== JSON.stringify(EXPECTED_FAMILY_ORDER)) {
    throw new Error("UC constraint-composer family order drifted");
  }
  if (typeof Composer.step !== "function" || typeof Composer.validate !== "function") {
    throw new Error("UC constraint composer public step/validate surface unavailable");
  }
  if (typeof Core?.createWorld !== "function" || typeof Core.addBody !== "function" || typeof Core.applyImpulse !== "function" || typeof Core.checksum !== "function") {
    throw new Error("UC donor physics core public surface unavailable");
  }

  let sourceWorld = Core.createWorld({ gravity: { x: 0, y: gravityY }, bounds: false, sleep: { enabled: false } });
  sourceWorld = Core.addBody(sourceWorld, { id: "anchor", type: "static", position: { x: -0.6, y: -0.5 } }).world;
  sourceWorld = Core.addBody(sourceWorld, {
    id: "payload",
    type: "dynamic",
    position: { x: -0.1, y: 0 },
    mass: 1,
    linearDamping: 0,
  }).world;

  const directionLength = Math.hypot(1, 1);
  const direction = { x: 1 / directionLength, y: 1 / directionLength };
  const targetOffset = relativeProjection(sourceWorld, direction);
  sourceWorld = Core.applyImpulse(sourceWorld, "payload", {
    x: -direction.y * impulse,
    y: direction.x * impulse,
  });

  const constraints = {
    mounts: [],
    distanceJoints: [],
    distanceLimits: [],
    axisLocks: [],
    axisLimits: [],
    directionLocks: [{
      id: "caller-diagonal-direction-lock",
      a: "anchor",
      b: "payload",
      direction: { x: 1, y: 1 },
      offset: targetOffset,
    }],
  };

  const sourceWorldBytes = stableBytes(sourceWorld);
  const constraintBytes = stableBytes(constraints);
  const validation = Composer.validate(sourceWorld, constraints);
  if (validation?.ok !== true || validation.directionLockCount !== 1) {
    throw new Error(`UC direction-lock composer validation failed: ${(validation?.errors || []).join("; ")}`);
  }

  const simulate = () => {
    let world = structuredClone(sourceWorld);
    const trace = [];
    let maxAfterCoreError = 0;
    let maxAfterStabilizationError = 0;
    let last = null;
    for (let index = 0; index < steps; index++) {
      last = Composer.step(world, constraints, dt);
      if (last?.ok !== true) throw new Error(`UC composer step ${index + 1} did not pass`);
      world = last.world;
      const afterCore = finite(last.composerDiagnostics?.afterCore?.maxDirectionLockError, "after-core direction lock error");
      const after = finite(last.composerDiagnostics?.after?.maxDirectionLockError, "post-stabilization direction lock error");
      maxAfterCoreError = Math.max(maxAfterCoreError, Math.abs(afterCore));
      maxAfterStabilizationError = Math.max(maxAfterStabilizationError, Math.abs(after));
      trace.push({
        step: index + 1,
        world_step_index: world.stepIndex,
        after_core_direction_lock_error: afterCore,
        after_stabilization_direction_lock_error: after,
        perpendicular_offset: perpendicularProjection(world, direction),
        payload_position: structuredClone(body(world, "payload").position),
      });
    }
    return {
      world,
      checksum: Core.checksum(world),
      trace,
      trace_sha256: sha256(stableBytes(trace)),
      maxAfterCoreError,
      maxAfterStabilizationError,
      last,
    };
  };

  const first = simulate();
  const second = simulate();
  if (first.checksum !== second.checksum || first.trace_sha256 !== second.trace_sha256) {
    throw new Error("UC direction-lock same-runtime replay verification failed");
  }
  if (Buffer.compare(sourceWorldBytes, stableBytes(sourceWorld)) !== 0 || Buffer.compare(constraintBytes, stableBytes(constraints)) !== 0) {
    throw new Error("UC direction-lock execution mutated caller source state or constraint request");
  }
  if (first.world.stepIndex !== sourceWorld.stepIndex + steps) {
    throw new Error("UC composer did not execute exactly one donor-core integration per requested step");
  }
  if (!(first.maxAfterCoreError > 1e-4)) {
    throw new Error("proof fixture did not create measurable direction drift during donor-core integration");
  }
  if (!(first.maxAfterStabilizationError <= 1e-8)) {
    throw new Error(`direction-lock stabilization error exceeded proof gate: ${first.maxAfterStabilizationError}`);
  }

  const initialProjection = relativeProjection(sourceWorld, direction);
  const finalProjection = relativeProjection(first.world, direction);
  const initialPerpendicular = perpendicularProjection(sourceWorld, direction);
  const finalPerpendicular = perpendicularProjection(first.world, direction);
  const projectionError = Math.abs(finalProjection - targetOffset);
  const perpendicularDelta = finalPerpendicular - initialPerpendicular;
  if (projectionError > 1e-8) throw new Error(`final locked projection drifted by ${projectionError}`);
  if (Math.abs(perpendicularDelta) <= 0.05) {
    throw new Error("direction-lock fixture did not demonstrate intentionally free perpendicular translation");
  }

  const sourceSceneBytes = worldToDirectionLockScene(sourceWorld);
  const lockedSceneBytes = worldToDirectionLockScene(first.world);
  if (sha256(sourceSceneBytes) === sha256(lockedSceneBytes)) {
    throw new Error("direction-lock derived scene did not change after valid perpendicular motion");
  }

  const trace = {
    contract: "AXM_CREATIVE_UC_DIRECTION_LOCK_TRACE",
    version: 1,
    steps,
    dt,
    direction,
    target_projection: targetOffset,
    first_run: first.trace,
    repeated_trace_sha256: second.trace_sha256,
  };
  const traceBytes = Buffer.from(`${JSON.stringify(trace, null, 2)}\n`, "utf8");
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-universal-creation",
      revision: ucRevision,
      constraint_composer_version: Composer.VERSION,
      physics_core_version: String(Core.VERSION),
      constraint_composer_source_sha256: composerSource.sha256,
      physics_core_source_sha256: coreSource.sha256,
    },
    caller_authority: {
      source_world_sha256: sha256(sourceWorldBytes),
      constraint_request_sha256: sha256(constraintBytes),
      source_state_mutated: false,
      constraint_request_mutated: false,
    },
    composer: {
      family_order: [...Composer.FAMILY_ORDER],
      active_family: "direction-locks",
      direction_lock_count: 1,
      steps,
      dt,
      one_donor_core_integration_per_step: true,
      final_checksum: first.checksum,
      repeat_verification: "PASS",
      trace_sha256: sha256(traceBytes),
      max_after_core_direction_lock_error: first.maxAfterCoreError,
      max_after_stabilization_direction_lock_error: first.maxAfterStabilizationError,
      target_projection: targetOffset,
      initial_projection: initialProjection,
      final_projection: finalProjection,
      final_projection_error: projectionError,
      initial_perpendicular_offset: initialPerpendicular,
      final_perpendicular_offset: finalPerpendicular,
      perpendicular_translation_delta: perpendicularDelta,
    },
    outputs: {
      source_scene: { sha256: sha256(sourceSceneBytes), authority: "DERIVED_SOURCE_VISUALIZATION" },
      locked_scene: { sha256: sha256(lockedSceneBytes), authority: "DERIVED_CONSTRAINED_VISUALIZATION" },
      trace: { sha256: sha256(traceBytes), authority: "DERIVED_EXECUTION_EVIDENCE" },
    },
    truth_boundary: {
      proves: "the pinned current UC shared constraint composer preserves one caller-selected fixed world-space translation projection through one donor-core integration per step while perpendicular translation remains free, and both source/final states can be adapted into replaceable AXM_SCENE 1 evidence bodies",
      does_not_prove: "full prismatic joints, angular constraints, activity-gate or collision-isolation support for direction locks, physical/scientific validity, collision correctness, 3D physics, gameplay quality, visual quality, real-time performance or cross-machine bitwise determinism",
      canonical_authority: "caller source world and constraint request",
      derived_replaceable: ["simulation result", "trace", "AXM_SCENE 1 visualizations", "render requests", "render receipts", "pixels"],
    },
  };

  return {
    sourceSceneBytes,
    lockedSceneBytes,
    traceBytes,
    receipt,
    finalWorld: first.world,
  };
}
