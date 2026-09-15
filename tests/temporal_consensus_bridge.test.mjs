import test from "node:test";
import assert from "node:assert/strict";

import { chooseConsensusTrackingRegions, summarizeTrackConsensus, analyzeConsensusTemporalPpms } from "../src/temporal_consensus_bridge.mjs";
import { serializePpmRgb8 } from "../src/post_render_bridge.mjs";

function featureFrame(width = 120, height = 80) {
  const rgb = Buffer.alloc(width * height * 3, 20);
  const boxes = [
    { x0: 18, y0: 18, x1: 34, y1: 38, color: [230, 40, 40] },
    { x0: 52, y0: 16, x1: 69, y1: 35, color: [40, 230, 80] },
    { x0: 83, y0: 42, x1: 103, y1: 62, color: [60, 80, 240] },
  ];
  for (const box of boxes) {
    for (let y = box.y0; y < box.y1; y += 1) for (let x = box.x0; x < box.x1; x += 1) {
      const i = (y * width + x) * 3;
      rgb[i] = box.color[0]; rgb[i + 1] = box.color[1]; rgb[i + 2] = box.color[2];
    }
  }
  return serializePpmRgb8(width, height, rgb);
}

function track(dx, dy, mse, id) {
  return {
    schema: "axm.precision-frame-track/v1",
    version: "1.0.0",
    reference_digest: "ref",
    current_digest: "cur",
    region: { x: id * 10, y: 0, width: 8, height: 8 },
    search_radius: 8,
    dx, dy, mse, work: 1000,
    digest: `track-${id}`,
  };
}

test("consensus region selection chooses three deterministic diverse evidence regions", () => {
  const first = chooseConsensusTrackingRegions(featureFrame(), { regionCount: 3, searchRadius: 6 });
  const second = chooseConsensusTrackingRegions(featureFrame(), { regionCount: 3, searchRadius: 6 });
  assert.deepEqual(first, second);
  assert.equal(first.regions.length, 3);
  assert.equal(first.selection.method, "diverse-local-rgb-edge-energy/v1");
  assert.equal(first.selection.scores.length, 3);
  assert(first.selection.scores.every((score) => score > 0));
  for (let i = 0; i < first.regions.length; i += 1) {
    for (let j = i + 1; j < first.regions.length; j += 1) {
      const a = first.regions[i], b = first.regions[j];
      const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
      const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
      const overlap = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      assert(overlap / smaller <= 0.25);
    }
  }
});

test("consensus summary uses median evidence but returns a real representative track", () => {
  const rows = [track(4, 2, 8, 0), track(5, 2, 3, 1), track(4, 3, 5, 2)];
  const summary = summarizeTrackConsensus(rows, 2);
  assert.equal(summary.median_dx, 4);
  assert.equal(summary.median_dy, 2);
  assert.equal(summary.agreement, true);
  assert.equal(summary.representative_track, rows[0]);
  assert.equal(summary.representative_track.digest, "track-0");
});

test("consensus summary exposes disagreement without manufacturing a track", () => {
  const rows = [track(-8, 0, 2, 0), track(4, 2, 3, 1), track(10, 8, 4, 2)];
  const summary = summarizeTrackConsensus(rows, 4);
  assert.equal(summary.agreement, false);
  assert(rows.includes(summary.representative_track));
});

test("consensus region count must be odd", () => {
  assert.throws(() => chooseConsensusTrackingRegions(featureFrame(), { regionCount: 4, searchRadius: 6 }), /regionCount must be odd/);
});

test("temporal consensus rejects mixed PPM dimensions before donor execution", async () => {
  const a = serializePpmRgb8(8, 8, Buffer.alloc(8 * 8 * 3, 10));
  const b = serializePpmRgb8(9, 8, Buffer.alloc(9 * 8 * 3, 20));
  await assert.rejects(() => analyzeConsensusTemporalPpms("/definitely-missing-uc", [a, b]), /dimensions do not match/);
});
