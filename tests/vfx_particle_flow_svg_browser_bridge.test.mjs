import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/creative_scene_operator.mjs";
import {
  makeParticleFlowSvgBrowserProbeHtml,
  parseParticleFlowSvgBrowserProbeDump,
  verifyParticleFlowSvgBrowserRasterEvidence,
} from "../src/vfx_particle_flow_svg_browser_bridge.mjs";

const zeroSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><polyline points="10,10 10,10"/><g data-layer="starts"></g><g data-layer="ends"></g></svg>', "utf8");
const activeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><polyline points="10,10 20,20"/><g data-layer="starts"></g><g data-layer="ends"></g></svg>', "utf8");

test("browser probe binds exact zero and active SVG identities without external network", () => {
  const html = makeParticleFlowSvgBrowserProbeHtml({ zeroSvg, activeSvg }).toString("utf8");
  assert.match(html, /particle-flow SVG browser raster probe/);
  assert.match(html, new RegExp(sha256(zeroSvg)));
  assert.match(html, new RegExp(sha256(activeSvg)));
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("browser dump parser and verifier require measurable exact-bound raw-pixel differences", () => {
  const evidence = {
    schema: "axm.creative-render.particle-flow-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    zero_svg_sha256: sha256(zeroSvg),
    active_svg_sha256: sha256(activeSvg),
    zero_rgba_fnv1a32: "11111111",
    active_rgba_fnv1a32: "22222222",
    different_pixels: 42,
    different_channels: 84,
    sum_abs_channel_delta: 1234,
    max_channel_delta: 99,
  };
  const dump = Buffer.from(`<html><body><pre id="result">${JSON.stringify(evidence)}</pre></body></html>`, "utf8");
  const parsed = parseParticleFlowSvgBrowserProbeDump(dump);
  const verified = verifyParticleFlowSvgBrowserRasterEvidence(parsed, { zeroSvgSha256: sha256(zeroSvg), activeSvgSha256: sha256(activeSvg) });
  assert.equal(verified.different_pixels, 42);
  assert.throws(() => verifyParticleFlowSvgBrowserRasterEvidence({ ...evidence, active_svg_sha256: "wrong" }, { activeSvgSha256: sha256(activeSvg) }), /identity mismatch/);
  assert.throws(() => verifyParticleFlowSvgBrowserRasterEvidence({ ...evidence, different_pixels: 0, different_channels: 0, sum_abs_channel_delta: 0, max_channel_delta: 0, active_rgba_fnv1a32: evidence.zero_rgba_fnv1a32 }), /did not observe/);
});
