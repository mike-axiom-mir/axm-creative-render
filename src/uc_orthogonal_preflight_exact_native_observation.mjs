import { createHash } from "node:crypto";
import { runUniversalCreationOrthogonalPreflightExact } from "./uc_orthogonal_preflight_exact_native_bridge.mjs";

const OBSERVATION_SCALE = 0.15;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("orthogonal preflight observation coordinate must be finite");
  const normalized = Object.is(number, -0) ? 0 : number;
  return normalized.toFixed(9).replace(/\.?0+$/, "") || "0";
}

export function scaleOrthogonalPreflightObservation(sceneBytes, scale = OBSERVATION_SCALE) {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("orthogonal preflight observation scale must be finite and positive");
  const lines = sceneBytes.toString("utf8").trimEnd().split("\n");
  const out = lines.map((line) => {
    if (!line.startsWith("triangle ")) return line;
    const parts = line.split(/\s+/);
    if (parts.length !== 13) throw new Error(`unexpected AXM triangle token count ${parts.length}`);
    for (const index of [1, 2, 4, 5, 7, 8]) {
      parts[index] = formatNumber(Number(parts[index]) * scale);
    }
    return parts.join(" ");
  });
  return Buffer.from(`${out.join("\n")}\n`, "utf8");
}

export async function runUniversalCreationOrthogonalPreflightExactNative(root, options = {}) {
  const result = await runUniversalCreationOrthogonalPreflightExact(root, options);
  const unscaled = {
    source: result.sourceSceneBytes,
    blocked: result.blockedSceneBytes,
    accepted: result.acceptedSceneBytes,
  };
  const sourceSceneBytes = scaleOrthogonalPreflightObservation(unscaled.source);
  const blockedSceneBytes = scaleOrthogonalPreflightObservation(unscaled.blocked);
  const acceptedSceneBytes = scaleOrthogonalPreflightObservation(unscaled.accepted);

  if (sha256(sourceSceneBytes) !== sha256(blockedSceneBytes)) {
    throw new Error("fixed native observation transform broke the exact blocked no-op identity");
  }
  if (sha256(sourceSceneBytes) === sha256(acceptedSceneBytes)) {
    throw new Error("fixed native observation transform erased the accepted derived-state difference");
  }

  const receipt = structuredClone(result.receipt);
  receipt.outputs = {
    source_scene: { sha256: sha256(sourceSceneBytes), authority: "DERIVED_FIXED_SCALE_NATIVE_OBSERVATION" },
    blocked_scene: { sha256: sha256(blockedSceneBytes), authority: "DERIVED_FIXED_SCALE_NATIVE_OBSERVATION" },
    accepted_scene: { sha256: sha256(acceptedSceneBytes), authority: "DERIVED_FIXED_SCALE_NATIVE_OBSERVATION" },
    source_and_blocked_scenes_identical: true,
    source_and_accepted_scenes_differ: true,
    observation_adapter: {
      kind: "fixed-uniform-xy-scale",
      scale: OBSERVATION_SCALE,
      purpose: "keep all exercised body positions inside the bounded native reference-render observation field without changing donor physics or proof decisions",
      unscaled_scene_sha256: {
        source: sha256(unscaled.source),
        blocked: sha256(unscaled.blocked),
        accepted: sha256(unscaled.accepted),
      },
      authority: "DERIVED_REPLACEABLE_OBSERVATION_ONLY",
    },
  };
  receipt.truth_boundary.presentation_only = `${receipt.truth_boundary.presentation_only}; the fixed ${OBSERVATION_SCALE} native observation scale is also presentation-only`;

  return { sourceSceneBytes, blockedSceneBytes, acceptedSceneBytes, receipt };
}
