import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/creative_scene_operator.mjs";
import {
  makeDistanceBandParticleSvgBrowserProbeHtml,
  parseDistanceBandParticleSvgBrowserProbeDump,
  verifyDistanceBandParticleSvgBrowserRasterEvidence,
} from "../src/vfx_distance_band_particle_svg_browser_bridge.mjs";

const fbmSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><g data-layer="weighted-particles"><circle cx="10" cy="10" r="2"/></g></svg>', "utf8");
const cellularSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><g data-layer="weighted-particles"><circle cx="10" cy="10" r="5"/></g></svg>', "utf8");

test("distance-band particle browser probe binds exact donor SVG identities without external network", () => {
  const html = makeDistanceBandParticleSvgBrowserProbeHtml({ fbmSvg, cellularSvg }).toString("utf8");
  assert.match(html, /distance-band particle SVG browser raster probe/);
  assert.match(html, new RegExp(sha256(fbmSvg)));
  assert.match(html, new RegExp(sha256(cellularSvg)));
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("distance-band particle browser dump parser and verifier require exact-bound measurable pixel differences", () => {
  const evidence = {
    schema: "axm.creative-render.distance-band-particle-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    fbm_svg_sha256: sha256(fbmSvg),
    cellular_svg_sha256: sha256(cellularSvg),
    fbm_rgba_fnv1a32: "11111111",
    cellular_rgba_fnv1a32: "22222222",
    different_pixels: 73,
    different_channels: 141,
    sum_abs_channel_delta: 2400,
    max_channel_delta: 91,
  };
  const dump = Buffer.from(`<html><body><pre id="result">${JSON.stringify(evidence)}</pre></body></html>`, "utf8");
  const parsed = parseDistanceBandParticleSvgBrowserProbeDump(dump);
  const verified = verifyDistanceBandParticleSvgBrowserRasterEvidence(parsed, {
    fbmSvgSha256: sha256(fbmSvg),
    cellularSvgSha256: sha256(cellularSvg),
  });
  assert.equal(verified.different_pixels, 73);
  assert.throws(
    () => verifyDistanceBandParticleSvgBrowserRasterEvidence({ ...evidence, cellular_svg_sha256: "wrong" }, { cellularSvgSha256: sha256(cellularSvg) }),
    /identity mismatch/,
  );
  assert.throws(
    () => verifyDistanceBandParticleSvgBrowserRasterEvidence({
      ...evidence,
      different_pixels: 0,
      different_channels: 0,
      sum_abs_channel_delta: 0,
      max_channel_delta: 0,
      cellular_rgba_fnv1a32: evidence.fbm_rgba_fnv1a32,
    }),
    /did not observe/,
  );
});
