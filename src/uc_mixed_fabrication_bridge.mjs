import { sha256 } from "./creative_scene_operator.mjs";
import { ucSurfaceToAxmScene, validateUcSurface } from "./uc_oriented_cut_bridge.mjs";

const LINEAGE_SCHEMA = "axm.mesh-mixed-fabrication-lineage/v0.7";
const ALLOWED_OPERATIONS = new Set(["round-through-hole", "box-notch"]);

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

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function validateLineage(lineage, label, expectedCount) {
  object(lineage, label);
  if (lineage.schema !== LINEAGE_SCHEMA) throw new Error(`${label} must use ${LINEAGE_SCHEMA}`);
  sha256Hex(lineage.lineage_sha256, `${label} lineage digest`);
  sha256Hex(lineage.cumulative_recipe_sha256, `${label} cumulative recipe digest`);
  const operations = lineage.operations;
  const steps = lineage.steps;
  if (!Array.isArray(operations) || operations.length !== expectedCount) throw new Error(`${label} operation count drifted`);
  if (!Array.isArray(steps) || steps.length !== expectedCount) throw new Error(`${label} step count drifted`);
  const ids = new Set();
  for (let index = 0; index < operations.length; index += 1) {
    const operation = object(operations[index], `${label} operation ${index}`);
    const step = object(steps[index], `${label} step ${index}`);
    if (typeof operation.id !== "string" || !operation.id || ids.has(operation.id)) throw new Error(`${label} operation ids must be non-empty and unique`);
    ids.add(operation.id);
    if (!ALLOWED_OPERATIONS.has(operation.operation)) throw new Error(`${label} contains unsupported operation ${String(operation.operation)}`);
    sha256Hex(operation.resolved_operation_sha256, `${label} operation digest ${index}`);
    sha256Hex(step.operation_sha256, `${label} step operation digest ${index}`);
    sha256Hex(step.parent_state_sha256, `${label} step parent state ${index}`);
    sha256Hex(step.state_sha256, `${label} step state ${index}`);
    if (step.step !== index + 1 || step.operation_id !== operation.id || step.operation !== operation.operation || step.operation_sha256 !== operation.resolved_operation_sha256) {
      throw new Error(`${label} append-only operation/step identity drifted at ${index + 1}`);
    }
  }
  const output = object(lineage.output, `${label} output`);
  sha256Hex(output.sha256, `${label} output GLB digest`);
  sha256Hex(output.specification_sha256, `${label} output specification digest`);
  const topology = object(output.topology, `${label} topology`);
  if (topology.status !== "CLOSED_ORIENTED_EDGE_MANIFOLD_CANDIDATE" || topology.triangle_component_count !== 1) {
    throw new Error(`${label} output did not remain one closed oriented component`);
  }
  const metrics = object(output.metrics, `${label} metrics`);
  return { operations, steps, output, topology, metrics, truth: object(lineage.truth_boundary, `${label} truth boundary`) };
}

