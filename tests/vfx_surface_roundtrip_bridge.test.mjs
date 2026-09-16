import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { axmSceneToHolographicSampleField } from "../src/direct_sample_bridge.mjs";
import { observeVisualEffectVoxelSurface, surfaceMeshToAxmScene } from "../src/vfx_surface_roundtrip_bridge.mjs";
import { parseScene, serializeScene, sha256 } from "../src/creative_scene_operator.mjs";

const sourceScene = {
  version: 1,
  triangles: [
    { vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], albedo: [90, 180, 250] },
    { vertices: [[-0.5, -0.4, 0.4], [0.5, -0.4, 0.4], [0, 0.6, 0.4]], albedo: [240, 100, 80] },
  ],
};

const surfaceFixture = {
  schema: "axm.holographic-triangle-surface/v0.1",
  method: "marching-tetrahedra-over-derived-voxel-density",
  derived: true,
  rebuildable: true,
  sourceVoxelDigest: "voxel-fixture",
  triangleCount: 2,
  vertices: [-1, -1, 0, 1, -1, 0, 0, 1, 0, -0.5, -0.5, 0.3, 0.5, -0.5, 0.3, 0, 0.5, 0.3],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  digest: "surface-fixture",
};

async function makeVfxVoxelFixture(root) {
  const dir = join(root, "hand-lab", "src");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "hand-runtime.mjs"),
    `import {createHash} from 'node:crypto';\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=structuredClone(initialState);const ids=[];for(const stage of graph.stages){const hand=registry.get(stage.hand);if(!hand)throw new Error('missing hand '+stage.hand);state=hand.execute(state,stage.params||{}).state;ids.push(stage.id)}const finalStateHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');return {graph:{id:graph.id,version:graph.version},finalState:state,finalStateHash,executedStageIds:ids};}\n`,
  );
  await writeFile(
    join(dir, "holographic-state-stream.mjs"),
    `export const admitSampleFieldHand={id:'fx.hologram.sample-field-admit',execute(state){const input=state.sampleFieldInput;return {state:{...state,form:{id:input.id,sourceKind:input.sourceKind,sourceDigest:input.sourceDigest},sampleField:{schema:'axm.holographic-sample-field/v0.2',stride:7,points:[...input.points],pointCount:input.points.length/7,canonicalFormHash:input.sourceDigest,sourceKind:input.sourceKind}}}}};\nexport function makeDirectSampleState(field,seed=1){return {effect:{seed,tint:[.16,.9,1],accent:[.58,.3,1]},sampleFieldInput:structuredClone(field),realizations:{}};}\n`,
  );
  await writeFile(
    join(dir, "holographic-state-projector.mjs"),
    `export const creativeFieldHand={id:'fx.hologram.creative-field',execute(state){return {state:{...state,creativeField:{schema:'fixture-field'}}}}};\n`,
  );
  await writeFile(
    join(dir, "holographic-state-voxel-surface.mjs"),
    `export const voxelDensityHand={id:'fx.hologram.voxel-density',execute(state,params){return {state:{...state,voxelField:{schema:'axm.holographic-voxel-density/v0.1',derived:true,rebuildable:true,resolution:params.resolution,density:[0,255,0],iso:params.iso,digest:'voxel-fixture'}}}}};\nexport const voxelSurfaceMeshHand={id:'fx.hologram.voxel-surface-mesh',execute(state){return {state:{...state,surfaceMesh:{schema:'axm.holographic-triangle-surface/v0.1',method:'marching-tetrahedra-over-derived-voxel-density',derived:true,rebuildable:true,sourceVoxelDigest:'voxel-fixture',triangleCount:1,vertices:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],digest:'surface-fixture'}}}}};\nexport const voxelSurfaceWebglHand={id:'fx.hologram.voxel-surface-webgl',execute(state){const source=state.form.sourceDigest;return {state:{...state,realizations:{...(state.realizations||{}),holographicVoxelSurface:{mediaType:'text/html',renderer:'axm.vfx.holographic-voxel-surface/v0.6',canonicalFormHash:source,voxelDigest:'voxel-fixture',meshDigest:'surface-fixture',triangleCount:1,workingSet:{canonicalFormRetained:true,sampleFieldRetained:true,voxelDensityDerived:true,triangleMeshDerived:true,gpuTriangleBufferDisposable:true,modeledBufferBytes:72},content:'<canvas id="voxel-fixture"></canvas>'}}}}}};\n`,
  );
}

