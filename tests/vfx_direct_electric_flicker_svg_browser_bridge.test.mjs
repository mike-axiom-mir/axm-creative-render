import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/creative_scene_operator.mjs";
import {
  makeDirectElectricFlickerSvgBrowserProbeHtml,
  parseDirectElectricFlickerSvgBrowserProbeDump,
  verifyDirectElectricFlickerSvgBrowserRasterEvidence,
} from "../src/vfx_direct_electric_flicker_svg_browser_bridge.mjs";

const phaseASvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><polyline points="50,300 950,250" fill="none" stroke="white" stroke-width="3" opacity="0.25"/></svg>');
const phaseBSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><polyline points="50,300 950,250" fill="none" stroke="white" stroke-width="3" opacity="0.75"/></svg>');

test("direct electric flicker browser probe binds exact phase SVG identities without network dependencies", () => {
  const html = makeDirectElectricFlickerSvgBrowserProbeHtml({ phaseASvg, phaseBSvg });
  const source = html.toString("utf8");
  assert.match(source, /axm\.creative-render\.browser-svg-raster-evidence\/v1/);
  assert.match(source, new RegExp(sha256(phaseASvg)));
  assert.match(source, new RegExp(sha256(phaseBSvg)));
  assert.match(source, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.match(source, /getImageData/);
});

test("direct electric flicker browser verifier binds phase SVG hashes and requires measurable pixel difference", () => {
  const evidence = {
    schema: "axm.creative-render.browser-svg-raster-evidence/v1",
    width: 1000,
    height: 600,
    pixel_count: 600000,
    rgba_bytes: 2400000,
    base_svg_sha256: sha256(phaseASvg),
    modulated_svg_sha256: sha256(phaseBSvg),
    base_rgba_fnv1a32: "12345678",
    modulated_rgba_fnv1a32: "9abcdef0",
    different_pixels: 44,
    different_channels: 77,
    sum_abs_channel_delta: 1234,
    max_channel_delta: 88,
  };
  assert.deepEqual(verifyDirectElectricFlickerSvgBrowserRasterEvidence(evidence, {
    phaseASvgSha256: sha256(phaseASvg),
    phaseBSvgSha256: sha256(phaseBSvg),
  }), evidence);
  assert.throws(() => verifyDirectElectricFlickerSvgBrowserRasterEvidence({ ...evidence, different_pixels: 0 }, {
    phaseASvgSha256: sha256(phaseASvg),
    phaseBSvgSha256: sha256(phaseBSvg),
  }), /did not observe/);
  assert.throws(() => verifyDirectElectricFlickerSvgBrowserRasterEvidence(evidence, { phaseASvgSha256: "wrong" }), /identity mismatch/);
});

test("direct electric flicker browser dump parser fails closed on malformed observer output", () => {
  const payload = { schema: "axm.creative-render.browser-svg-raster-evidence/v1", width: 1000 };
  const dump = Buffer.from(`<html><body data-axm-done="true"><pre id="result">${JSON.stringify(payload)}</pre></body></html>`);
  assert.deepEqual(parseDirectElectricFlickerSvgBrowserProbeDump(dump), payload);
  assert.throws(() => parseDirectElectricFlickerSvgBrowserProbeDump(Buffer.from("<html></html>")), /missing #result/);
});
