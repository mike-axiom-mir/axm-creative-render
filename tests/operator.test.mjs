import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeCreativeOperation, parseOperator, parseScene } from "../src/creative_scene_operator.mjs";

const sceneBytes = await readFile(new URL("../examples/reference.axmscene", import.meta.url));
const tintBytes = await readFile(new URL("../examples/tint.operator.json", import.meta.url));
const translateBytes = await readFile(new URL("../examples/translate.operator.json", import.meta.url));

test("reference scene parses as two triangles", () => {
  const scene = parseScene(sceneBytes.toString("utf8"));
  assert.equal(scene.triangles.length, 2);
  assert.deepEqual(scene.triangles[0].albedo, [226, 68, 92]);
});

test("tint is deterministic and changes only albedo", () => {
  const a = executeCreativeOperation(sceneBytes, tintBytes);
  const b = executeCreativeOperation(sceneBytes, tintBytes);
  assert.deepEqual(a.outputBytes, b.outputBytes);
  assert.deepEqual(a.receipt, b.receipt);

  const original = parseScene(sceneBytes.toString("utf8"));
  const output = parseScene(a.outputBytes.toString("utf8"));
  assert.deepEqual(output.triangles[0].vertices, original.triangles[0].vertices);
  assert.deepEqual(output.triangles[0].albedo, [226, 34, 138]);
  assert.equal(a.receipt.input_sha256.length, 64);
  assert.equal(a.receipt.output_sha256.length, 64);
});

test("translate is deterministic and preserves albedo", () => {
  const result = executeCreativeOperation(sceneBytes, translateBytes);
  const original = parseScene(sceneBytes.toString("utf8"));
  const output = parseScene(result.outputBytes.toString("utf8"));
  assert.deepEqual(output.triangles[0].albedo, original.triangles[0].albedo);
  assert.deepEqual(output.triangles[0].vertices[0], [-0.72, -0.82, 0.5]);
});

test("unsupported operator kind is rejected", () => {
  assert.throws(
    () => parseOperator(JSON.stringify({ contract: "AXM_CREATIVE_OPERATOR", version: 1, id: "bad", domain: "scene", kind: "magic", parameters: {} })),
    /unsupported operator kind/,
  );
});

test("unsupported scene version is rejected", () => {
  assert.throws(() => parseScene("AXM_SCENE 2\n"), /unsupported scene header/);
});
