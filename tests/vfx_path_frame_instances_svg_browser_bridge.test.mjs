import test from "node:test";
import assert from "node:assert/strict";

import {
  makePathFrameInstancesSvgBrowserProbeHtml,
  parsePathFrameInstancesSvgBrowserProbeDump,
  verifyPathFrameInstancesSvgBrowserRasterEvidence,
} from "../src/vfx_path_frame_instances_svg_browser_bridge.mjs";

const DENSE_HASH = "a".repeat(64);
const SPARSE_HASH = "b".repeat(64);

function evidence(overrides = {}) {
  return {
    schema: "axm.creative-render.path-frame-instances-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    dense_svg_sha256: DENSE_HASH,
    sparse_svg_sha256: SPARSE_HASH,
    dense_rgba_fnv1a32: "12345678",
    sparse_rgba_fnv1a32: "87654321",
    different_pixels: 12,
    different_channels: 18,
    sum_abs_channel_delta: 640,
    max_channel_delta: 96,
    ...overrides,
  };
}

test("path-frame instance browser probe embeds exact SVG identities", () => {
  const dense = Buffer.from("<svg><polyline points='0,0 1,1'/></svg>");
  const sparse = Buffer.from("<svg><polyline points='0,0 2,2'/></svg>");
  const html = makePathFrameInstancesSvgBrowserProbeHtml({ denseSvg: dense, sparseSvg: sparse }).toString("utf8");
  assert.match(html, /path-frame instance SVG browser raster probe/);
  assert.match(html, /DENSE_SVG_SHA256/);
  assert.match(html, /SPARSE_SVG_SHA256/);
  assert.match(html, /dataset\.axmDone/);
});

test("path-frame instance browser raster evidence is hash-bound and requires a measurable difference", () => {
  const value = evidence();
  assert.deepEqual(
    verifyPathFrameInstancesSvgBrowserRasterEvidence(value, { denseSvgSha256: DENSE_HASH, sparseSvgSha256: SPARSE_HASH }),
    value,
  );
  assert.throws(() => verifyPathFrameInstancesSvgBrowserRasterEvidence(evidence({ different_pixels: 0 })), /did not observe/);
  assert.throws(() => verifyPathFrameInstancesSvgBrowserRasterEvidence(evidence({ sparse_rgba_fnv1a32: "12345678" })), /did not diverge/);
  assert.throws(() => verifyPathFrameInstancesSvgBrowserRasterEvidence(value, { denseSvgSha256: "c".repeat(64) }), /dense SVG identity mismatch/);
});

test("path-frame instance browser probe dump parsing refuses missing or malformed evidence", () => {
  const value = evidence();
  const dump = Buffer.from(`<html><body data-axm-done="true"><pre id="result">${JSON.stringify(value)}</pre></body></html>`);
  assert.deepEqual(parsePathFrameInstancesSvgBrowserProbeDump(dump), value);
  assert.throws(() => parsePathFrameInstancesSvgBrowserProbeDump(Buffer.from("<html></html>")), /missing #result/);
  assert.throws(() => parsePathFrameInstancesSvgBrowserProbeDump(Buffer.from('<pre id="result">nope</pre>')), /not valid JSON/);
});
