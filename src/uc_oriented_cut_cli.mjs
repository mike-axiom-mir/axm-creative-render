#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildUcOrientedCutScenePair } from "./uc_oriented_cut_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function parseArgs(argv) {
  if (argv[0] !== "build") throw new Error("only the 'build' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "donor-bundle", "source-scene", "cut-scene", "evidence"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const ucRoot = resolve(args["uc-root"]);
  const bundlePath = resolve(args["donor-bundle"]);
  const sourceScenePath = resolve(args["source-scene"]);
  const cutScenePath = resolve(args["cut-scene"]);
  const evidencePath = resolve(args.evidence);
  const outputs = [sourceScenePath, cutScenePath, evidencePath];
  if (new Set(outputs).size !== outputs.length) throw new Error("oriented-cut outputs must be distinct");
  for (const path of outputs) {
    if (pathIsInside(ucRoot, path)) throw new Error("oriented-cut outputs may not be written inside the Universal Creation donor repository");
  }
  if (pathIsInside(ucRoot, bundlePath)) throw new Error("donor bundle must remain outside the Universal Creation repository");

  const bundleBytes = await readFile(bundlePath);
  const result = buildUcOrientedCutScenePair(bundleBytes, { albedo: [82, 180, 210] });
  await write(sourceScenePath, result.sourceSceneBytes);
  await write(cutScenePath, result.cutSceneBytes);

  const evidence = {
    contract: "AXM_CREATIVE_UC_ORIENTED_CUT_SCENE_EVIDENCE",
    version: 1,
    observation: result.observation,
    inputs: {
      donor_bundle: { sha256: sha256(bundleBytes), bytes: bundleBytes.length },
    },
    outputs: {
      source_scene: { media_type: "application/x-axm-scene", sha256: sha256(result.sourceSceneBytes), bytes: result.sourceSceneBytes.length },
      cut_scene: { media_type: "application/x-axm-scene", sha256: sha256(result.cutSceneBytes), bytes: result.cutSceneBytes.length },
    },
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await write(evidencePath, evidenceBytes);

  console.log("uc_oriented_cut_bridge=PASS");
  console.log(`donor_revision=${result.observation.donor.donor_revision}`);
  console.log(`source_glb_sha256=${result.observation.donor.source_glb_sha256}`);
  console.log(`cut_glb_sha256=${result.observation.donor.cut_glb_sha256}`);
  console.log(`source_triangles=${result.observation.donor.source_triangles}`);
  console.log(`cut_triangles=${result.observation.donor.cut_triangles}`);
  console.log(`axis_alignment=${result.observation.donor.axis_alignment}`);
  console.log(`source_scene_sha256=${evidence.outputs.source_scene.sha256}`);
  console.log(`cut_scene_sha256=${evidence.outputs.cut_scene.sha256}`);
  console.log(`evidence_sha256=${sha256(evidenceBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
