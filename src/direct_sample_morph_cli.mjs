#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { axmSceneToHolographicSampleField } from "./direct_sample_bridge.mjs";
import { observeVisualEffectStateMorph } from "./direct_sample_morph_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function usage() {
  console.error("usage: node src/direct_sample_morph_cli.mjs build --vfx-root PATH --source-scene PATH --target-scene PATH --state PATH --html PATH --receipt PATH");
}

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
  for (const key of ["vfx-root", "source-scene", "target-scene", "state", "html", "receipt"]) {
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
  const vfxRoot = resolve(args["vfx-root"]);
  const sourceScenePath = resolve(args["source-scene"]);
  const targetScenePath = resolve(args["target-scene"]);
  const outputs = {
    state: resolve(args.state),
    html: resolve(args.html),
    receipt: resolve(args.receipt),
  };
  if (sourceScenePath === targetScenePath) throw new Error("state morph requires two distinct scene files");
  if (new Set(Object.values(outputs)).size !== Object.values(outputs).length) {
    throw new Error("state-morph output paths must be distinct");
  }
  for (const path of Object.values(outputs)) {
    if (pathIsInside(vfxRoot, path)) throw new Error("state-morph outputs may not be written inside the VFX donor repository");
  }

  const [sourceSceneBytes, targetSceneBytes] = await Promise.all([
    readFile(sourceScenePath),
    readFile(targetScenePath),
  ]);
  const sourceSceneSha256 = sha256(sourceSceneBytes);
  const targetSceneSha256 = sha256(targetSceneBytes);
  if (sourceSceneSha256 === targetSceneSha256) {
    throw new Error("state morph requires two scenes with different byte identities");
  }

  const source = axmSceneToHolographicSampleField(sourceSceneBytes, {
    id: "creative-render-morph-source",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  const target = axmSceneToHolographicSampleField(targetSceneBytes, {
    id: "creative-render-morph-target",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  const morph = await observeVisualEffectStateMorph(vfxRoot, source.field, target.field);

  if (source.observation.source_scene_sha256 !== sourceSceneSha256) throw new Error("source adapter digest drifted");
  if (target.observation.source_scene_sha256 !== targetSceneSha256) throw new Error("target adapter digest drifted");
  if (morph.observation.source.digest !== sourceSceneSha256 || morph.observation.target.digest !== targetSceneSha256) {
    throw new Error("VFX morph did not retain both AXM scene identities");
  }

  await write(outputs.state, morph.stateBytes);
  await write(outputs.html, morph.htmlBytes);

  const receipt = {
    contract: "AXM_CREATIVE_DIRECT_SAMPLE_MORPH_RECEIPT",
    version: 1,
    mode: "two-axm-scenes-to-vfx-state-morph",
    source: {
      scene: { path: sourceScenePath, sha256: sourceSceneSha256, bytes: sourceSceneBytes.length },
      adapter: source.observation,
    },
    target: {
      scene: { path: targetScenePath, sha256: targetSceneSha256, bytes: targetSceneBytes.length },
      adapter: target.observation,
    },
    visual_effect_fabric: morph.observation,
    outputs: {
      morph_state: { media_type: "application/json", sha256: sha256(morph.stateBytes), bytes: morph.stateBytes.length },
      morph_html: { media_type: "text/html", sha256: sha256(morph.htmlBytes), bytes: morph.htmlBytes.length },
    },
    authority: {
      source_scene: "AXM_SCENE_1_CALLER_STATE",
      target_scene: "AXM_SCENE_1_CALLER_STATE",
      source_sample_field: "DERIVED_REBUILDABLE_PROJECTION_STATE",
      target_sample_field: "DERIVED_REBUILDABLE_PROJECTION_STATE",
      morph_field: "DERIVED_VFX_WORKING_STATE",
      morph_html: "DERIVED_VFX_REALIZATION",
    },
    truth_boundary: {
      proves: [
        "two distinct AXM scene byte identities can be adapted into bounded sample fields and retained through the real pinned VFX state-morph Hands",
        "the exercised morph repeats to the same final state and HTML bytes in the pinned environment",
        "the morph output records the donor's deterministic spatial pairing policy",
      ],
      does_not_prove: [
        "semantic vertex or object correspondence between the two scenes",
        "topology-aware deformation or skeletal interpolation",
        "continuous physical surface reconstruction",
        "material, albedo, normal, UV, skin or animation-clip preservation in morph state",
        "visual or cinematic quality",
        "cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("direct_sample_morph=PASS");
  console.log(`source_scene_sha256=${sourceSceneSha256}`);
  console.log(`target_scene_sha256=${targetSceneSha256}`);
  console.log(`source_points=${source.observation.point_count}`);
  console.log(`target_points=${target.observation.point_count}`);
  console.log(`morph_points=${morph.observation.morph.point_count}`);
  console.log(`pairing=${morph.observation.morph.pairing}`);
  console.log(`renderer=${morph.observation.renderer}`);
  console.log(`morph_html_sha256=${receipt.outputs.morph_html.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
