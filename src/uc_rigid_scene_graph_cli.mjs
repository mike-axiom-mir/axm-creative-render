#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildUcRigidSceneGraphScenePair } from "./uc_rigid_scene_graph_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

function args(argv) {
  const out = { command: argv[2] };
  for (let index = 3; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${String(key)}`);
    out[key.slice(2)] = value;
  }
  return out;
}

async function ensureParent(path) {
  await mkdir(dirname(resolve(path)), { recursive: true });
}

async function main() {
  const input = args(process.argv);
  if (input.command !== "build") {
    throw new Error("usage: node src/uc_rigid_scene_graph_cli.mjs build --bundle donor.json --source-glb source.glb --rebound-glb rebound.glb --source-scene source.axmscene --rebound-scene rebound.axmscene --receipt receipt.json");
  }
  for (const key of ["bundle", "source-glb", "rebound-glb", "source-scene", "rebound-scene", "receipt"]) {
    if (!input[key]) throw new Error(`missing --${key}`);
  }
  const [bundleBytes, sourceGlbBytes, reboundGlbBytes] = await Promise.all([
    readFile(input.bundle),
    readFile(input["source-glb"]),
    readFile(input["rebound-glb"]),
  ]);
  const built = buildUcRigidSceneGraphScenePair(bundleBytes, sourceGlbBytes, reboundGlbBytes);
  await Promise.all([ensureParent(input["source-scene"]), ensureParent(input["rebound-scene"]), ensureParent(input.receipt)]);
  await writeFile(input["source-scene"], built.sourceSceneBytes);
  await writeFile(input["rebound-scene"], built.reboundSceneBytes);
  const receipt = {
    contract: "AXM_CREATIVE_UC_RIGID_SCENE_GRAPH_RECEIPT",
    version: 1,
    bridge: built.observation,
    inputs: {
      donor_bundle: { path: input.bundle, sha256: sha256(bundleBytes) },
      source_glb: { path: input["source-glb"], sha256: sha256(sourceGlbBytes) },
      rebound_glb: { path: input["rebound-glb"], sha256: sha256(reboundGlbBytes) },
    },
    outputs: {
      source_scene: { path: input["source-scene"], sha256: sha256(built.sourceSceneBytes), triangles: built.observation.source_scene.output_triangle_count },
      rebound_scene: { path: input["rebound-scene"], sha256: sha256(built.reboundSceneBytes), triangles: built.observation.rebound_scene.output_triangle_count },
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(input.receipt, receiptBytes);
  console.log("uc_rigid_scene_graph_native=PASS");
  console.log(`donor_revision=${built.observation.donor.donor_revision}`);
  console.log(`binary_chunk_sha256=${built.observation.donor.binary_chunk_sha256}`);
  console.log(`source_graph_digest=${built.observation.source_scene.graph_digest}`);
  console.log(`rebound_graph_digest=${built.observation.rebound_scene.graph_digest}`);
  console.log(`triangles=${built.observation.source_scene.output_triangle_count}`);
  console.log(`source_scene_sha256=${receipt.outputs.source_scene.sha256}`);
  console.log(`rebound_scene_sha256=${receipt.outputs.rebound_scene.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
}

main().catch((error) => {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
});
