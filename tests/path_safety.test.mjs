import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { pathIsInside, requirePathInside } from "../src/path_safety.mjs";

test("path confinement accepts root and ordinary nested paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-path-root-"));
  assert.equal(pathIsInside(root, root), true);
  assert.equal(pathIsInside(root, join(root, "nested", "file.ppm")), true);
  assert.equal(requirePathInside(root, join(root, "nested", "file.ppm")), join(root, "nested", "file.ppm"));
});

test("path confinement accepts inside names beginning with dots", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-path-dot-"));
  assert.equal(pathIsInside(root, join(root, "..preview.ppm")), true);
  assert.equal(pathIsInside(root, join(root, ".hidden", "frame.ppm")), true);
});

test("path confinement rejects siblings and parent traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "axm-cr-path-bound-"));
  const outside = `${root}-sibling`;
  assert.equal(pathIsInside(root, outside), false);
  assert.equal(pathIsInside(root, join(root, "..", "outside.ppm")), false);
  assert.throws(() => requirePathInside(root, outside, "outside rejected"), /outside rejected/);
});
