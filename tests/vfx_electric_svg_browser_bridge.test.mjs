import test from "node:test";
import assert from "node:assert/strict";

import {
  makeElectricSvgBrowserProbeHtml,
  parseElectricSvgBrowserProbeDump,
  verifyElectricSvgBrowserRasterEvidence,
} from "../src/vfx_electric_svg_browser_bridge.mjs";
import { sha256 } from "../src/creative_scene_operator.mjs";

const baseSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#05060b"/><polyline points="50,300 950,250" fill="none" stroke="white" stroke-width="3" opacity="1"/></svg>');
const modulatedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#05060b"/><polyline points="50,300 950,250" fill="none" stroke="white" stroke-width="3" opacity="0.4"/></svg>');

test("browser probe embeds exact SVG identities without external network dependencies", () => {
  const html = makeElectricSvgBrowserProbeHtml({ baseSvg, modulatedSvg });
  const source = html.toString("utf8");
  assert.match(source, /axm\.creative-render\.browser-svg-raster-evidence\/v1/);
  assert.match(source, /data:image\/svg\+xml;base64/);
  assert.match(source, new RegExp(sha256(baseSvg)));
  assert.match(source, new RegExp(sha256(modulatedSvg)));
  assert.doesNotMatch(source, /https?:\/\//);
  assert.match(source, /getImageData/);
});

test("browser raster evidence verifier binds exact SVG hashes and requires a real pixel difference", () => {
  const evidence = {
    schema: "axm.creative-render.browser-svg-raster-evidence/v1",
    width: 1000,
    height: 600,
    pixel_count: 600000,
    rgba_bytes: 2400000,
    base_svg_sha256: sha256(baseSvg),
    modulated_svg_sha256: sha256(modulatedSvg),
    base_rgba_fnv1a32: "12345678",
    modulated_rgba_fnv1a32: "9abcdef0",
    different_pixels: 321,
    different_channels: 456,
    sum_abs_channel_delta: 7890,
    max_channel_delta: 91,
  };
  assert.deepEqual(verifyElectricSvgBrowserRasterEvidence(evidence, {
    baseSvgSha256: sha256(baseSvg),
    modulatedSvgSha256: sha256(modulatedSvg),
  }), evidence);
  assert.throws(() => verifyElectricSvgBrowserRasterEvidence({ ...evidence, different_pixels: 0 }), /did not observe/);
  assert.throws(() => verifyElectricSvgBrowserRasterEvidence(evidence, { baseSvgSha256: "wrong" }), /identity mismatch/);
});

test("browser DOM dump parser extracts the bounded raster evidence payload and fails closed on malformed dumps", () => {
  const payload = { schema: "axm.creative-render.browser-svg-raster-evidence/v1", width: 1000 };
  const dump = Buffer.from(`<html><body data-axm-done="true"><pre id="result">${JSON.stringify(payload)}</pre></body></html>`);
  assert.deepEqual(parseElectricSvgBrowserProbeDump(dump), payload);
  assert.throws(() => parseElectricSvgBrowserProbeDump(Buffer.from("<html></html>")), /missing #result/);
  assert.throws(() => parseElectricSvgBrowserProbeDump(Buffer.from('<pre id="result">not-json</pre>')), /not valid JSON/);
});
