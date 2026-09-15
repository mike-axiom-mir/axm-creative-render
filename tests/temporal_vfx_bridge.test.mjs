import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { applyTemporalVfxPpms, normalizeTemporalVfxPolicy } from "../src/temporal_vfx_bridge.mjs";
import { serializePpmRgb8 } from "../src/post_render_bridge.mjs";

function canonical(value){if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;}
function digest(value){return createHash("sha256").update(canonical(value),"utf8").digest("hex");}

async function makeVfxFixture(root){
  const dir=join(root,"hand-lab","src");await mkdir(dir,{recursive:true});
  await writeFile(join(dir,"hand-runtime.mjs"),`import {createHash} from 'node:crypto';\nconst clone=v=>JSON.parse(JSON.stringify(v));\nexport function createHandRegistry(hands){return new Map(hands.map(h=>[h.id,h]));}\nexport function executeHandGraph({registry,graph,initialState}){let state=clone(initialState);const ids=[];for(const stage of graph.stages){state=registry.get(stage.hand).execute(state,stage.params||{}).state;ids.push(stage.id)}const finalStateHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');return {graph:{id:graph.id,version:graph.version},finalState:state,finalStateHash,executedStageIds:ids};}\n`);
  await writeFile(join(dir,"electric-hands.mjs"),`const hand={schema:'axm.hand/v0.1',id:'fx.fixture.temporal',version:'0.1.0',execute(state){const next=structuredClone(state);const s=Number(next.effect.seed||0);const y=.25+(((s%7)+7)%7)*.05;next.paths=[{id:'trunk',role:'trunk',energy:1,width:1,points:[{x:.1,y},{x:.9,y:Math.min(.9,y+.12)}]}];next.realizations={svgPreview:{mediaType:'image/svg+xml',derivedFromTopologyHash:'fixture-'+s,content:'<svg xmlns="http://www.w3.org/2000/svg"><text>'+s+'</text></svg>'}};return {state:next};}};\nexport const ELECTRIC_HANDS=[hand];\nexport const ELECTRIC_STORM_GRAPH={schema:'axm.hand-graph/v0.1',id:'fx.electric-storm',version:'0.1.0',stages:[{id:'temporal',hand:'fx.fixture.temporal',params:{}}]};\nexport function makeElectricInitialState(seed){return {schema:'axm.effect-work-state/v0.1',effect:{seed},paths:[],realizations:{}};}\n`);
}

async function makeUcFixture(root){
  const dir=join(root,"capabilities","platform-hands");await mkdir(dir,{recursive:true});
  await writeFile(join(dir,"index.js"),`
const crypto=require('crypto');
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
function digest(v){return crypto.createHash('sha256').update(canonical(v),'utf8').digest('hex');}
function decode(img){return Buffer.from(img.rgba8_base64,'base64');}
function styled(base,effect){const b=decode(base),e=decode(effect),out=Buffer.alloc(b.length);for(let i=0;i<b.length;i+=4){out[i]=Math.min(255,b[i]+Math.round(e[i]*.3));out[i+1]=Math.min(255,b[i+1]+Math.round(e[i+1]*.3));out[i+2]=Math.min(255,b[i+2]+Math.round(e[i+2]*.3));out[i+3]=255;}const image={schema:'axm.precision-raster/v1',version:'1.0.0',width:base.width,height:base.height,rgba8_base64:out.toString('base64'),colour_space:'srgb',source_digest:digest(out)};image.digest=digest(image);return image;}
const creativeFlow={version:'fixture-flow',summary(){return {digest:'summary'};},run(req){const image=styled(req.state.base,req.state.effect);const receipts=[{operation_id:'creative.composite.screen',digest:'screen'},{operation_id:'creative.adjust.contrast',digest:'finish'}];return {status:'PASS',candidate_ready:true,source_state_mutated:false,digest:digest({image:image.digest,receipts}),receipts,final_state:{...req.state,composite:{image},styled:image}};}};
module.exports={creativeHands:{version:'fixture-hands',audit(){return {total:501,digest:'audit'}},recipeRegistry(){return {count:508,digest:'recipes'}}},creativeFlow};
`);
}

function frame(seed){const width=16,height=8,rgb=Buffer.alloc(width*height*3);for(let i=0;i<rgb.length;i++)rgb[i]=(seed+i*11)%180+20;return serializePpmRgb8(width,height,rgb);}

test("temporal VFX uses explicit per-frame effect state and repeats complete composites",async()=>{
  const root=await mkdtemp(join(tmpdir(),"axm-cr-temporal-vfx-"));
  const uc=join(root,"uc"),vfx=join(root,"vfx");await makeUcFixture(uc);await makeVfxFixture(vfx);
  const input=[frame(3),frame(17)];
  const first=await applyTemporalVfxPpms(uc,vfx,input,{baseSeed:40,seedStep:1});
  const second=await applyTemporalVfxPpms(uc,vfx,input,{baseSeed:40,seedStep:1});
  assert.equal(first.observation.frame_count,2);
  assert.equal(first.observation.donor_invariant.vfx_graph_id,"fx.electric-storm");
  assert.equal(first.observation.donor_invariant.uc_hand_count,501);
  assert.equal(first.observation.donor_invariant.uc_recipe_count,508);
  assert.equal(first.observation.distinct_vfx_state_count,2);
  assert.equal(first.observation.distinct_effect_raster_count,2);
  assert.equal(first.observation.changed_frame_count,2);
  assert.equal(first.observation.repeat_verification,"PASS");
  assert.deepEqual(first.observation.frames.map((row)=>row.seed),[40,41]);
  assert(first.outputPpms.every((bytes,index)=>!bytes.equals(input[index])));
  assert(first.outputPpms.every((bytes,index)=>bytes.equals(second.outputPpms[index])));
  assert(first.observation.frames.every((row)=>row.repeat_verification==="PASS"));
});

test("temporal VFX rejects mixed dimensions",async()=>{
  const root=await mkdtemp(join(tmpdir(),"axm-cr-temporal-vfx-dim-"));
  const uc=join(root,"uc"),vfx=join(root,"vfx");await makeUcFixture(uc);await makeVfxFixture(vfx);
  const a=serializePpmRgb8(2,1,Buffer.from([1,2,3,4,5,6]));
  const b=serializePpmRgb8(1,1,Buffer.from([7,8,9]));
  await assert.rejects(()=>applyTemporalVfxPpms(uc,vfx,[a,b]),/dimensions do not match/);
});

test("temporal VFX seed policy is explicit and bounded",()=>{
  assert.deepEqual(normalizeTemporalVfxPolicy({baseSeed:10,seedStep:0}),{base_seed:10,seed_step:0});
  assert.throws(()=>normalizeTemporalVfxPolicy({baseSeed:2_000_000_001}),/baseSeed/);
  assert.throws(()=>normalizeTemporalVfxPolicy({seedStep:1_000_001}),/seedStep/);
});
