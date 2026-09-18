import test from "node:test";
import assert from "node:assert/strict";

import {
  makePathSweepPropagationSvgBrowserProbeHtml,
  parsePathSweepPropagationSvgBrowserProbeDump,
  verifyPathSweepPropagationSvgBrowserRasterEvidence,
} from "../src/vfx_path_sweep_propagation_svg_browser_bridge.mjs";

const PHASE_A_HASH = "a".repeat(64);
const PHASE_B_HASH = "b".repeat(64);

function evidence(overrides = {}) {
  return {
    schema: "axm.creative-render.path-sweep-propagation-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    phase_a_svg_sha256: PHASE_A_HASH,
    phase_b_svg_sha256: PHASE_B_HASH,
    phase_a_rgba_fnv1a32: "12345678",
    phase_b_rgba_fnv1a32: "87654321",
    different_pixels: 12,
    different_channels: 18,
    sum_abs_channel_delta: 640,
    max_channel_delta: 96,
    ...overrides,
  };
}

test("path-sweep propagation browser probe embeds exact SVG identities", () => {
  const phaseA = Buffer.from("<svg><polygon points='0,0 1,0 1,1' opacity='0.2'/></svg>");
  const phaseB = Buffer.from("<svg><polygon points='0,0 1,0 1,1' opacity='0.8'/></svg>");
  const html = makePathSweepPropagationSvgBrowserProbeHtml({ phaseASvg: phaseA, phaseBSvg: phaseB }).toString("utf8");
  assert.match(html, /path-sweep propagation SVG browser raster probe/);
  assert.match(html, /PHASE_A_SVG_SHA256/);
  assert.match(html, /PHASE_B_SVG_SHA256/);
  assert.match(html, /dataset\.axmDone/);
});

test("path-sweep propagation browser raster evidence is hash-bound and requires a measurable phase difference", () => {
  const value = evidence();
  assert.deepEqual(
    verifyPathSweepPropagationSvgBrowserRasterEvidence(value, { phaseASvgSha256: PHASE_A_HASH, phaseBSvgSha256: PHASE_B_HASH }),
    value,
  );
  assert.throws(() => verifyPathSweepPropagationSvgBrowserRasterEvidence(evidence({ different_pixels: 0 })), /did not observe/);
  assert.throws(() => verifyPathSweepPropagationSvgBrowserRasterEvidence(evidence({ phase_b_rgba_fnv1a32: "12345678" })), /did not diverge/);
  assert.throws(() => verifyPathSweepPropagationSvgBrowserRasterEvidence(value, { phaseASvgSha256: "c".repeat(64) }), /phase A SVG identity mismatch/);
});

test("path-sweep propagation browser probe dump parsing refuses missing or malformed evidence", () => {
  const value = evidence();
  const dump = Buffer.from(`<html><body data-axm-done="true"><pre id="result">${JSON.stringify(value)}</pre></body></html>`);
  assert.deepEqual(parsePathSweepPropagationSvgBrowserProbeDump(dump), value);
  assert.throws(() => parsePathSweepPropagationSvgBrowserProbeDump(Buffer.from("<html></html>")), /missing #result/);
  assert.throws(() => parsePathSweepPropagationSvgBrowserProbeDump(Buffer.from('<pre id="result">nope</pre>')), /not valid JSON/);
});
