import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { axmSceneToHolographicSampleField } from "../src/direct_sample_bridge.mjs";
import { observeVisualEffectDirectSampleShell } from "../src/direct_sample_shell_bridge.mjs";
import { serializeScene, sha256 } from "../src/creative_scene_operator.mjs";

const scene = {
  version: 1,
  triangles: [
    { vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], albedo: [90, 180, 250] },
    { vertices: [[-0.6, -0.4, 0.5], [0.6, -0.4, 0.5], [0, 0.7, 0.5]], albedo: [240, 100, 80] },
  ],
};

async function makeVfxShellFixture(root) {
  const dir = join(root, "hand-lab", "src");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "hand-runtime.mjs"),
    `import {createHash} from 'node:crypto';\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=structuredClone(initialState);const ids=[];for(const stage of graph.stages){const hand=registry.get(stage.hand);if(!hand)throw new Error('missing hand '+stage.hand);state=hand.execute(state,stage.params||{}).state;ids.push(stage.id)}const finalStateHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');return {graph:{id:graph.id,version:graph.version},finalState:state,finalStateHash,executedStageIds:ids};}\n`,
  );
  await writeFile(
    join(dir, "holographic-state-stream.mjs"),
    `export const admitSampleFieldHand={id:'fx.hologram.sample-field-admit',execute(state){const input=state.sampleFieldInput;const field={schema:'axm.holographic-sample-field/v0.2',stride:7,points:[...input.points],pointCount:input.points.length/7,canonicalFormHash:input.sourceDigest,sourceKind:input.sourceKind};return {state:{...state,form:{id:input.id,sourceKind:input.sourceKind,sourceDigest:input.sourceDigest,style:input.style},sampleField:field}}}};\nexport function makeDirectSampleState(field,seed=1){return {effect:{seed,tint:[.16,.9,1],accent:[.58,.3,1]},sampleFieldInput:structuredClone(field),realizations:{}};}\n`,
  );
  await writeFile(
    join(dir, "holographic-state-projector.mjs"),
    `export const creativeFieldHand={id:'fx.hologram.creative-field',execute(state){return {state:{...state,creativeField:{schema:'fixture-creative-field',sampleFieldHash:'fixture-'+state.sampleField.pointCount}}}}};\n`,
  );
  await writeFile(
    join(dir, "holographic-state-readable.mjs"),
    `export const visibilityFitHand={id:'fx.hologram.visibility-fit',execute(state){return {state:{...state,visibility:{schema:'axm.holographic-visibility/v0.1',bounds:{center:[0,0,0],span:[2,2,1]},fitScale:1.2,pointBoost:1.8,exposure:1.45,targetFill:1.32,density:3,mobileLegibility:true,twoPassGlow:true}}}}};\n`,
  );
  await writeFile(
    join(dir, "holographic-state-shell.mjs"),
    `export const shellProjectionStateHand={id:'fx.hologram.shell-projection-state',execute(state,params){return {state:{...state,projection:{schema:'axm.holographic-projection-state/v0.4',...params}}}}};\nexport const shellStateProjectorHand={id:'fx.hologram.state-projector-shell-webgl',execute(state){const source=state.form.sourceDigest;const realization={mediaType:'text/html',renderer:'axm.vfx.holographic-state-shell/v0.4',canonicalFormHash:source,sampleFieldHash:'fixture-shell-field',pointCount:state.sampleField.pointCount,visualLanguage:{primary:'translucent-shell',secondary:'volumetric-glow',tertiary:'sparse-signal-noise',brightSweep:false},content:'<canvas id="fixture-shell"></canvas>'};return {state:{...state,realizations:{...(state.realizations||{}),holographicStateShell:realization}}}}};\n`,
  );
}

test("direct-sample state can be realized by donor shell Hands without changing source identity", async () => {
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const adapted = axmSceneToHolographicSampleField(bytes, { samplesPerTriangle: 4, pointSize: 1.5 });
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-shell-"));
  await makeVfxShellFixture(root);
  const result = await observeVisualEffectDirectSampleShell(root, adapted.field, { seed: 9 });

  assert.equal(result.observation.graph_owner, "axm-creative-render-caller-composition");
  assert.equal(result.observation.graph_id, "axm.creative-render.direct-sample-shell");
  assert.deepEqual(result.observation.donor_hand_ids, [
    "fx.hologram.sample-field-admit",
    "fx.hologram.creative-field",
    "fx.hologram.visibility-fit",
    "fx.hologram.shell-projection-state",
    "fx.hologram.state-projector-shell-webgl",
  ]);
  assert.equal(result.observation.source_kind, "AXM_SCENE 1");
  assert.equal(result.observation.source_digest, sha256(bytes));
  assert.equal(result.observation.canonical_source_hash, sha256(bytes));
  assert.equal(result.observation.point_count, adapted.observation.point_count);
  assert.equal(result.observation.renderer, "axm.vfx.holographic-state-shell/v0.4");
  assert.equal(result.observation.visibility.mobile_legibility, true);
  assert.equal(result.observation.visibility.two_pass_glow, true);
  assert.equal(result.observation.visual_language.primary, "translucent-shell");
  assert.equal(result.observation.visual_language.secondary, "volumetric-glow");
  assert.equal(result.observation.visual_language.tertiary, "sparse-signal-noise");
  assert.equal(result.observation.visual_language.brightSweep, false);
  assert.equal(result.observation.source_identity_retained, true);
  assert.equal(result.observation.sample_field_remains_explicit, true);
  assert.equal(result.observation.repeat_verification, "PASS");
  assert.equal(result.observation.truth_boundary.donor_graph_reused, false);
  assert.equal(result.observation.truth_boundary.donor_hands_reused, true);
  assert.match(result.htmlBytes.toString("utf8"), /<canvas/);
});
