import test from "node:test";
import assert from "node:assert/strict";

import {
  makeLightParticleLayerSvgBrowserProbeHtml,
  parseLightParticleLayerSvgBrowserProbeDump,
  verifyLightParticleLayerSvgBrowserRasterEvidence,
} from "../src/vfx_light_particle_layer_svg_browser_bridge.mjs";

const UNDER_HASH = "a".repeat(64);
const OVER_HASH = "b".repeat(64);

function evidence(overrides = {}) {
  return {
    schema: "axm.creative-render.light-particle-layer-browser-svg-raster-evidence/v1",
    width: 640,
    height: 420,
    pixel_count: 268800,
    rgba_bytes: 1075200,
    rays_under_particles_svg_sha256: UNDER_HASH,
    particles_under_rays_svg_sha256: OVER_HASH,
    rays_under_particles_rgba_fnv1a32: "12345678",
    particles_under_rays_rgba_fnv1a32: "87654321",
    different_pixels: 12,
    different_channels: 18,
    sum_abs_channel_delta: 640,
    max_channel_delta: 96,
    ...overrides,
  };
}

test("light-particle browser probe embeds exact composite SVG identities", () => {
  const under = Buffer.from("<svg><rect width='2' height='2' fill='#111'/><circle cx='1' cy='1' r='1'/></svg>");
  const over = Buffer.from("<svg><rect width='2' height='2' fill='#222'/><circle cx='1' cy='1' r='1'/></svg>");
  const html = makeLightParticleLayerSvgBrowserProbeHtml({ raysUnderParticlesSvg: under, particlesUnderRaysSvg: over }).toString("utf8");
  assert.match(html, /light-particle layer SVG browser raster probe/);
  assert.match(html, /UNDER_SVG_SHA256/);
  assert.match(html, /OVER_SVG_SHA256/);
  assert.match(html, /dataset\.axmDone/);
});

test("light-particle browser raster evidence is hash-bound and requires a measurable verified-order difference", () => {
  const value = evidence();
  assert.deepEqual(
    verifyLightParticleLayerSvgBrowserRasterEvidence(value, { raysUnderParticlesSvgSha256: UNDER_HASH, particlesUnderRaysSvgSha256: OVER_HASH }),
    value,
  );
  assert.throws(() => verifyLightParticleLayerSvgBrowserRasterEvidence(evidence({ different_pixels: 0 })), /did not observe/);
  assert.throws(() => verifyLightParticleLayerSvgBrowserRasterEvidence(evidence({ particles_under_rays_rgba_fnv1a32: "12345678" })), /did not diverge/);
  assert.throws(() => verifyLightParticleLayerSvgBrowserRasterEvidence(value, { raysUnderParticlesSvgSha256: "c".repeat(64) }), /rays-under-particles SVG identity mismatch/);
});

test("light-particle browser probe dump parsing refuses missing or malformed evidence", () => {
  const value = evidence();
  const dump = Buffer.from(`<html><body data-axm-done="true"><pre id="result">${JSON.stringify(value)}</pre></body></html>`);
  assert.deepEqual(parseLightParticleLayerSvgBrowserProbeDump(dump), value);
  assert.throws(() => parseLightParticleLayerSvgBrowserProbeDump(Buffer.from("<html></html>")), /missing #result/);
  assert.throws(() => parseLightParticleLayerSvgBrowserProbeDump(Buffer.from('<pre id="result">nope</pre>')), /not valid JSON/);
});
