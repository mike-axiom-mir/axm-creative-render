import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  normalizeSampleTimes,
  observeUniversalCreationTemporal,
  temporalClipSpec,
  temporalSkeletonSpec,
} from "../src/temporal_uc_bridge.mjs";
import { parseScene } from "../src/creative_scene_operator.mjs";

async function makeUcFixture(root) {
  const dir = join(root, "capabilities", "platform-hands");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "index.js"),
    `
const baseMesh={schema:'axm.precision-mesh/v1',digest:'mesh-base',positions:[-1,-1,0,1,-1,0,0,1,0],indices:[0,1,2]};
function receipts(steps){return steps.map((step,i)=>({operation_id:step.hand_id||step.recipe_id||'unknown',digest:'receipt-'+step.id+'-'+i}));}
const creativeFlow={
  version:'fixture-flow-1',
  summary(){return {digest:'fixture-flow-summary'};},
  run(req){
    if(req.steps.length===4){
      return {status:'PASS',candidate_ready:true,source_state_mutated:false,digest:'fixture-baseline',receipts:receipts(req.steps),final_state:{skeleton:{schema:'axm.precision-skeleton/v1'},mesh:baseMesh,clip:{schema:'axm.precision-animation-clip/v1'},skin:{schema:'axm.precision-skin/v1'}}};
    }
    const time=Number(req.steps[0].args.time);
    const positions=baseMesh.positions.map((v,i)=>i%3===0?v+time*.25:v);
    const deformed={...baseMesh,digest:'mesh-'+time,positions};
    return {status:'PASS',candidate_ready:true,source_state_mutated:false,digest:'fixture-sample-'+time,receipts:receipts(req.steps),final_state:{deformed,bounds:{schema:'axm.precision-mesh-bounds/v1',size:[2,2,0]}}};
  }
};
module.exports={creativeHands:{version:'fixture-hands-7',audit(){return {total:441,digest:'fixture-audit'}},recipeRegistry(){return {count:448,digest:'fixture-recipes'}}},creativeFlow};
`,
  );
}

test("temporal sample times are bounded and ordered", () => {
  assert.deepEqual(normalizeSampleTimes([0, 0.5, 2]), [0, 0.5, 2]);
  assert.throws(() => normalizeSampleTimes([0]), /2..16/);
  assert.throws(() => normalizeSampleTimes([0, 0]), /strictly increasing/);
  assert.throws(() => normalizeSampleTimes([0, 3]), /0..2/);
});

test("temporal caller-owned rig and clip specs remain explicit", () => {
  const skeleton = temporalSkeletonSpec();
  const clip = temporalClipSpec();
  assert.equal(skeleton.bones.length, 3);
  assert.equal(clip.duration, 2);
  assert.equal(clip.tracks.length, 2);
});

test("Universal Creation animation samples become distinct AXM_SCENE states", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-temporal-"));
  await makeUcFixture(root);
  const first = await observeUniversalCreationTemporal(root, [0, 1, 2]);
  const second = await observeUniversalCreationTemporal(root, [0, 1, 2]);

  assert.equal(first.observation.hand_count, 441);
  assert.equal(first.observation.recipe_count, 448);
  assert.equal(first.observation.sample_count, 3);
  assert.equal(first.observation.distinct_scene_count, 3);
  assert.equal(first.observation.adapter.lossy, true);
  assert(first.observation.adapter.omitted_semantics.includes("animation-clip"));
  assert.deepEqual(
    first.samples.map((sample) => sample.scene_sha256),
    second.samples.map((sample) => sample.scene_sha256),
  );
  assert.equal(parseScene(first.samples[0].scene_bytes.toString("utf8")).triangles.length, 1);
  assert.notEqual(first.samples[0].scene_sha256, first.samples[2].scene_sha256);
});