test("derived VFX triangle surface becomes a deterministic AXM_SCENE 1 body", () => {
  const first = surfaceMeshToAxmScene(surfaceFixture, { albedo: [12, 34, 56] });
  const second = surfaceMeshToAxmScene(surfaceFixture, { albedo: [12, 34, 56] });
  assert.deepEqual(first.bytes, second.bytes);
  const parsed = parseScene(first.bytes.toString("utf8"));
  assert.equal(parsed.triangles.length, 2);
  assert.deepEqual(parsed.triangles[0].albedo, [12, 34, 56]);
  assert.equal(first.observation.source_surface_digest, "surface-fixture");
  assert.equal(first.observation.source_voxel_digest, "voxel-fixture");
  assert.equal(first.observation.normals_preserved, false);
  assert.equal(first.observation.output_sha256, sha256(first.bytes));
});

test("surface adapter fails closed on inconsistent triangle evidence", () => {
  assert.throws(
    () => surfaceMeshToAxmScene({ ...surfaceFixture, triangleCount: 3 }),
    /triangle count drifted/,
  );
  assert.throws(
    () => surfaceMeshToAxmScene({ ...surfaceFixture, normals: [0, 0, 1] }),
    /normals must match/,
  );
});

test("real-shaped donor Hands reconstruct a direct sample field into derived triangle state without stealing source authority", async () => {
  const sourceBytes = Buffer.from(serializeScene(sourceScene), "utf8");
  const adapted = axmSceneToHolographicSampleField(sourceBytes, { samplesPerTriangle: 4, pointSize: 1.5 });
  const root = await mkdtemp(join(tmpdir(), "axm-cr-vfx-voxel-"));
  await makeVfxVoxelFixture(root);
  const result = await observeVisualEffectVoxelSurface(root, adapted.field, { resolution: 18, maxTriangles: 2000, seed: 9 });

  assert.equal(result.observation.graph_owner, "axm-creative-render-caller-composition");
  assert.equal(result.observation.graph_id, "axm.creative-render.direct-sample-voxel-surface");
  assert.deepEqual(result.observation.donor_hand_ids, [
    "fx.hologram.sample-field-admit",
    "fx.hologram.creative-field",
    "fx.hologram.voxel-density",
    "fx.hologram.voxel-surface-mesh",
    "fx.hologram.voxel-surface-webgl",
  ]);
  assert.equal(result.observation.source_kind, "AXM_SCENE 1");
  assert.equal(result.observation.source_digest, sha256(sourceBytes));
  assert.equal(result.observation.point_count, adapted.observation.point_count);
  assert.equal(result.observation.voxel.derived, true);
  assert.equal(result.observation.voxel.rebuildable, true);
  assert.equal(result.observation.surface.derived, true);
  assert.equal(result.observation.surface.rebuildable, true);
  assert.equal(result.observation.surface.source_voxel_digest, result.observation.voxel.digest);
  assert.equal(result.observation.renderer, "axm.vfx.holographic-voxel-surface/v0.6");
  assert.equal(result.observation.repeat_verification, "PASS");
  assert.equal(result.observation.truth_boundary.donor_graph_reused, false);
  assert.equal(result.observation.truth_boundary.donor_hands_reused, true);
  assert.equal(result.observation.truth_boundary.semantic_topology_recovery_proven, false);
  assert.match(result.htmlBytes.toString("utf8"), /<canvas/);
});
