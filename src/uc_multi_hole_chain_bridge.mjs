import { sha256 } from "./creative_scene_operator.mjs";
import { ucSurfaceToAxmScene, validateUcSurface } from "./uc_oriented_cut_bridge.mjs";

const LINEAGE_SCHEMA = "axm.mesh-hole-fabrication-lineage/v0.5";

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function integer(value, label, min = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) throw new Error(`${label} must be an integer >= ${min}`);
  return number;
}

function sha256Hex(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  return value;
}

function gitRevisionHex(value, label) {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) throw new Error(`${label} must be a full lowercase Git object id`);
  return value;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateLineage(lineage, label, expectedCount) {
  object(lineage, label);
  if (lineage.schema !== LINEAGE_SCHEMA) throw new Error(`${label} must use ${LINEAGE_SCHEMA}`);
  const holes = lineage.holes;
  const steps = lineage.steps;
  if (!Array.isArray(holes) || holes.length !== expectedCount) throw new Error(`${label} hole count drifted`);
  if (!Array.isArray(steps) || steps.length !== expectedCount) throw new Error(`${label} step count drifted`);
  sha256Hex(lineage.lineage_sha256, `${label} lineage digest`);
  sha256Hex(lineage.cumulative_recipe_sha256, `${label} cumulative recipe digest`);
  const output = object(lineage.output, `${label} output`);
  sha256Hex(output.sha256, `${label} output GLB digest`);
  if (output.partition_axis !== "u" && output.partition_axis !== "v") throw new Error(`${label} partition axis must be u or v`);
  const topology = object(output.topology, `${label} topology`);
  if (topology.status !== "CLOSED_ORIENTED_EDGE_MANIFOLD_CANDIDATE" || topology.triangle_component_count !== 1) {
    throw new Error(`${label} output did not remain one closed oriented component`);
  }
  for (let index = 0; index < holes.length; index += 1) {
    const hole = object(holes[index], `${label} hole ${index}`);
    const step = object(steps[index], `${label} step ${index}`);
    sha256Hex(hole.resolved_hole_sha256, `${label} hole digest ${index}`);
    sha256Hex(step.hole_sha256, `${label} step hole digest ${index}`);
    sha256Hex(step.parent_state_sha256, `${label} parent state ${index}`);
    sha256Hex(step.state_sha256, `${label} state digest ${index}`);
    if (step.step !== index + 1 || step.hole_id !== hole.id || step.hole_sha256 !== hole.resolved_hole_sha256) {
      throw new Error(`${label} append-only hole/step identity drifted at ${index + 1}`);
    }
  }
  return { holes, steps, output, truth: object(lineage.truth_boundary, `${label} truth boundary`) };
}

