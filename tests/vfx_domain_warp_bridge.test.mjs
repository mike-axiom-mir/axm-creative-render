import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { domainWarpGridToAxmScene, observeVisualEffectDomainWarp } from "../src/vfx_domain_warp_bridge.mjs";
import { parseScene, sha256 } from "../src/creative_scene_operator.mjs";

const gridFixture = {
  schema: "axm.domain-warp-grid/v0.1",
  warpSourceHash: "warp-fixture",
  baseSourceHash: "base-fixture",
  flowSourceHash: "flow-fixture",
  flowScalarSourceHash: "flow-scalar-fixture",
  width: 4,
  height: 4,
  values: [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, .25, .35, .45, .55, .65],
  min: 0,
  max: 1,
  mean: .475,
  maxDisplacement: .125,
  derived: true,
  rebuildable: true,
  fieldHash: "domain-grid-fixture",
};

async function makeVfxDomainWarpFixture(root) {
  const dir = join(root, "hand-lab", "src");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "hand-runtime.mjs"),
    `import {createHash} from 'node:crypto';\nexport function hashValue(v){return createHash('sha256').update(JSON.stringify(v)).digest('hex')}\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=structuredClone(initialState);const ids=[];for(const stage of graph.stages){const hand=registry.get(stage.hand);if(!hand)throw new Error('missing hand '+stage.hand);state=hand.execute(state,stage.params||{}).state;ids.push(stage.id)}return {finalState:state,finalStateHash:hashValue(state),executedStageIds:ids};}\n`,
  );
  await writeFile(
    join(dir, "field-operators.mjs"),
    `export function sampleFbmSource(source,u,v){const n=(Number(source.seed)%97)/997;return Number(Math.max(0,Math.min(1,(Number(u)*.61+Number(v)*.29+n)%1)).toFixed(6));}\n`,
  );
  await writeFile(join(dir, "field-flow-operators.mjs"), `export const FIXTURE_FLOW_MODULE=true;\n`);
  await writeFile(
    join(dir, "field-domain-warp-operators.mjs"),
    `import {hashValue} from './hand-runtime.mjs';\nimport {sampleFbmSource} from './field-operators.mjs';\nconst normalize={id:'fx.field.domain-warp-source-normalize',execute(state){const o=state.options;const base={schema:'axm.scalar-field-source/v0.1',id:o.field.id,seed:o.field.seed};const flowScalar={schema:'axm.scalar-field-source/v0.1',id:o.flowField.id,seed:o.flowField.seed};const baseHash=hashValue(base),flowScalarHash=hashValue(flowScalar);const flow={schema:'axm.vector-flow-source/v0.1',id:o.flow.id,mode:o.flow.mode,strength:o.flow.strength,scalarSource:{sourceHash:flowScalarHash}};const flowHash=hashValue(flow);const warp={schema:'axm.domain-warp-source/v0.1',id:o.id,algorithm:'scalar-sample-vector-domain-warp2d',baseSource:{id:base.id,sourceHash:baseHash},flowSource:{id:flow.id,sourceHash:flowHash,scalarSourceHash:flowScalarHash},amplitude:o.amplitude};return {state:{...state,fieldSource:base,fieldSourceHash:baseHash,flowFieldSource:flowScalar,flowFieldSourceHash:flowScalarHash,flowSource:flow,flowSourceHash:flowHash,warpSource:warp,warpSourceHash:hashValue(warp)}}}};\nexport function sampleDomainWarpSource(base,flowScalar,flow,warp,u,v){const d=warp.amplitude===0?0:Number((warp.amplitude*(.25+.25*Number(v))).toFixed(6));const wu=Number(Math.max(0,Math.min(1,Number(u)+d)).toFixed(6));const wv=Number(Math.max(0,Math.min(1,Number(v)+d/2)).toFixed(6));return {value:sampleFbmSource(base,wu,wv),warpedU:wu,warpedV:wv,displacementX:Number((wu-Number(u)).toFixed(6)),displacementY:Number((wv-Number(v)).toFixed(6))};}\nconst build={id:'fx.field.domain-warp-grid-build',execute(state){const w=4,h=4,values=[];let maxDisplacement=0;for(let y=0;y<h;y++){for(let x=0;x<w;x++){const s=sampleDomainWarpSource(state.fieldSource,state.flowFieldSource,state.flowSource,state.warpSource,x/(w-1),y/(h-1));values.push(s.value);maxDisplacement=Math.max(maxDisplacement,Math.hypot(s.displacementX,s.displacementY));}}const grid={schema:'axm.domain-warp-grid/v0.1',warpSourceHash:state.warpSourceHash,baseSourceHash:state.fieldSourceHash,flowSourceHash:state.flowSourceHash,flowScalarSourceHash:state.flowFieldSourceHash,width:w,height:h,values,min:Math.min(...values),max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,maxDisplacement:Number(maxDisplacement.toFixed(6)),derived:true,rebuildable:true};grid.fieldHash=hashValue({warpSourceHash:grid.warpSourceHash,values});return {state:{...state,domainWarpFields:{[state.warpSource.id]:grid}}}}};\nexport const DOMAIN_WARP_HANDS=[normalize,build];\nexport const DOMAIN_WARP_GRAPH={schema:'axm.hand-graph/v0.1',id:'fx.field.domain-warp2d',version:'0.1.0',stages:[{id:'normalize',hand:normalize.id,params:{}},{id:'build',hand:build.id,params:{}}]};\nexport function makeDomainWarpState(options){return {schema:'axm.effect-work-state/v0.1',options:structuredClone(options),domainWarpFields:{}}}\n`,
  );
}

