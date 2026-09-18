import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/creative_scene_operator.mjs";
import {
  makeBranchPropagationSvgBrowserProbeHtml,
  parseBranchPropagationSvgBrowserProbeDump,
  verifyBranchPropagationSvgBrowserRasterEvidence,
} from "../src/vfx_branch_propagation_svg_browser_bridge.mjs";

const phaseASvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><line data-segment="root" x1="10" y1="10" x2="80" y2="80" opacity="0.2"/></svg>', "utf8");
const phaseBSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><line data-segment="root" x1="10" y1="10" x2="80" y2="80" opacity="0.8"/></svg>', "utf8");

test("branch-propagation browser probe binds exact donor SVG identities without external network", () => {
  const html = makeBranchPropagationSvgBrowserProbeHtml({ phaseASvg, phaseBSvg }).toString("utf8");
  assert.match(html, /branch propagation SVG browser raster probe/);
  assert.match(html, new RegExp(sha256(phaseASvg)));
  assert.match(html, new RegExp(sha256(phaseBSvg)));
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("branch-propagation browser dump parser and verifier require exact-bound measurable pixel differences", () => {
  const evidence = {
    schema: "axm.creative-render.branch-propagation-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    phase_a_svg_sha256: sha256(phaseASvg),
    phase_b_svg_sha256: sha256(phaseBSvg),
    phase_a_rgba_fnv1a32: "11111111",
    phase_b_rgba_fnv1a32: "22222222",
    different_pixels: 31,
    different_channels: 71,
    sum_abs_channel_delta: 1400,
    max_channel_delta: 91,
  };
  const dump = Buffer.from(`<html><body><pre id="result">${JSON.stringify(evidence)}</pre></body></html>`, "utf8");
  const parsed = parseBranchPropagationSvgBrowserProbeDump(dump);
  const verified = verifyBranchPropagationSvgBrowserRasterEvidence(parsed, {
    phaseASvgSha256: sha256(phaseASvg),
    phaseBSvgSha256: sha256(phaseBSvg),
  });
  assert.equal(verified.different_pixels, 31);
  assert.throws(
    () => verifyBranchPropagationSvgBrowserRasterEvidence({ ...evidence, phase_b_svg_sha256: "wrong" }, { phaseBSvgSha256: sha256(phaseBSvg) }),
    /identity mismatch/,
  );
  assert.throws(
    () => verifyBranchPropagationSvgBrowserRasterEvidence({ ...evidence, different_pixels: 0, different_channels: 0, sum_abs_channel_delta: 0, max_channel_delta: 0, phase_b_rgba_fnv1a32: evidence.phase_a_rgba_fnv1a32 }),
    /did not observe/,
  );
});
