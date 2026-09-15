import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  observeUniversalCreation,
  observeVisualEffectFabric,
  precisionMeshToAxmScene,
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
    join(dir, "holographic-ai-state-native.mjs"),
    `const hand={schema:'axm.hand/v0.1',id:'fx.fixture',version:'0.1.0',execute(state){return {state:{...state,realizations:{holographicAiStateNative:{mediaType:'text/html',renderer:'axm.vfx.fixture/v0.1',derivedFromStateHash:'fixture-canonical',workingSet:{canonicalStateRetained:true,derivedGpuDataRebuildable:true,bodyBufferBuildPolicy:'once-per-body-hash',behaviorDeltaPolicy:'uniform-only',workingSetHash:'fixture-working',pointCount:12,modeledBufferBytes:336},content:'<canvas id="fixture"></canvas>'}}}}}};\nexport const HOLOGRAPHIC_AI_STATE_NATIVE_HANDS=[hand];\nexport const HOLOGRAPHIC_AI_STATE_NATIVE_GRAPH={schema:'axm.hand-graph/v0.1',id:'fx.fixture.graph',version:'0.1.0',stages:[{id:'realize',hand:'fx.fixture',params:{}}]};\nexport function makeHolographicAiInitialState(){return {effect:{id:'fixture'}};}\n`,
  );
}

test("precision mesh adapter emits AXM_SCENE 1 triangles", () => {
  const scene = precisionMeshToAxmScene({
    positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
    indices: [0, 1, 2],
  });
  assert.equal(scene.version, 1);
  assert.equal(scene.triangles.length, 1);
  assert.deepEqual(scene.triangles[0].albedo, [94, 196, 255]);
  assert.throws(
    () => precisionMeshToAxmScene({ positions: [0, 0, 0], indices: [0, 1, 0] }),
    /out of range/,
  );
});

test("Universal Creation donor runs a bounded Creative Flow into AXM scene state", async () => {
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
});

test("Visual Effect Fabric donor executes a state-native Hand graph", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-"));
  await makeVfxFixture(root);
  const result = await observeVisualEffectFabric(root);
  assert.equal(result.observation.graph_id, "fx.fixture.graph");
  assert.equal(result.observation.executed_stage_count, 1);
  assert.equal(result.observation.renderer, "axm.vfx.fixture/v0.1");
  assert.equal(result.observation.canonical_state_retained, true);
  assert.equal(result.observation.derived_gpu_data_rebuildable, true);
  assert.match(result.htmlBytes.toString("utf8"), /<canvas/);
});
