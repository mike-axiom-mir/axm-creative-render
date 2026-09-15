import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildFrameStateProject } from "../src/framestate_bridge.mjs";
import { serializePpmRgb8 } from "../src/post_render_bridge.mjs";

async function frame(path, rgb) {
  await mkdir(join(path, "frames"), { recursive: true });
  const target = join(path, "frames", `${rgb[0]}.ppm`);
  await writeFile(target, serializePpmRgb8(2, 1, Buffer.from(rgb)));
  return target;
}

test("FrameState bridge makes explicit sequential image layers over exact source frames", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-fs-"));
  const a = await frame(root, [10, 20, 30, 40, 50, 60]);
  const b = await frame(root, [70, 80, 90, 100, 110, 120]);
  const c = await frame(root, [130, 140, 150, 160, 170, 180]);
  const built = await buildFrameStateProject({ framePaths: [a, b, c], machineRoot: root, fps: 12, holdFrames: 4 });
  assert.equal(built.project.schema, "axm.framestate.project/v0.5");
  assert.equal(built.project.canvas.width, 2);
  assert.equal(built.project.canvas.height, 1);
  assert.equal(built.project.duration_frames, 12);
  assert.equal(built.project.media.length, 3);
  assert.equal(built.project.layers.length, 3);
  assert.deepEqual(built.project.layers.map((row) => [row.start_frame, row.end_frame]), [[0, 4], [4, 8], [8, 12]]);
  assert(built.project.media.every((row) => !row.path.startsWith("/")));
  assert.equal(built.receipt.frame_count, 3);
  assert.equal(built.receipt.duration_seconds, 1);
  assert.equal(new Set(built.receipt.source_frames.map((row) => row.sha256)).size, 3);
});

test("FrameState bridge rejects mixed dimensions and paths outside machine root", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-fs-bound-"));
  const inside = join(root, "inside.ppm");
  const outsideRoot = await mkdtemp(join(tmpdir(), "axm-cr-fs-outside-"));
  const outside = join(outsideRoot, "outside.ppm");
  await writeFile(inside, serializePpmRgb8(2, 1, Buffer.from([1,2,3,4,5,6])));
  await writeFile(outside, serializePpmRgb8(2, 1, Buffer.from([7,8,9,10,11,12])));
  await assert.rejects(() => buildFrameStateProject({ framePaths: [inside, outside], machineRoot: root }), /inside the declared machine root/);

  const other = join(root, "other.ppm");
  await writeFile(other, serializePpmRgb8(1, 1, Buffer.from([1,2,3])));
  await assert.rejects(() => buildFrameStateProject({ framePaths: [inside, other], machineRoot: root }), /dimensions do not match/);
});

test("FrameState bridge bounds frame count, fps and hold length", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-fs-limits-"));
  const a = join(root, "a.ppm"), b = join(root, "b.ppm");
  const body = serializePpmRgb8(1, 1, Buffer.from([1,2,3]));
  await writeFile(a, body); await writeFile(b, body);
  await assert.rejects(() => buildFrameStateProject({ framePaths: [a], machineRoot: root }), /2..32/);
  await assert.rejects(() => buildFrameStateProject({ framePaths: [a,b], machineRoot: root, fps: 0 }), /fps/);
  await assert.rejects(() => buildFrameStateProject({ framePaths: [a,b], machineRoot: root, holdFrames: 241 }), /holdFrames/);
});