export function verifyMixedFabricationDonorBundle(bundle) {
  object(bundle, "mixed fabrication donor bundle");
  if (bundle.contract !== "AXM_UC_MIXED_FABRICATION_DONOR_BUNDLE" || bundle.version !== 1) throw new Error("unexpected mixed fabrication donor bundle contract");
  const donor = object(bundle.donor, "mixed fabrication donor identity");
  if (donor.repository !== "mike-axiom-mir/axm-universal-creation") throw new Error("unexpected mixed fabrication donor repository");
  gitRevisionHex(donor.revision, "mixed fabrication donor revision");
  if (donor.public_route !== "mesh-mixed-fabrication-chain") throw new Error("mixed fabrication proof must exercise mesh-mixed-fabrication-chain");
  if (donor.capability_version !== "0.7.0") throw new Error("mixed fabrication proof must exercise UC precision cutter capability v0.7.0");

  const source = object(bundle.source, "root source");
  const stageOne = object(bundle.stage_one, "mixed stage one");
  const stageTwo = object(bundle.stage_two, "mixed stage two");
  const rootSha = sha256Hex(source.glb_sha256, "root source GLB digest");
  const oneSha = sha256Hex(stageOne.glb_sha256, "stage-one GLB digest");
  const twoSha = sha256Hex(stageTwo.glb_sha256, "stage-two GLB digest");
  if (new Set([rootSha, oneSha, twoSha]).size !== 3) throw new Error("mixed fabrication stages did not produce three distinct GLB identities");
  if (source.unchanged_after_all_stages !== true) throw new Error("root source was not preserved through mixed fabrication");
  if (stageOne.source_sha256 !== rootSha || stageTwo.source_sha256 !== oneSha) throw new Error("mixed fabrication source identity chain drifted");
  if (stageOne.truth_status !== "VALIDATED_HASH_LINKED_MIXED_FABRICATION_CHAIN" || stageTwo.truth_status !== stageOne.truth_status) throw new Error("UC public route did not return validated mixed-fabrication status");
  if (integer(stageOne.cumulative_operation_count, "stage-one cumulative operation count", 1) !== 2) throw new Error("stage one must contain exactly two cumulative operations in this proof");
  if (integer(stageTwo.cumulative_operation_count, "stage-two cumulative operation count", 1) !== 3) throw new Error("stage two must contain exactly three cumulative operations in this proof");
  if (stageOne.glb_validation_passed !== true || stageTwo.glb_validation_passed !== true) throw new Error("one or more mixed-fabrication GLBs failed donor validation");
  sha256Hex(stageOne.lineage_receipt_sha256, "stage-one lineage receipt digest");
  sha256Hex(stageTwo.lineage_receipt_sha256, "stage-two lineage receipt digest");

  const one = validateLineage(object(stageOne.lineage, "stage-one lineage"), "stage-one lineage", 2);
  const two = validateLineage(object(stageTwo.lineage, "stage-two lineage"), "stage-two lineage", 3);
  if (stageOne.lineage_sha256 !== stageOne.lineage.lineage_sha256 || stageTwo.lineage_sha256 !== stageTwo.lineage.lineage_sha256) throw new Error("public-route lineage identity differs from retained receipt lineage");
  if (stageTwo.parent_lineage_sha256 !== stageOne.lineage_sha256 || stageTwo.lineage.parent_lineage_sha256 !== stageOne.lineage_sha256) throw new Error("stage-two parent lineage does not point to exact stage-one lineage");
  if (!same(two.operations.slice(0, 2), one.operations)) throw new Error("stage two silently rewrote retained stage-one operations");
  if (!same(two.steps.slice(0, 2), one.steps)) throw new Error("stage two silently rewrote retained stage-one hash-linked steps");
  if (one.output.sha256 !== oneSha || two.output.sha256 !== twoSha) throw new Error("mixed lineage output digest lost published GLB identity");
  if (one.truth.same_axis_mixed_holes_and_notches !== true || two.truth.same_axis_mixed_holes_and_notches !== true) throw new Error("mixed hole/notch truth boundary drifted");
  if (two.truth.v07_resume_requires_exact_v07_recompile !== true || two.truth.nonoverlap_and_nontouch_required !== true) throw new Error("mixed resume/reconstruction truth boundary drifted");
  if (two.truth.cross_axis_chain !== "NOT_SUPPORTED" || two.truth.general_arbitrary_mesh_csg !== false) throw new Error("mixed unsupported-operation boundary drifted");
  if (Number(one.metrics.hole_count) !== 1 || Number(one.metrics.notch_count) !== 1 || Number(two.metrics.hole_count) !== 1 || Number(two.metrics.notch_count) !== 2) throw new Error("mixed operation-kind accounting drifted");
  if (!(Number(two.metrics.removed_volume) > Number(one.metrics.removed_volume) && Number(one.metrics.removed_volume) > 0)) throw new Error("mixed removed-volume evidence did not grow across append");

  const sourceSurface = validateUcSurface(source.surface, "root source UC surface");
  const oneSurface = validateUcSurface(stageOne.surface, "stage-one UC surface");
  const twoSurface = validateUcSurface(stageTwo.surface, "stage-two UC surface");
  if (new Set([sourceSurface.surfaceDigest, oneSurface.surfaceDigest, twoSurface.surfaceDigest]).size !== 3) throw new Error("root/mixed-stage surfaces are not three distinct geometry states");
  if (stageOne.geometry?.triangles !== oneSurface.triangleCount || stageTwo.geometry?.triangles !== twoSurface.triangleCount) throw new Error("mixed geometry counts do not match supplied UC surfaces");

  return {
    donor_revision: donor.revision,
    public_route: donor.public_route,
    capability_version: donor.capability_version,
    root_glb_sha256: rootSha,
    stage_one_glb_sha256: oneSha,
    stage_two_glb_sha256: twoSha,
    stage_one_lineage_sha256: stageOne.lineage_sha256,
    stage_two_lineage_sha256: stageTwo.lineage_sha256,
    root_triangles: sourceSurface.triangleCount,
    stage_one_triangles: oneSurface.triangleCount,
    stage_two_triangles: twoSurface.triangleCount,
    stage_one_operations: one.operations.map((row) => row.operation),
    stage_two_operations: two.operations.map((row) => row.operation),
    retained_operation_receipts_stable: true,
    exact_v07_recompile_before_resume: true,
    stage_one_removed_volume: Number(one.metrics.removed_volume),
    stage_two_removed_volume: Number(two.metrics.removed_volume),
  };
}

