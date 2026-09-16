import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { composedFieldGridToAxmScene, observeVisualEffectFieldComposition } from "../src/vfx_field_composition_bridge.mjs";
import { parseScene, sha256 } from "../src/creative_scene_operator.mjs";

const gridFixture = {
  schema: "axm.scalar-field-composed-grid/v0.1",
  compositionSourceHash: "composition-fixture",
  inputAHash: "field-a-fixture",
  inputBHash: "field-b-fixture",
  width: 4,
  height: 4,
  values: [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, .25, .35, .45, .55, .65],
  min: 0,
  max: 1,
  mean: .475,
  derived: true,
  rebuildable: true,
  fieldHash: "grid-fixture",
};

async function makeVfxFieldFixture(root) {
  const dir = join(root, "hand-lab", "src");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "hand-runtime.mjs"),
    `import {createHash} from 'node:crypto';\nexport function hashValue(v){return createHash('sha256').update(JSON.stringify(v)).digest('hex')}\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=structuredClone(initialState);const ids=[];for(const stage of graph.stages){const hand=registry.get(stage.hand);if(!hand)throw new Error('missing hand '+stage.hand);state=hand.execute(state,stage.params||{}).state;ids.push(stage.id)}return {finalState:state,finalStateHash:hashValue(state),executedStageIds:ids};}\n`,
  );
  await writeFile(join(dir, "field-operators.mjs"), `export const FIXTURE_FIELD_MODULE=true;\n`);
  await writeFile(
    join(dir, "field-composition-operators.mjs"),
    `import {hashValue} from './hand-runtime.mjs';\nconst normalize={id:'fx.field.composition-source-normalize',execute(state){const a={schema:'axm.scalar-field-source/v0.1',id:state.options.a.id,seed:state.options.a.seed};const b={schema:'axm.scalar-field-source/v0.1',id:state.options.b.id,seed:state.options.b.seed};const ah=hashValue(a),bh=hashValue(b);const source={schema:'axm.scalar-field-composition-source/v0.1',id:state.options.id,operation:state.options.operation,inputA:{id:a.id,sourceHash:ah},inputB:{id:b.id,sourceHash:bh}};return {state:{...state,fieldSources:{a,b},fieldSourceHashes:{a:ah,b:bh},fieldCompositionSource:source,fieldCompositionSourceHash:hashValue(source)}}}};\nconst build={id:'fx.field.composed-grid-build',execute(state){const w=4,h=4,base=state.fieldCompositionSource.operation==='multiply'?.2:.75,values=Array.from({length:w*h},(_,i)=>Number(Math.min(1,base+i*.01).toFixed(6)));const grid={schema:'axm.scalar-field-composed-grid/v0.1',compositionSourceHash:state.fieldCompositionSourceHash,inputAHash:state.fieldSourceHashes.a,inputBHash:state.fieldSourceHashes.b,width:w,height:h,values,min:Math.min(...values),max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,derived:true,rebuildable:true};grid.fieldHash=hashValue({compositionSourceHash:grid.compositionSourceHash,values});return {state:{...state,composedFields:{[state.fieldCompositionSource.id]:grid}}}}};\nexport const FIELD_COMPOSITION_HANDS=[normalize,build];\nexport const FIELD_COMPOSITION_GRAPH={schema:'axm.hand-graph/v0.1',id:'fx.field.compose2d',version:'0.1.0',stages:[{id:'normalize',hand:normalize.id,params:{}},{id:'build',hand:build.id,params:{}}]};\nexport function makeFieldCompositionState(options){return {schema:'axm.effect-work-state/v0.1',options:structuredClone(options),composedFields:{}}}\n`,
  );
}

test("derived composed grid becomes a deterministic AXM_SCENE 1 albedo quilt", () => {
  const first = composedFieldGridToAxmScene(gridFixture);
  const second = composedFieldGridToAxmScene(gridFixture);
  assert.deepEqual(first.bytes, second.bytes);
  const scene = parseScene(first.bytes.toString("utf8"));
  assert.equal(scene.triangles.length, 32);
  assert.deepEqual(scene.triangles[0].albedo, [20, 32, 54]);
  assert.deepEqual(scene.triangles[20].albedo, [240, 220, 230]);
  assert.equal(first.observation.source_grid_hash, "grid-fixture");
  assert.equal(first.observation.albedo_encodes_scalar_values, true);
  assert.equal(first.observation.geometry_encodes_scalar_values, false);
  assert.equal(first.observation.material_semantics_preserved, false);
  assert.equal(first.observation.output_sha256, sha256(first.bytes));
});

test("field scene adapter fails closed on invalid derived-grid evidence", () => {
  assert.throws(() => composedFieldGridToAxmScene({ ...gridFixture, schema: "old" }), /unexpected composed grid schema/);
  assert.throws(() => composedFieldGridToAxmScene({ ...gridFixture, derived: false }), /derived and rebuildable/);
  assert.throws(() => composedFieldGridToAxmScene({ ...gridFixture, values: [0] }), /values must match/);
  assert.throws(() => composedFieldGridToAxmScene({ ...gridFixture, values: gridFixture.values.map((v, i) => i === 3 ? 2 : v) }), /within 0..1/);
});

test("real-shaped donor field-composition graph preserves input authority across operation changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-field-"));
  await makeVfxFieldFixture(root);
  const shared = { a: { id: "a", seed: 7 }, b: { id: "b", seed: 11 } };
  const multiply = await observeVisualEffectFieldComposition(root, { ...shared, id: "m", operation: "multiply" });
  const add = await observeVisualEffectFieldComposition(root, { ...shared, id: "a2", operation: "add-clamp" });

  assert.equal(multiply.observation.graph_id, "fx.field.compose2d");
  assert.equal(multiply.observation.donor_graph_reused, true);
  assert.deepEqual(multiply.observation.donor_hand_ids, ["fx.field.composition-source-normalize", "fx.field.composed-grid-build"]);
  assert.equal(multiply.observation.repeat_verification, "PASS");
  assert.equal(multiply.observation.input_a.source_hash, add.observation.input_a.source_hash);
  assert.equal(multiply.observation.input_b.source_hash, add.observation.input_b.source_hash);
  assert.notEqual(multiply.observation.composition_source.source_hash, add.observation.composition_source.source_hash);
  assert.notEqual(multiply.observation.grid.field_hash, add.observation.grid.field_hash);
  assert.equal(multiply.observation.grid.derived, true);
  assert.equal(multiply.observation.grid.rebuildable, true);
  assert.equal(multiply.observation.truth_boundary.consumer_semantics_proven, false);
  assert.equal(multiply.observation.truth_boundary.aesthetic_quality_proven, false);
});
