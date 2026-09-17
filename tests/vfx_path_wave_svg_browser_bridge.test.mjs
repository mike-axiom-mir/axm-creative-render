import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/creative_scene_operator.mjs";
import {
  makePathWaveSvgBrowserProbeHtml,
  parsePathWaveSvgBrowserProbeDump,
  verifyPathWaveSvgBrowserRasterEvidence,
} from "../src/vfx_path_wave_svg_browser_bridge.mjs";

const zeroSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><g data-layer="derived-paths"><polyline points="10,10 20,20"/></g></svg>', "utf8");
const activeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><g data-layer="derived-paths"><polyline points="10,10 28,24"/></g></svg>', "utf8");

test("path-wave browser probe binds exact SVG identities without external network", () => {
  const html = makePathWaveSvgBrowserProbeHtml({ zeroSvg, activeSvg }).toString("utf8");
  assert.match(html, /path-wave SVG browser raster probe/);
  assert.match(html, new RegExp(sha256(zeroSvg)));
  assert.match(html, new RegExp(sha256(activeSvg)));
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("path-wave browser dump parser and verifier require exact-bound measurable pixel differences", () => {
  const evidence = {
    schema: "axm.creative-render.path-wave-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    zero_svg_sha256: sha256(zeroSvg),
    active_svg_sha256: sha256(activeSvg),
    zero_rgba_fnv1a32: "11111111",
    active_rgba_fnv1a32: "22222222",
    different_pixels: 21,
    different_channels: 43,
    sum_abs_channel_delta: 900,
    max_channel_delta: 77,
  };
  const dump = Buffer.from(`<html><body><pre id="result">${JSON.stringify(evidence)}</pre></body></html>`, "utf8");
  const parsed = parsePathWaveSvgBrowserProbeDump(dump);
  const verified = verifyPathWaveSvgBrowserRasterEvidence(parsed, { zeroSvgSha256: sha256(zeroSvg), activeSvgSha256: sha256(activeSvg) });
  assert.equal(verified.different_pixels, 21);
  assert.throws(() => verifyPathWaveSvgBrowserRasterEvidence({ ...evidence, active_svg_sha256: "wrong" }, { activeSvgSha256: sha256(activeSvg) }), /identity mismatch/);
  assert.throws(() => verifyPathWaveSvgBrowserRasterEvidence({ ...evidence, different_pixels: 0, different_channels: 0, sum_abs_channel_delta: 0, max_channel_delta: 0, active_rgba_fnv1a32: evidence.zero_rgba_fnv1a32 }), /did not observe/);
});