export function buildUcMixedFabricationSceneSet(bundleBytes, options = {}) {
  const bytes = Buffer.isBuffer(bundleBytes) ? bundleBytes : Buffer.from(bundleBytes);
  let bundle;
  try { bundle = JSON.parse(bytes.toString("utf8")); } catch (error) { throw new Error(`invalid mixed fabrication donor bundle JSON: ${error.message}`); }
  const donorObservation = verifyMixedFabricationDonorBundle(bundle);
  const albedo = options.albedo ?? [82, 180, 210];
  const source = ucSurfaceToAxmScene(bundle.source.surface, { albedo });
  const stageOne = ucSurfaceToAxmScene(bundle.stage_one.surface, { albedo });
  const stageTwo = ucSurfaceToAxmScene(bundle.stage_two.surface, { albedo });
  if (new Set([source.observation.output_sha256, stageOne.observation.output_sha256, stageTwo.observation.output_sha256]).size !== 3) throw new Error("mixed fabrication root/stage AXM scenes are not three distinct states");
  const color = (row) => JSON.stringify(row.observation.constant_albedo_rgb);
  if (new Set([color(source), color(stageOne), color(stageTwo)]).size !== 1) throw new Error("mixed fabrication scenes do not share one adapter albedo");
  return {
    sourceSceneBytes: source.bytes,
    stageOneSceneBytes: stageOne.bytes,
    stageTwoSceneBytes: stageTwo.bytes,
    observation: {
      schema: "axm.creative-render.uc-mixed-fabrication-render-bridge/v1",
      donor_bundle_sha256: sha256(bytes),
      donor: donorObservation,
      source_scene: source.observation,
      stage_one_scene: stageOne.observation,
      stage_two_scene: stageTwo.observation,
      source_preserved: true,
      same_adapter_albedo: true,
      authority: {
        root_source_glb: "CALLER_SELECTED_READ_ONLY_ROOT_SOURCE",
        fabrication_glbs_and_surfaces: "DERIVED_UC_HASH_LINKED_MIXED_FABRICATION_CANDIDATES",
        lineage_receipts: "DERIVED_UC_MIXED_FABRICATION_EVIDENCE",
        axm_scenes: "DERIVED_RENDERER_ADAPTER_STATE",
        pixels: "DERIVED_RENDER_FABRIC_OUTPUT",
      },
      truth_boundary: {
        proves: [
          "the pinned current UC v0.7 public route can create one same-axis round hole plus one boundary-open box notch, then resume from the exact output and lineage to append a second notch",
          "resume retains prior operation and step receipts while requiring exact deterministic v0.7 reconstruction of the parent output before append",
          "the root source and both derived mixed-fabrication UC surfaces can become distinct same-albedo AXM_SCENE 1 renderer inputs",
        ],
        does_not_prove: [
          "cross-axis chains, overlapping/touching cuts, arbitrary imported-mesh surgery, or general 3D boolean CSG",
          "UV, texture, tangent, vertex-color, rich material, skin, rig, or animation preservation through AXM_SCENE 1",
          "cryptographic authorship, self-intersection freedom beyond the donor's explicit non-overlap/manifold gates, structural/manufacturing correctness, host-engine import, visual quality, or cross-machine bitwise determinism",
          "native pixels until an external Render Fabric workflow consumes and receipt-verifies all three scenes",
        ],
      },
    },
  };
}
