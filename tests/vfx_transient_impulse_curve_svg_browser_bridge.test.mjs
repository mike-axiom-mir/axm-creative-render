import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/creative_scene_operator.mjs";
import {
  makeTransientImpulseCurveSvgBrowserProbeHtml,
  observeVisualEffectTransientImpulseCurveStaticSvg,
  parseTransientImpulseCurveSvgBrowserProbeDump,
  verifyTransientImpulseCurveSvgBrowserRasterEvidence,
} from "../src/vfx_transient_impulse_curve_svg_browser_bridge.mjs";

const baseSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><ellipse cx="5" cy="5" rx="2" ry="2"/><line x1="1" y1="1" x2="3" y2="3"/></svg>', "utf8");
const noopSvg = Buffer.from(baseSvg);
const shapedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><ellipse cx="5" cy="5" rx="4" ry="4"/><line x1="1" y1="1" x2="4" y2="4"/></svg>', "utf8");

test("transient impulse curve browser probe binds exact SVG bytes without network access", () => {
  const html = makeTransientImpulseCurveSvgBrowserProbeHtml({ baseSvg, noopSvg, shapedSvg }).toString("utf8");
  assert.match(html, /transient impulse curve SVG browser probe/);
  assert.match(html, new RegExp(sha256(baseSvg)));
  assert.match(html, new RegExp(sha256(shapedSvg)));
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("browser evidence requires exact constant-one no-op and measurable shaped difference", () => {
  const evidence = {
    schema: "axm.creative-render.transient-impulse-curve-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    svg_sha256: { base: sha256(baseSvg), noop: sha256(noopSvg), shaped: sha256(shapedSvg) },
    rgba_fnv1a32: { base: "11111111", noop: "11111111", shaped: "22222222" },
    base_noop: { different_pixels: 0, different_channels: 0, sum_abs_channel_delta: 0, max_channel_delta: 0 },
    base_shaped: { different_pixels: 42, different_channels: 84, sum_abs_channel_delta: 1234, max_channel_delta: 99 },
    noop_shaped: { different_pixels: 42, different_channels: 84, sum_abs_channel_delta: 1234, max_channel_delta: 99 },
  };
  const dump = Buffer.from(`<html><body><pre id="result">${JSON.stringify(evidence)}</pre></body></html>`, "utf8");
  const parsed = parseTransientImpulseCurveSvgBrowserProbeDump(dump);
  const verified = verifyTransientImpulseCurveSvgBrowserRasterEvidence(parsed, {
    baseSvgSha256: sha256(baseSvg), noopSvgSha256: sha256(noopSvg), shapedSvgSha256: sha256(shapedSvg),
  });
  assert.equal(verified.base_noop.different_pixels, 0);
  assert.equal(verified.base_shaped.different_pixels, 42);
  assert.throws(
    () => verifyTransientImpulseCurveSvgBrowserRasterEvidence({ ...evidence, base_noop: { ...evidence.base_noop, different_pixels: 1 } }),
    /exact browser-pixel no-op/,
  );
  assert.throws(
    () => verifyTransientImpulseCurveSvgBrowserRasterEvidence({
      ...evidence,
      rgba_fnv1a32: { ...evidence.rgba_fnv1a32, shaped: evidence.rgba_fnv1a32.base },
      base_shaped: { different_pixels: 0, different_channels: 0, sum_abs_channel_delta: 0, max_channel_delta: 0 },
    }),
    /not observable/,
  );
});

test("transient impulse curve SVG bridge rejects non-exact donor revisions before donor access", async () => {
  await assert.rejects(
    observeVisualEffectTransientImpulseCurveStaticSvg("/definitely/not/a/donor", { vfxRevision: "main" }),
    /exact 40-character lowercase git SHA/,
  );
});
