#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildUcMultiHoleChainSceneSet } from "./uc_multi_hole_chain_bridge.mjs";
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
  for (const key of ["uc-root","donor-bundle","source-scene","stage-one-scene","stage-two-scene","evidence"]) {
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
  const stageOneScenePath = resolve(args["stage-one-scene"]);
  const stageTwoScenePath = resolve(args["stage-two-scene"]);
  const evidencePath = resolve(args.evidence);
  const outputs = [sourceScenePath,stageOneScenePath,stageTwoScenePath,evidencePath];
  if (new Set(outputs).size !== outputs.length) throw new Error("multi-hole chain outputs must be distinct");
  for (const path of outputs) if (pathIsInside(ucRoot,path)) throw new Error("multi-hole chain outputs may not be written inside the Universal Creation donor repository");
  if (pathIsInside(ucRoot,bundlePath)) throw new Error("donor bundle must remain outside the Universal Creation repository");

  const bundleBytes = await readFile(bundlePath);
  const result = buildUcMultiHoleChainSceneSet(bundleBytes, { albedo:[82,180,210] });
  await write(sourceScenePath,result.sourceSceneBytes);
  await write(stageOneScenePath,result.stageOneSceneBytes);
  await write(stageTwoScenePath,result.stageTwoSceneBytes);
  const evidence = {
    contract:"AXM_CREATIVE_UC_MULTI_HOLE_CHAIN_SCENE_EVIDENCE",version:1,
    observation:result.observation,
    inputs:{donor_bundle:{sha256:sha256(bundleBytes),bytes:bundleBytes.length}},
    outputs:{
      source_scene:{media_type:"application/x-axm-scene",sha256:sha256(result.sourceSceneBytes),bytes:result.sourceSceneBytes.length},
      stage_one_scene:{media_type:"application/x-axm-scene",sha256:sha256(result.stageOneSceneBytes),bytes:result.stageOneSceneBytes.length},
      stage_two_scene:{media_type:"application/x-axm-scene",sha256:sha256(result.stageTwoSceneBytes),bytes:result.stageTwoSceneBytes.length},
    },
  };
  const evidenceBytes=Buffer.from(`${JSON.stringify(evidence,null,2)}\n`,`utf8`);
  await write(evidencePath,evidenceBytes);
  console.log("uc_multi_hole_chain_bridge=PASS");
  console.log(`donor_revision=${result.observation.donor.donor_revision}`);
  console.log(`root_glb_sha256=${result.observation.donor.root_glb_sha256}`);
  console.log(`stage_one_glb_sha256=${result.observation.donor.stage_one_glb_sha256}`);
  console.log(`stage_two_glb_sha256=${result.observation.donor.stage_two_glb_sha256}`);
  console.log(`stage_one_lineage_sha256=${result.observation.donor.stage_one_lineage_sha256}`);
  console.log(`stage_two_lineage_sha256=${result.observation.donor.stage_two_lineage_sha256}`);
  console.log(`triangles=${result.observation.donor.root_triangles},${result.observation.donor.stage_one_triangles},${result.observation.donor.stage_two_triangles}`);
  console.log(`evidence_sha256=${sha256(evidenceBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode=1;
}