test("derived domain-warp grid becomes a deterministic fixed-geometry AXM_SCENE 1 albedo quilt", () => {
  const first = domainWarpGridToAxmScene(gridFixture);
  const second = domainWarpGridToAxmScene(gridFixture);
  assert.deepEqual(first.bytes, second.bytes);
  const scene = parseScene(first.bytes.toString("utf8"));
  assert.equal(scene.triangles.length, 32);
  assert.deepEqual(scene.triangles[0].albedo, [20, 32, 54]);
  assert.deepEqual(scene.triangles[20].albedo, [240, 220, 230]);
  assert.equal(first.observation.source_grid_hash, "domain-grid-fixture");
  assert.equal(first.observation.source_max_displacement, .125);
  assert.equal(first.observation.albedo_encodes_scalar_values, true);
  assert.equal(first.observation.geometry_encodes_scalar_values, false);
  assert.equal(first.observation.vector_displacement_encoded_as_geometry, false);
  assert.equal(first.observation.consumer_semantics_preserved, false);
  assert.equal(first.observation.output_sha256, sha256(first.bytes));
});

test("domain-warp scene adapter fails closed on invalid derived-grid evidence", () => {
  assert.throws(() => domainWarpGridToAxmScene({ ...gridFixture, schema: "old" }), /unexpected domain-warp grid schema/);
  assert.throws(() => domainWarpGridToAxmScene({ ...gridFixture, rebuildable: false }), /derived and rebuildable/);
  assert.throws(() => domainWarpGridToAxmScene({ ...gridFixture, values: [0] }), /values must match/);
  assert.throws(() => domainWarpGridToAxmScene({ ...gridFixture, values: gridFixture.values.map((v, i) => i === 3 ? 2 : v) }), /within 0..1/);
  assert.throws(() => domainWarpGridToAxmScene({ ...gridFixture, maxDisplacement: -1 }), /non-negative/);
});

test("real-shaped donor domain-warp graph preserves retained sources while explicit amplitude changes derived state", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-domain-warp-"));
  await makeVfxDomainWarpFixture(root);
  const shared = {
    id: "same-warp",
    field: { id: "base", seed: 73 },
    flowField: { id: "driver", seed: 111 },
    flow: { id: "flow", mode: "tangent", strength: .9 },
  };
  const zero = await observeVisualEffectDomainWarp(root, { ...shared, amplitude: 0 });
  const active = await observeVisualEffectDomainWarp(root, { ...shared, amplitude: .2 });

  assert.equal(zero.observation.graph_id, "fx.field.domain-warp2d");
  assert.equal(zero.observation.donor_graph_reused, true);
  assert.deepEqual(zero.observation.donor_hand_ids, ["fx.field.domain-warp-source-normalize", "fx.field.domain-warp-grid-build"]);
  assert.equal(zero.observation.caller_neutral_repeat_verification, "PASS");
  assert.equal(active.observation.caller_neutral_repeat_verification, "PASS");
  assert.equal(zero.observation.base_source.source_hash, active.observation.base_source.source_hash);
  assert.equal(zero.observation.flow_scalar_source.source_hash, active.observation.flow_scalar_source.source_hash);
  assert.equal(zero.observation.flow_source.source_hash, active.observation.flow_source.source_hash);
  assert.notEqual(zero.observation.warp_source.source_hash, active.observation.warp_source.source_hash);
  assert.notEqual(zero.observation.grid.field_hash, active.observation.grid.field_hash);
  assert.equal(zero.observation.zero_amplitude_exact_noop_verified, true);
  assert.equal(zero.observation.grid.max_displacement, 0);
  assert.ok(active.observation.grid.max_displacement > 0);
  assert.equal(active.observation.grid.derived, true);
  assert.equal(active.observation.grid.rebuildable, true);
  assert.equal(active.observation.truth_boundary.consumer_semantics_proven, false);
  assert.equal(active.observation.truth_boundary.aesthetic_quality_proven, false);
  assert.equal(active.observation.truth_boundary.physical_flow_behavior_proven, false);

  const zeroScene = domainWarpGridToAxmScene(zero.field);
  const activeScene = domainWarpGridToAxmScene(active.field);
  assert.equal(zeroScene.observation.output_triangle_count, activeScene.observation.output_triangle_count);
  assert.deepEqual(
    zeroScene.scene.triangles.map((triangle) => triangle.vertices),
    activeScene.scene.triangles.map((triangle) => triangle.vertices),
  );
  assert.notEqual(sha256(zeroScene.bytes), sha256(activeScene.bytes));
});
