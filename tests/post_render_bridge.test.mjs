import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import {
  applyUniversalCreationToRenderedPpm,
  parsePpmRgb8,
  ppmToPrecisionRaster,
  precisionRasterToPpm,
  serializePpmRgb8,
} from "../src/post_render_bridge.mjs";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function digest(value) { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }

async function makeUcFixture(root) {
  const dir = join(root, "capabilities", "platform-hands");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "index.js"),
    `
const crypto=require('crypto');
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
function digest(value){return crypto.createHash('sha256').update(canonical(value),'utf8').digest('hex');}
function style(image,step){const rgba=Buffer.from(image.rgba8_base64,'base64');for(let i=0;i<rgba.length;i+=4){if(step==='tint'){rgba[i]=Math.min(255,rgba[i]+12);rgba[i+1]=Math.min(255,rgba[i+1]+5);}else{rgba[i]=Math.min(255,rgba[i]+3);rgba[i+2]=Math.max(0,rgba[i+2]-2);}}const out={schema:image.schema,version:image.version,width:image.width,height:image.height,rgba8_base64:rgba.toString('base64'),colour_space:image.colour_space,source_digest:digest(rgba)};out.digest=digest(out);return out;}
const creativeFlow={version:'fixture-flow',summary(){return {digest:'flow-summary'};},run(req){const input=req.state.frame;const tinted=style(input,'tint');const styled=style(tinted,'contrast');const receipts=[{operation_id:'creative.adjust.tint',digest:'r-tint'},{operation_id:'creative.adjust.contrast',digest:'r-contrast'}];const body={status:'PASS',candidate_ready:true,source_state_mutated:false,receipts,final_state:{frame:input,tinted,styled}};body.digest=digest({styled:styled.digest,receipts});return body;}};
module.exports={creativeHands:{version:'fixture-hands',audit(){return {total:441,digest:'audit'}},recipeRegistry(){return {count:448,digest:'recipes'}}},creativeFlow};
`,
  );
}

test("P6 PPM round-trips through precision raster with opaque alpha", () => {
  const ppm = serializePpmRgb8(2, 1, Buffer.from([1, 2, 3, 250, 251, 252]));
  const parsed = parsePpmRgb8(ppm);
  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 1);
  assert.deepEqual([...parsed.rgb], [1, 2, 3, 250, 251, 252]);
  const raster = ppmToPrecisionRaster(ppm);
  assert.equal(raster.schema, "axm.precision-raster/v1");
  assert.equal(Buffer.from(raster.rgba8_base64, "base64")[3], 255);
  assert.equal(precisionRasterToPpm(raster).equals(ppm), true);
  const body = { ...raster }; delete body.digest;
  assert.equal(raster.digest, digest(body));
});

test("P6 parser accepts header comments but rejects wrong payload length", () => {
  const ppm = Buffer.concat([Buffer.from("P6\n# test\n1 1\n255\n", "ascii"), Buffer.from([10, 20, 30])]);
  assert.deepEqual([...parsePpmRgb8(ppm).rgb], [10, 20, 30]);
  assert.throws(() => parsePpmRgb8(Buffer.from("P6\n1 1\n255\nxx", "binary")), /length mismatch/);
  assert.throws(() => parsePpmRgb8(Buffer.from("P3\n1 1\n255\n0 0 0", "ascii")), /binary P6/);
});

test("real-shaped public Creative Flow can operate on a rendered PPM state", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-post-"));
  await makeUcFixture(root);
  const input = serializePpmRgb8(2, 1, Buffer.from([20, 30, 40, 100, 120, 140]));
  const first = await applyUniversalCreationToRenderedPpm(root, input);
  const second = await applyUniversalCreationToRenderedPpm(root, input);
  assert.equal(first.observation.hand_count, 441);
  assert.equal(first.observation.recipe_count, 448);
  assert.deepEqual(first.observation.operation_ids, ["creative.adjust.tint", "creative.adjust.contrast"]);
  assert.equal(first.observation.repeat_verification, "PASS");
  assert.equal(first.outputPpm.equals(input), false);
  assert.equal(first.outputPpm.equals(second.outputPpm), true);
  assert.equal(parsePpmRgb8(first.outputPpm).width, 2);
});
