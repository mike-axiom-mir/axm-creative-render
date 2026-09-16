import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { axmSceneToHolographicSampleField } from "../src/direct_sample_bridge.mjs";
import { observeVisualEffectStateMorph } from "../src/direct_sample_morph_bridge.mjs";
import { serializeScene, sha256 } from "../src/creative_scene_operator.mjs";

const sourceScene = {
  version: 1,
  triangles: [
    { vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], albedo: [100, 190, 250] },
  ],
};

const targetScene = {
  version: 1,
  triangles: [
    { vertices: [[-0.5, -1, 0.2], [1.5, -0.7, 0.1], [0.4, 1.3, 0.6]], albedo: [100, 190, 250] },
  ],
};

async function makeVfxMorphFixture(root) {
  const dir = join(root, "hand-lab", "src");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "hand-runtime.mjs"),
    `import {createHash} from 'node:crypto';\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=structuredClone(initialState);const ids=[];for(const stage of graph.stages){const hand=registry.get(stage.hand);if(!hand)throw new Error('missing hand '+stage.hand);state=hand.execute(state,stage.params||{}).state;ids.push(stage.id)}const finalStateHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');return {graph:{id:graph.id,version:graph.version},finalState:state,finalStateHash,executedStageIds:ids};}\n`,
  );
  await writeFile(
    join(dir, "holographic-state-stream.mjs"),
    `const prepare={id:'fx.hologram.sample-field-morph-prepare',execute(state){const source=state.morph.source,target=state.morph.target;const sourceCount=source.points.length/7,targetCount=target.points.length/7,count=Math.max(sourceCount,targetCount);return {state:{...state,morphField:{schema:'axm.holographic-morph-field/v0.1',stride:14,count,sourceId:source.id,targetId:target.id,sourceDigest:source.sourceDigest,targetDigest:target.sourceDigest,from:[...source.points],to:[...target.points],pairing:'deterministic-spatial-order-v0.1'}}}}};\nconst project={id:'fx.hologram.state-morph-webgl',execute(state){const field=state.morphField;const realization={mediaType:'text/html',renderer:'axm.vfx.holographic-state-morph/v0.1',sourceDigest:field.sourceDigest,targetDigest:field.targetDigest,count:field.count,content:'<canvas id="fixture-morph"></canvas>'};return {state:{...state,realizations:{holographicStateMorph:realization}}}}};\nexport const HOLOGRAPHIC_STATE_MORPH_HANDS=[prepare,project];\nexport const HOLOGRAPHIC_STATE_MORPH_GRAPH={schema:'axm.hand-graph/v0.1',id:'fx.holographic-state-morph',version:'0.1.0',stages:[{id:'prepare-morph',hand:prepare.id,params:{}},{id:'realize-morph',hand:project.id,params:{}}]};\nexport function makeMorphState(source,target,seed=1){return {schema:'axm.effect-work-state/v0.1',effect:{seed},morph:{source:structuredClone(source),target:structuredClone(target)},realizations:{}};}\n`,
  );
}

test("two AXM scene identities survive the real-shaped VFX morph contract", async () => {
  const sourceBytes = Buffer.from(serializeScene(sourceScene), "utf8");
  const targetBytes = Buffer.from(serializeScene(targetScene), "utf8");
  const source = axmSceneToHolographicSampleField(sourceBytes, { id: "source", samplesPerTriangle: 4 });
  const target = axmSceneToHolographicSampleField(targetBytes, { id: "target", samplesPerTriangle: 4 });
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-morph-"));
  await makeVfxMorphFixture(root);

  const result = await observeVisualEffectStateMorph(root, source.field, target.field, { seed: 17 });

  assert.equal(result.observation.graph_id, "fx.holographic-state-morph");
  assert.equal(result.observation.graph_version, "0.1.0");
  assert.equal(result.observation.source.digest, sha256(sourceBytes));
  assert.equal(result.observation.target.digest, sha256(targetBytes));
  assert.equal(result.observation.distinct_source_identity, true);
  assert.equal(result.observation.morph.source_digest, sha256(sourceBytes));
  assert.equal(result.observation.morph.target_digest, sha256(targetBytes));
  assert.equal(result.observation.morph.pairing, "deterministic-spatial-order-v0.1");
  assert.equal(result.observation.renderer, "axm.vfx.holographic-state-morph/v0.1");
  assert.equal(result.observation.repeat_verification, "PASS");
  assert.equal(result.observation.truth_boundary.semantic_correspondence_proven, false);
  assert.match(result.htmlBytes.toString("utf8"), /<canvas/);
});

test("state morph fails closed when source identity is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-morph-invalid-"));
  await makeVfxMorphFixture(root);
  const field = {
    id: "missing-digest",
    sourceKind: "AXM_SCENE 1",
    stride: 7,
    points: [0, 0, 0, 1, 0, 0, 1],
  };
  await assert.rejects(
    () => observeVisualEffectStateMorph(root, field, { ...field, sourceDigest: "target" }),
    /sourceDigest/,
  );
});
