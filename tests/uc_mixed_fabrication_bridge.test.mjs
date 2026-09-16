import test from "node:test";
import assert from "node:assert/strict";

import { buildUcMixedFabricationSceneSet, verifyMixedFabricationDonorBundle } from "../src/uc_mixed_fabrication_bridge.mjs";
import { parseScene } from "../src/creative_scene_operator.mjs";

const hex64 = (c) => c.repeat(64);
const hex40 = (c) => c.repeat(40);

function surface(name, extra = 0) {
  const positions = [[0,0,0],[2,0,0],[2,2,0],[0,2,0],[1,1,0],[1.5,1,0]];
  const sets = [[0,1,2,0,2,3],[0,1,4,1,2,4,2,3,4],[0,1,4,1,5,4,1,2,5,2,3,5,3,4,5]];
  return {schema:"axm.surface-3d/v0.1",name,primitives:[{id:"fabrication",positions,normals:positions.map(()=>[0,0,1]),indices:sets[extra],material:{color:"#527A91FF"}}]};
}

function operation(id, kind, digest) {
  return kind === "round-through-hole"
    ? {id,operation:kind,center_world:[0,0,0],center_canonical:[0,0,0],requested_radius:.1,effective_radius:.11,segments:16,kerf:.02,resolved_operation_sha256:digest}
    : {id,operation:kind,center_world:[0,0,0],center_canonical:[0,0,0],side:"u-max",span:.2,depth:.1,kerf:.02,rectangle:[.8,-.1,1,.1],resolved_operation_sha256:digest};
}

function lineage(count, outputSha, lineageSha, parentLineage = null) {
  const kinds=["round-through-hole","box-notch","box-notch"], ids=["hole-a","notch-a","notch-b"], digests=[hex64("1"),hex64("2"),hex64("3")];
  const operations=ids.slice(0,count).map((id,i)=>operation(id,kinds[i],digests[i]));
  const states=[hex64("4"),hex64("5"),hex64("6")], root=hex64("a");
  const steps=operations.map((op,i)=>({step:i+1,operation_id:op.id,operation:op.operation,operation_sha256:op.resolved_operation_sha256,parent_state_sha256:i?states[i-1]:root,state_sha256:states[i]}));
  return {
    schema:"axm.mesh-mixed-fabrication-lineage/v0.7",root:{root_sha256:root},axis:{},parent_lineage_sha256:parentLineage,migration:null,
    operations,steps,cumulative_recipe_sha256:hex64("7"),
    output:{name:`stage-${count}`,sha256:outputSha,specification_sha256:hex64("8"),geometry:{triangles:count===2?3:5},topology:{status:"CLOSED_ORIENTED_EDGE_MANIFOLD_CANDIDATE",triangle_component_count:1},metrics:{removed_volume:count===2?.12:.18,hole_count:1,notch_count:count-1}},
    truth_boundary:{same_axis_mixed_holes_and_notches:true,legacy_lineage_upgrade_requires_exact_legacy_recompile:true,v07_resume_requires_exact_v07_recompile:true,nonoverlap_and_nontouch_required:true,cross_axis_chain:"NOT_SUPPORTED",general_arbitrary_mesh_csg:false},
    lineage_sha256:lineageSha,
  };
}

function bundle() {
  const root=hex64("b"),one=hex64("c"),two=hex64("d"),oneLineage=hex64("e"),twoLineage=hex64("f");
  return {
    contract:"AXM_UC_MIXED_FABRICATION_DONOR_BUNDLE",version:1,
    donor:{repository:"mike-axiom-mir/axm-universal-creation",revision:hex40("9"),public_route:"mesh-mixed-fabrication-chain",capability_version:"0.7.0"},
    source:{glb_sha256:root,unchanged_after_all_stages:true,surface:surface("root",0)},
    stage_one:{truth_status:"VALIDATED_HASH_LINKED_MIXED_FABRICATION_CHAIN",source_sha256:root,glb_sha256:one,lineage_sha256:oneLineage,lineage_receipt_sha256:hex64("0"),cumulative_operation_count:2,geometry:{triangles:3},metrics:{hole_count:1,notch_count:1,removed_volume:.12},glb_validation_passed:true,lineage:lineage(2,one,oneLineage),surface:surface("one",1)},
    stage_two:{truth_status:"VALIDATED_HASH_LINKED_MIXED_FABRICATION_CHAIN",source_sha256:one,glb_sha256:two,lineage_sha256:twoLineage,parent_lineage_sha256:oneLineage,lineage_receipt_sha256:hex64("a"),cumulative_operation_count:3,geometry:{triangles:5},metrics:{hole_count:1,notch_count:2,removed_volume:.18},glb_validation_passed:true,lineage:lineage(3,two,twoLineage,oneLineage),surface:surface("two",2)},
  };
}

test("mixed fabrication keeps root authoritative and preserves operation lineage across resume", () => {
  const observed=verifyMixedFabricationDonorBundle(bundle());
  assert.deepEqual(observed.stage_one_operations,["round-through-hole","box-notch"]);
  assert.deepEqual(observed.stage_two_operations,["round-through-hole","box-notch","box-notch"]);
  assert.equal(observed.retained_operation_receipts_stable,true);
  assert.equal(observed.exact_v07_recompile_before_resume,true);
  assert(observed.stage_two_removed_volume>observed.stage_one_removed_volume);
});

test("mixed fabrication becomes three distinct same-albedo renderer-neutral scenes", () => {
  const result=buildUcMixedFabricationSceneSet(Buffer.from(JSON.stringify(bundle())),{albedo:[12,34,56]});
  assert.equal(result.observation.source_preserved,true);
  assert.equal(result.observation.same_adapter_albedo,true);
  const scenes=[result.sourceSceneBytes,result.stageOneSceneBytes,result.stageTwoSceneBytes].map(bytes=>parseScene(bytes.toString("utf8")));
  assert.deepEqual(scenes.map(scene=>scene.triangles.length),[2,3,5]);
  assert(scenes.every(scene=>JSON.stringify(scene.triangles[0].albedo)===JSON.stringify([12,34,56])));
});

test("mixed resume fails closed on parent drift, retained rewrite, or missing reconstruction gate", () => {
  const parent=bundle(); parent.stage_two.parent_lineage_sha256=hex64("1");
  assert.throws(()=>verifyMixedFabricationDonorBundle(parent),/parent lineage/);
  const rewrite=bundle(); rewrite.stage_two.lineage.operations[0].requested_radius=.99;
  assert.throws(()=>verifyMixedFabricationDonorBundle(rewrite),/rewrote retained stage-one operations/);
  const noRebuild=bundle(); noRebuild.stage_two.lineage.truth_boundary.v07_resume_requires_exact_v07_recompile=false;
  assert.throws(()=>verifyMixedFabricationDonorBundle(noRebuild),/resume\/reconstruction/);
});

test("mixed bridge rejects source mutation and unsupported authority expansion", () => {
  const changed=bundle(); changed.source.unchanged_after_all_stages=false;
  assert.throws(()=>verifyMixedFabricationDonorBundle(changed),/root source was not preserved/);
  const cross=bundle(); cross.stage_two.lineage.truth_boundary.cross_axis_chain="SUPPORTED";
  assert.throws(()=>verifyMixedFabricationDonorBundle(cross),/unsupported-operation boundary/);
  const csg=bundle(); csg.stage_two.lineage.truth_boundary.general_arbitrary_mesh_csg=true;
  assert.throws(()=>verifyMixedFabricationDonorBundle(csg),/unsupported-operation boundary/);
});