export function verifyMultiHoleChainDonorBundle(bundle) {
  object(bundle, "multi-hole donor bundle");
  if (bundle.contract !== "AXM_UC_MULTI_HOLE_CHAIN_DONOR_BUNDLE" || bundle.version !== 1) {
    throw new Error("unexpected multi-hole donor bundle contract");
  }
  const donor = object(bundle.donor, "multi-hole donor identity");
  if (donor.repository !== "mike-axiom-mir/axm-universal-creation") throw new Error("unexpected multi-hole donor repository");
  gitRevisionHex(donor.revision, "multi-hole donor revision");
  if (donor.public_route !== "mesh-laser-hole-chain") throw new Error("multi-hole proof must exercise mesh-laser-hole-chain");
  if (donor.capability_version !== "0.5.0") throw new Error("multi-hole proof must exercise UC precision cutter capability v0.5.0");

  const source = object(bundle.source, "root source");
  const stageOne = object(bundle.stage_one, "stage one");
  const stageTwo = object(bundle.stage_two, "stage two");
  const rootSha = sha256Hex(source.glb_sha256, "root source GLB digest");
  if (source.unchanged_after_all_stages !== true) throw new Error("root source was not preserved through the chain");

  const stageOneSha = sha256Hex(stageOne.glb_sha256, "stage-one GLB digest");
  const stageTwoSha = sha256Hex(stageTwo.glb_sha256, "stage-two GLB digest");
  if (new Set([rootSha, stageOneSha, stageTwoSha]).size !== 3) throw new Error("fabrication stages did not produce distinct GLB identities");
  if (stageOne.source_sha256 !== rootSha) throw new Error("stage one lost root source identity");
  if (stageTwo.source_sha256 !== stageOneSha) throw new Error("stage two did not resume from exact stage-one GLB identity");
  if (stageOne.truth_status !== "VALIDATED_HASH_LINKED_MULTI_HOLE_FABRICATION_CHAIN" || stageTwo.truth_status !== stageOne.truth_status) {
    throw new Error("UC public route did not return validated hash-linked multi-hole chain status");
  }
  if (integer(stageOne.cumulative_hole_count, "stage-one cumulative hole count", 1) !== 2) throw new Error("stage one must contain exactly two cumulative holes in this proof");
  if (integer(stageTwo.cumulative_hole_count, "stage-two cumulative hole count", 1) !== 3) throw new Error("stage two must contain exactly three cumulative holes in this proof");
  if (stageOne.glb_validation_passed !== true || stageTwo.glb_validation_passed !== true) throw new Error("one or more published chain GLBs failed donor validation");
  sha256Hex(stageOne.lineage_receipt_sha256, "stage-one lineage receipt SHA-256");
  sha256Hex(stageTwo.lineage_receipt_sha256, "stage-two lineage receipt SHA-256");

  const one = validateLineage(object(stageOne.lineage, "stage-one lineage"), "stage-one lineage", 2);
  const two = validateLineage(object(stageTwo.lineage, "stage-two lineage"), "stage-two lineage", 3);
  if (stageOne.lineage_sha256 !== stageOne.lineage.lineage_sha256 || stageTwo.lineage_sha256 !== stageTwo.lineage.lineage_sha256) {
    throw new Error("public-route lineage identity differs from retained receipt lineage");
  }
  if (stageTwo.parent_lineage_sha256 !== stageOne.lineage_sha256 || stageTwo.lineage.parent_lineage_sha256 !== stageOne.lineage_sha256) {
    throw new Error("stage-two parent lineage does not point to exact stage-one lineage");
  }
  if (!same(two.holes.slice(0, 2), one.holes)) throw new Error("stage two silently rewrote retained stage-one hole receipts");
  if (!same(two.steps.slice(0, 2), one.steps)) throw new Error("stage two silently rewrote retained stage-one hash-linked steps");
  if (two.truth.previous_output_recompiled_before_resume !== true) throw new Error("stage two did not prove deterministic prior-output reconstruction before resume");
  if (two.truth.hash_linked_append_only_steps !== true || two.truth.inner_hole_boundaries_stable_when_new_holes_are_appended !== true) {
    throw new Error("stage-two append-only/stable-hole continuity boundary drifted");
  }
  if (two.truth.notch_and_hole_mixing !== "NOT_SUPPORTED" || two.truth.cross_axis_chain !== "NOT_SUPPORTED" || two.truth.full_arbitrary_mesh_csg !== false) {
    throw new Error("multi-hole unsupported-operation boundary drifted");
  }
  if (one.output.sha256 !== stageOneSha || two.output.sha256 !== stageTwoSha) throw new Error("lineage output digest lost published GLB identity");
  if (stageOne.partition_axis !== one.output.partition_axis || stageTwo.partition_axis !== two.output.partition_axis) throw new Error("public-route partition evidence differs from lineage output");

  const sourceSurface = validateUcSurface(source.surface, "root source UC surface");
  const oneSurface = validateUcSurface(stageOne.surface, "stage-one UC surface");
  const twoSurface = validateUcSurface(stageTwo.surface, "stage-two UC surface");
  if (sourceSurface.surfaceDigest === oneSurface.surfaceDigest || oneSurface.surfaceDigest === twoSurface.surfaceDigest || sourceSurface.surfaceDigest === twoSurface.surfaceDigest) {
    throw new Error("root/stage surfaces are not three distinct geometry states");
  }
  if (stageOne.geometry?.triangles !== oneSurface.triangleCount || stageTwo.geometry?.triangles !== twoSurface.triangleCount) {
    throw new Error("chain geometry counts do not match supplied UC surfaces");
  }
  return {
    donor_revision: donor.revision,
    public_route: donor.public_route,
    capability_version: donor.capability_version,
    root_glb_sha256: rootSha,
    stage_one_glb_sha256: stageOneSha,
    stage_two_glb_sha256: stageTwoSha,
    stage_one_lineage_sha256: stageOne.lineage_sha256,
    stage_two_lineage_sha256: stageTwo.lineage_sha256,
    root_triangles: sourceSurface.triangleCount,
    stage_one_triangles: oneSurface.triangleCount,
    stage_two_triangles: twoSurface.triangleCount,
    stage_one_partition_axis: stageOne.partition_axis,
    stage_two_partition_axis: stageTwo.partition_axis,
    retained_hole_receipts_stable: true,
    prior_output_recompiled_before_resume: true,
  };
}

