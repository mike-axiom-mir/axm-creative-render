import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  observeUniversalCreation,
  observeVisualEffectFabric,
  precisionMeshToAxmScene,
  precisionMeshToHolographicForm,
} from "../src/donor_bridge.mjs";
import { parseScene } from "../src/creative_scene_operator.mjs";

async function makeUcFixture(root) {
  const dir = join(root, "capabilities", "platform-hands");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "index.js"),
    `const mesh={schema:'axm.precision-mesh/v1',positions:[-1,-1,0,1,-1,0,0,1,0],indices:[0,1,2]};\nmodule.exports={creativeHands:{version:'fixture-1',audit(){return {total:2,digest:'audit-fixture'}},recipeRegistry(){return {count:3,digest:'recipes-fixture'}}},creativeFlow:{version:'fixture-flow-1',summary(){return {state:'EXECUTABLE',digest:'flow-summary-fixture'}},run(request){return {status:'PASS',candidate_ready:true,source_state_mutated:false,digest:'flow-result-fixture',receipts:request.steps.map((step)=>({status:'PASS',operation_id:step.hand_id||step.recipe_id})),final_state:{render_mesh:mesh,bounds:{size:[2,2,0]}},outputs:{bounds:{size:[2,2,0]}}}}}};\n`,
  );
}

async function makeVfxFixture(root) {
  const dir = join(root, "hand-lab", "src");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "hand-runtime.mjs"),
    `import {createHash} from 'node:crypto';\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=structuredClone(initialState);const ids=[];for(const stage of graph.stages){const hand=registry.get(stage.hand);const result=hand.execute(state,stage.params||{});state=result.state;ids.push(stage.id)}const hash=createHash('sha256').update(JSON.stringify(state)).digest('hex');return {graph:{id:graph.id,version:graph.version},finalState:state,finalStateHash:hash,executedStageIds:ids};}\n`,
  );
  await writeFile(
    join(dir, "holographic-state-projector.mjs"),
    `const hand={schema:'axm.hand/v0.1',id:'fx.fixture',version:'0.1.0',execute(state){const points=state.form.primitives.length*24;return {state:{...state,sampleField:{schema:'axm.holographic-sample-field/v0.1',pointCount:points},realizations:{holographicStateProjector:{mediaType:'text/html',renderer:'axm.vfx.holographic-state-projector/v0.1',derivedFromStateHash:'fixture-derived',canonicalFormHash:'fixture-form-hash',sampleFieldHash:'fixture-field-hash',workingSet:{canonicalFormRetained:true,derivedSampleFieldEditable:true,derivedGpuDataRebuildable:true,fieldBufferBuildPolicy:'once-per-sample-field-hash',sampleFieldHash:'fixture-field-hash',pointCount:points,modeledBufferBytes:points*28},content:'<canvas id="fixture"></canvas>'}}}}}};\nexport const HOLOGRAPHIC_STATE_PROJECTOR_HANDS=[hand];\nexport const HOLOGRAPHIC_STATE_PROJECTOR_GRAPH={schema:'axm.hand-graph/v0.1',id:'fx.holographic-state-projector',version:'0.1.0',stages:[{id:'realize',hand:'fx.fixture',params:{}}]};\nexport function makeHolographicFormState(form,seed=1){return {effect:{seed},form:structuredClone(form)};}\nexport function makeGlobeForm(){return {id:'fixture-globe',primitives:[{type:'sphere'}]};}\n`,
  );
}

const triangleMesh = {
  positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
  indices: [0, 1, 2],
};

test("precision mesh adapter emits AXM_SCENE 1 triangles", () => {
  const scene = precisionMeshToAxmScene(triangleMesh);
  assert.equal(scene.version, 1);
  assert.equal(scene.triangles.length, 1);
  assert.deepEqual(scene.triangles[0].albedo, [94, 196, 255]);
  assert.throws(
    () => precisionMeshToAxmScene({ positions: [0, 0, 0], indices: [0, 1, 0] }),
    /out of range/,
  );
});

test("precision mesh can become a bounded generic holographic form", () => {
  const form = precisionMeshToHolographicForm(triangleMesh, { id: "triangle-hologram" });
  assert.equal(form.id, "triangle-hologram");
  assert.equal(form.primitives.length, 2);
  assert.equal(form.primitives[0].type, "polyline");
  assert.deepEqual(form.primitives[0].points[0], form.primitives[0].points.at(-1));
  assert.equal(form.primitives[1].type, "points");
  assert.equal(form.primitives[1].points.length, 3);
  assert.equal(form.source.bounded, false);
});

test("Universal Creation donor runs Creative Flow and exposes the same mesh as holographic form state", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-uc-"));
  await makeUcFixture(root);
  const result = await observeUniversalCreation(root);
  const scene = parseScene(result.sceneBytes.toString("utf8"));
  assert.equal(result.observation.hand_count, 2);
  assert.equal(result.observation.recipe_count, 3);
  assert.equal(result.observation.flow_status, "PASS");
  assert.equal(result.observation.flow_receipt_count, 4);
  assert.deepEqual(result.observation.flow_operations, [
    "creative.mesh-primitive.cube",
    "creative.mesh-transform.scale",
    "creative.mesh-transform.rotate-y",
    "mesh-analysis.bounds",
  ]);
  assert.equal(scene.triangles.length, 1);
  assert.equal(result.holographicForm.id, "creative-render-live-donor-cube-hologram");
  assert.equal(result.holographicForm.primitives[0].type, "polyline");
  assert.equal(result.observation.holographic_primitive_count, 2);
});

test("Visual Effect Fabric donor projects caller-supplied generic form state", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-"));
  await makeVfxFixture(root);
  const form = precisionMeshToHolographicForm(triangleMesh, { id: "uc-created-triangle" });
  const result = await observeVisualEffectFabric(root, { form });
  assert.equal(result.observation.graph_id, "fx.holographic-state-projector");
  assert.equal(result.observation.executed_stage_count, 1);
  assert.equal(result.observation.form_id, "uc-created-triangle");
  assert.equal(result.observation.renderer, "axm.vfx.holographic-state-projector/v0.1");
  assert.equal(result.observation.canonical_form_retained, true);
  assert.equal(result.observation.derived_sample_field_editable, true);
  assert.equal(result.observation.derived_gpu_data_rebuildable, true);
  assert.equal(result.observation.field_buffer_build_policy, "once-per-sample-field-hash");
  assert.match(result.htmlBytes.toString("utf8"), /<canvas/);
});
