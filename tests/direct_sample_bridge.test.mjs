import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { axmSceneToHolographicSampleField, observeVisualEffectDirectSamples } from "../src/direct_sample_bridge.mjs";
import { serializeScene, sha256 } from "../src/creative_scene_operator.mjs";

const scene = {
  version: 1,
  triangles: [
    { vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], albedo: [80, 160, 240] },
    { vertices: [[-0.5, -0.5, 0.4], [0.5, -0.5, 0.4], [0, 0.5, 0.4]], albedo: [240, 120, 60] },
  ],
};

async function makeVfxFixture(root) {
  const dir = join(root, "hand-lab", "src");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "hand-runtime.mjs"),
    `import {createHash} from 'node:crypto';\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=structuredClone(initialState);const ids=[];for(const stage of graph.stages){const hand=registry.get(stage.hand);if(!hand)throw new Error('missing hand '+stage.hand);state=hand.execute(state,stage.params||{}).state;ids.push(stage.id)}const finalStateHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');return {graph:{id:graph.id,version:graph.version},finalState:state,finalStateHash,executedStageIds:ids};}\n`,
  );
  await writeFile(
    join(dir, "holographic-state-stream.mjs"),
    `const hand={id:'fx.fixture.direct',execute(state){const input=state.sampleFieldInput;const pointCount=input.points.length/7;const field={schema:'axm.holographic-sample-field/v0.2',stride:7,points:[...input.points],pointCount,canonicalFormHash:input.sourceDigest,sourceKind:input.sourceKind};const sampleFieldHash='fixture-field-'+pointCount;const workingSet={canonicalFormRetained:true,derivedSampleFieldEditable:true,derivedGpuDataRebuildable:true,fieldBufferBuildPolicy:'once-per-sample-field-hash',sampleFieldHash,pointCount,modeledBufferBytes:input.points.length*4};return {state:{...state,form:{id:input.id,sourceKind:input.sourceKind,sourceDigest:input.sourceDigest,style:input.style},sampleField:field,realizations:{holographicStateProjector:{renderer:'axm.vfx.holographic-state-projector/v0.1',sampleFieldHash,workingSet,content:'<canvas id="direct-fixture"></canvas>'}}}}}};\nexport const DIRECT_SAMPLE_PROJECTOR_HANDS=[hand];\nexport const DIRECT_SAMPLE_PROJECTOR_GRAPH={id:'fx.holographic-state-projector-direct-sample',version:'0.2.0',stages:[{id:'realize',hand:'fx.fixture.direct',params:{}}]};\nexport function makeDirectSampleState(field,seed=1){return {effect:{seed},sampleFieldInput:structuredClone(field),realizations:{}};}\n`,
  );
}

test("AXM scene becomes a bounded deterministic packed holographic sample field", () => {
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const first = axmSceneToHolographicSampleField(bytes, { samplesPerTriangle: 4, pointSize: 1.5 });
  const second = axmSceneToHolographicSampleField(bytes, { samplesPerTriangle: 4, pointSize: 1.5 });
  assert.deepEqual(first, second);
  assert.equal(first.field.stride, 7);
  assert.equal(first.observation.source_scene_sha256, sha256(bytes));
  assert.equal(first.observation.source_triangle_count, 2);
  assert.equal(first.observation.projected_triangle_count, 2);
  assert.equal(first.observation.point_count, 14);
  assert.equal(first.field.points.length, 14 * 7);
  assert.equal(first.field.sourceKind, "AXM_SCENE 1");
  assert.equal(first.field.sourceDigest, sha256(bytes));
  assert.equal(first.observation.albedo_semantics_projected, false);
});

test("direct sample adapter records a bounded triangle subset instead of hiding truncation", () => {
  const built = axmSceneToHolographicSampleField(scene, { samplesPerTriangle: 4, maxTriangles: 1 });
  assert.equal(built.observation.source_triangle_count, 2);
  assert.equal(built.observation.projected_triangle_count, 1);
  assert.equal(built.observation.point_count, 7);
  assert.equal(built.observation.bounded, true);
});

test("current-shape VFX direct sample projector retains exact AXM scene source identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-direct-"));
  await makeVfxFixture(root);
  const built = axmSceneToHolographicSampleField(scene, { samplesPerTriangle: 4 });
  const result = await observeVisualEffectDirectSamples(root, built.field, { seed: 7 });
  assert.equal(result.observation.graph_id, "fx.holographic-state-projector-direct-sample");
  assert.equal(result.observation.renderer, "axm.vfx.holographic-state-projector/v0.1");
  assert.equal(result.observation.source_kind, "AXM_SCENE 1");
  assert.equal(result.observation.source_digest, built.observation.source_scene_sha256);
  assert.equal(result.observation.point_count, built.observation.point_count);
  assert.equal(result.observation.source_identity_retained, true);
  assert.equal(result.observation.derived_sample_field_editable, true);
  assert.equal(result.observation.derived_gpu_data_rebuildable, true);
  assert.equal(result.observation.field_buffer_build_policy, "once-per-sample-field-hash");
  assert.equal(result.observation.repeat_verification, "PASS");
  assert.match(result.htmlBytes.toString("utf8"), /<canvas/);
});