export function buildUcMultiHoleChainSceneSet(bundleBytes, options = {}) {
  const bytes = Buffer.isBuffer(bundleBytes) ? bundleBytes : Buffer.from(bundleBytes);
  let bundle;
  try { bundle = JSON.parse(bytes.toString("utf8")); } catch (error) { throw new Error(`invalid multi-hole donor bundle JSON: ${error.message}`); }
  const donorObservation = verifyMultiHoleChainDonorBundle(bundle);
  const albedo = options.albedo ?? [82, 180, 210];
  const source = ucSurfaceToAxmScene(bundle.source.surface, { albedo });
  const stageOne = ucSurfaceToAxmScene(bundle.stage_one.surface, { albedo });
  const stageTwo = ucSurfaceToAxmScene(bundle.stage_two.surface, { albedo });
  const sceneDigests = [source.observation.output_sha256, stageOne.observation.output_sha256, stageTwo.observation.output_sha256];
  if (new Set(sceneDigests).size !== 3) throw new Error("multi-hole root/stage AXM scenes are not three distinct states");
  const albedoKey = (row) => JSON.stringify(row.observation.constant_albedo_rgb);
  if (new Set([albedoKey(source), albedoKey(stageOne), albedoKey(stageTwo)]).size !== 1) throw new Error("multi-hole scenes do not share the same adapter albedo");
  return {
    sourceSceneBytes: source.bytes,
    stageOneSceneBytes: stageOne.bytes,
    stageTwoSceneBytes: stageTwo.bytes,
    observation: {
      schema: "axm.creative-render.uc-multi-hole-chain-render-bridge/v1",
      donor_bundle_sha256: sha256(bytes),
      donor: donorObservation,
      source_scene: source.observation,
      stage_one_scene: stageOne.observation,
      stage_two_scene: stageTwo.observation,
      source_preserved: true,
      same_adapter_albedo: true,
      authority: {
        root_source_glb: "CALLER_SELECTED_READ_ONLY_ROOT_SOURCE",
        fabrication_glbs_and_surfaces: "DERIVED_UC_HASH_LINKED_FABRICATION_CANDIDATES",
        lineage_receipts: "DERIVED_UC_FABRICATION_EVIDENCE",
        axm_scenes: "DERIVED_RENDERER_ADAPTER_STATE",
        pixels: "DERIVED_RENDER_FABRIC_OUTPUT",
      },
      truth_boundary: {
        proves: [
          "the current pinned UC v0.5 public hole-chain route can create two bounded round holes and resume from their exact hash-linked output/receipt to append a third hole",
          "resume retains the first two hole receipts and hash-linked steps while proving deterministic reconstruction of the prior cumulative output before append",
          "the read-only root source and both derived cumulative UC surfaces can become distinct same-albedo AXM_SCENE 1 renderer inputs",
        ],
        does_not_prove: [
          "general cut-output chaining, arbitrary-mesh CSG, cross-axis chains, mixed notch-and-hole chains, or non-separable multi-hole layouts",
          "UV, texture, tangent, vertex-color, rich material, skin, rig, or animation preservation through AXM_SCENE 1",
          "cryptographic authorship, self-intersection freedom, manufacturing/structural correctness, host-engine import, visual quality, or cross-machine bitwise determinism",
          "native Render Fabric pixels until an external renderer workflow consumes and receipt-verifies all three scenes",
        ],
      },
    },
  };
}
