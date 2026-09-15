import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import {
  executeElectricEffect,
  rasterizeElectricStateToPpm,
  compositeElectricRasterWithUniversalCreation,
} from "../src/vfx_frame_bridge.mjs";
import {
  parsePpmRgb8,
  ppmToPrecisionRaster,
  precisionRasterToPpm,
  serializePpmRgb8,
} from "../src/post_render_bridge.mjs";

function canonical(value){if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;}
function digest(value){return createHash("sha256").update(canonical(value),"utf8").digest("hex");}

async function makeVfxFixture(root){
  const dir=join(root,"hand-lab","src");await mkdir(dir,{recursive:true});
  await writeFile(join(dir,"hand-runtime.mjs"),`import {createHash} from 'node:crypto';\nconst clone=v=>JSON.parse(JSON.stringify(v));\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=clone(initialState);const ids=[];for(const stage of graph.stages){state=registry.get(stage.hand).execute(state,stage.params||{}).state;ids.push(stage.id)}const finalStateHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');return {graph:{id:graph.id,version:graph.version},finalState:state,finalStateHash,executedStageIds:ids};}\n`);
  await writeFile(join(dir,"electric-hands.mjs"),`const hand={schema:'axm.hand/v0.1',id:'fx.fixture.svg',version:'0.1.0',execute(state){const next=structuredClone(state);next.paths=[{id:'trunk',role:'trunk',energy:1,width:1,points:[{x:.1,y:.5},{x:.9,y:.4}]}];next.realizations={svgPreview:{mediaType:'image/svg+xml',derivedFromTopologyHash:'fixture-topology',content:'<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#05060b"/><path d="M0 0 L10 10" stroke="white"/></svg>'}};return {state:next};}};\nexport const ELECTRIC_HANDS=[hand];\nexport const ELECTRIC_STORM_GRAPH={schema:'axm.hand-graph/v0.1',id:'fx.electric-storm-fixture',version:'0.1.0',stages:[{id:'preview',hand:'fx.fixture.svg',params:{}}]};\nexport function makeElectricInitialState(seed){return {schema:'axm.effect-work-state/v0.1',effect:{seed},paths:[],realizations:{}};}\n`);
}

async function makeUcFixture(root){
  const dir=join(root,"capabilities","platform-hands");await mkdir(dir,{recursive:true});
  await writeFile(join(dir,"index.js"),`
const crypto=require('crypto');
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
function digest(v){return crypto.createHash('sha256').update(canonical(v),'utf8').digest('hex');}
function decode(img){return Buffer.from(img.rgba8_base64,'base64');}
function styled(base,effect){const b=decode(base),e=decode(effect),out=Buffer.alloc(b.length);for(let i=0;i<b.length;i+=4){out[i]=Math.min(255,b[i]+Math.round(e[i]*.25));out[i+1]=Math.min(255,b[i+1]+Math.round(e[i+1]*.25));out[i+2]=Math.min(255,b[i+2]+Math.round(e[i+2]*.25));out[i+3]=255;}const image={schema:'axm.precision-raster/v1',version:'1.0.0',width:base.width,height:base.height,rgba8_base64:out.toString('base64'),colour_space:'srgb',source_digest:digest(out)};image.digest=digest(image);return image;}
const creativeFlow={version:'fixture-flow',summary(){return {digest:'summary'};},run(req){const image=styled(req.state.base,req.state.effect);const receipts=[{operation_id:'creative.composite.screen',digest:'screen'},{operation_id:'creative.adjust.contrast',digest:'finish'}];return {status:'PASS',candidate_ready:true,source_state_mutated:false,digest:digest({image:image.digest,receipts}),receipts,final_state:{...req.state,composite:{image},styled:image}};}};
module.exports={creativeHands:{version:'fixture-hands',audit(){return {total:441,digest:'audit'}},recipeRegistry(){return {count:448,digest:'recipes'}}},creativeFlow};
`);
}

test("Visual Effect Fabric electric graph yields repeatable SVG source evidence",async()=>{
  const root=await mkdtemp(join(tmpdir(),"axm-cr-vfx-src-"));await makeVfxFixture(root);
  const first=await executeElectricEffect(root,42);const second=await executeElectricEffect(root,42);
  assert.equal(first.observation.graph_id,"fx.electric-storm-fixture");
  assert.equal(first.observation.path_count,1);
  assert.equal(first.observation.svg_sha256,second.observation.svg_sha256);
  assert.equal(first.svgBytes.equals(second.svgBytes),true);
  assert.match(first.svgBytes.toString("utf8"),/<svg/);
});

test("canonical electric path state rasterizes deterministically without external tools",async()=>{
  const root=await mkdtemp(join(tmpdir(),"axm-cr-vfx-raster-"));await makeVfxFixture(root);
  const source=await executeElectricEffect(root,42);
  const first=rasterizeElectricStateToPpm(source.stateBytes,64,36);
  const second=rasterizeElectricStateToPpm(source.stateBytes,64,36);
  assert.equal(first.evidence.schema,"axm.creative-render.electric-path-raster/v1");
  assert.equal(first.evidence.path_count,1);
  assert.equal(first.evidence.segment_count,1);
  assert.equal(first.ppmBytes.equals(second.ppmBytes),true);
  const ppm=parsePpmRgb8(first.ppmBytes);
  assert.equal(ppm.width,64);assert.equal(ppm.height,36);
  assert(ppm.rgb.some((value)=>value>0));
  const bad=Buffer.from(JSON.stringify({schema:'axm.effect-work-state/v0.1',paths:[{points:[{x:0,y:0},{x:2,y:1}]}]}));
  assert.throws(()=>rasterizeElectricStateToPpm(bad,64,36),/0..1/);
});

test("Universal Creation Creative Flow screen-composites effect raster over base frame",async()=>{
  const root=await mkdtemp(join(tmpdir(),"axm-cr-vfx-uc-"));await makeUcFixture(root);
  const base=serializePpmRgb8(2,1,Buffer.from([10,20,30,40,50,60]));
  const effect=serializePpmRgb8(2,1,Buffer.from([200,10,5,100,20,5]));
  const first=await compositeElectricRasterWithUniversalCreation(root,base,effect);
  const second=await compositeElectricRasterWithUniversalCreation(root,base,effect);
  assert.deepEqual(first.observation.operation_ids,["creative.composite.screen","creative.adjust.contrast"]);
  assert.equal(first.observation.hand_count,441);
  assert.equal(first.observation.recipe_count,448);
  assert.equal(first.observation.repeat_verification,"PASS");
  assert.equal(first.outputPpm.equals(base),false);
  assert.equal(first.outputPpm.equals(second.outputPpm),true);
});

test("VFX composite refuses mismatched frame dimensions",async()=>{
  const root=await mkdtemp(join(tmpdir(),"axm-cr-vfx-dim-"));await makeUcFixture(root);
  const base=serializePpmRgb8(2,1,Buffer.from([1,2,3,4,5,6]));
  const effect=serializePpmRgb8(1,1,Buffer.from([1,2,3]));
  await assert.rejects(()=>compositeElectricRasterWithUniversalCreation(root,base,effect),/dimensions must match/);
});

test("precision raster PPM adapters preserve fixture dimensions for effect pipeline",()=>{
  const ppm=serializePpmRgb8(1,1,Buffer.from([7,8,9]));
  const raster=ppmToPrecisionRaster(ppm);assert.equal(raster.width,1);assert.equal(raster.height,1);assert.equal(precisionRasterToPpm(raster).equals(ppm),true);
});
