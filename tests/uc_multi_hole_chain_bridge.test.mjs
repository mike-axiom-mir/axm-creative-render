import test from "node:test";
import assert from "node:assert/strict";

import { buildUcMultiHoleChainSceneSet, verifyMultiHoleChainDonorBundle } from "../src/uc_multi_hole_chain_bridge.mjs";
import { parseScene } from "../src/creative_scene_operator.mjs";

const hex64 = (c) => c.repeat(64);
const hex40 = (c) => c.repeat(40);

function surface(name, extra = 0) {
  const positions = [[0,0,0],[2,0,0],[2,2,0],[0,2,0],[1,1,0],[1.5,1,0]];
  const sets = [
    [0,1,2,0,2,3],
    [0,1,4,1,2,4,2,3,4],
    [0,1,4,1,5,4,1,2,5,2,3,5,3,4,5],
  ];
  const indices = sets[extra];
  return { schema:"axm.surface-3d/v0.1", name, primitives:[{id:"fabrication",positions,normals:positions.map(()=>[0,0,1]),indices,material:{color:"#527A91FF"}}] };
}

function hole(id, digest) {
  return { id, operation:"round-through-hole", center_world:[0,0,0], center_canonical:[0,0,0], requested_radius:.1, effective_radius:.11, segments:16, kerf:.02, polygonized_removed_area:.03, analytic_requested_removed_area:.031, analytic_effective_removed_area:.038, resolved_hole_sha256:digest };
}

function step(index, id, holeDigest, parent, state) {
  return { step:index, hole_id:id, hole_sha256:holeDigest, parent_state_sha256:parent, state_sha256:state };
}

function lineage(count, outputSha, lineageSha, parentLineage = null) {
  const rootState = hex64("a"), h1 = hex64("1"), h2 = hex64("2"), h3 = hex64("3");
  const holes = [hole("left",h1),hole("right",h2),hole("middle",h3)].slice(0,count);
  const steps = [
    step(1,"left",h1,rootState,hex64("4")),
    step(2,"right",h2,hex64("4"),hex64("5")),
    step(3,"middle",h3,hex64("5"),hex64("6")),
  ].slice(0,count);
  return {
    schema:"axm.mesh-hole-fabrication-lineage/v0.5",
    root:{root_sha256:rootState}, axis:{}, parent_lineage_sha256:parentLineage,
    holes, steps, cumulative_recipe_sha256:hex64("7"),
    output:{name:`stage-${count}`,sha256:outputSha,specification_sha256:hex64("8"),partition_axis:"u",geometry:{},topology:{status:"CLOSED_ORIENTED_EDGE_MANIFOLD_CANDIDATE",triangle_component_count:1},metrics:{}},
    truth_boundary:{previous_output_recompiled_before_resume:count>2,hash_linked_append_only_steps:true,inner_hole_boundaries_stable_when_new_holes_are_appended:true,notch_and_hole_mixing:"NOT_SUPPORTED",cross_axis_chain:"NOT_SUPPORTED",full_arbitrary_mesh_csg:false},
    lineage_sha256:lineageSha,
  };
}

function bundle() {
  const root = hex64("b"), one = hex64("c"), two = hex64("d"), oneLineage = hex64("e"), twoLineage = hex64("f");
  return {
    contract:"AXM_UC_MULTI_HOLE_CHAIN_DONOR_BUNDLE",version:1,
    donor:{repository:"mike-axiom-mir/axm-universal-creation",revision:hex40("9"),public_route:"mesh-laser-hole-chain",capability_version:"0.5.0"},
    source:{glb_sha256:root,glb_bytes:500,unchanged_after_all_stages:true,surface:surface("root",0)},
    stage_one:{truth_status:"VALIDATED_HASH_LINKED_MULTI_HOLE_FABRICATION_CHAIN",source_sha256:root,glb_sha256:one,glb_bytes:700,lineage_sha256:oneLineage,lineage_receipt_sha256:hex64("0"),cumulative_hole_count:2,partition_axis:"u",geometry:{triangles:3},glb_validation_passed:true,lineage:lineage(2,one,oneLineage),surface:surface("one",1)},
    stage_two:{truth_status:"VALIDATED_HASH_LINKED_MULTI_HOLE_FABRICATION_CHAIN",source_sha256:one,glb_sha256:two,glb_bytes:900,lineage_sha256:twoLineage,parent_lineage_sha256:oneLineage,lineage_receipt_sha256:hex64("a"),cumulative_hole_count:3,partition_axis:"u",geometry:{triangles:5},glb_validation_passed:true,lineage:lineage(3,two,twoLineage,oneLineage),surface:surface("two",2)},
  };
}

test("multi-hole chain preserves root authority and retains prior hole lineage across resume", () => {
  const value = bundle();
  const observed = verifyMultiHoleChainDonorBundle(value);
  assert.equal(observed.root_triangles,2);
  assert.equal(observed.stage_one_triangles,3);
  assert.equal(observed.stage_two_triangles,5);
  assert.equal(observed.retained_hole_receipts_stable,true);
  assert.equal(observed.prior_output_recompiled_before_resume,true);
});

test("multi-hole chain becomes three distinct same-albedo renderer-neutral scenes", () => {
  const result = buildUcMultiHoleChainSceneSet(Buffer.from(JSON.stringify(bundle())), {albedo:[12,34,56]});
  assert.equal(result.observation.source_preserved,true);
  assert.equal(result.observation.same_adapter_albedo,true);
  const source=parseScene(result.sourceSceneBytes.toString("utf8"));
  const one=parseScene(result.stageOneSceneBytes.toString("utf8"));
  const two=parseScene(result.stageTwoSceneBytes.toString("utf8"));
  assert.deepEqual([source.triangles.length,one.triangles.length,two.triangles.length],[2,3,5]);
  assert.deepEqual(source.triangles[0].albedo,[12,34,56]);
});

test("resume fails closed when parent lineage, retained holes, or reconstruction evidence drift", () => {
  const parent=bundle(); parent.stage_two.parent_lineage_sha256=hex64("1");
  assert.throws(()=>verifyMultiHoleChainDonorBundle(parent),/parent lineage/);

  const rewrite=bundle(); rewrite.stage_two.lineage.holes[0].requested_radius=.12;
  assert.throws(()=>verifyMultiHoleChainDonorBundle(rewrite),/rewrote retained stage-one hole/);

  const noRebuild=bundle(); noRebuild.stage_two.lineage.truth_boundary.previous_output_recompiled_before_resume=false;
  assert.throws(()=>verifyMultiHoleChainDonorBundle(noRebuild),/prior-output reconstruction/);
});

test("unsupported authority expansion and source mutation are rejected", () => {
  const source=bundle(); source.source.unchanged_after_all_stages=false;
  assert.throws(()=>verifyMultiHoleChainDonorBundle(source),/root source was not preserved/);

  const arbitrary=bundle(); arbitrary.stage_two.lineage.truth_boundary.full_arbitrary_mesh_csg=true;
  assert.throws(()=>verifyMultiHoleChainDonorBundle(arbitrary),/unsupported-operation boundary/);
});
