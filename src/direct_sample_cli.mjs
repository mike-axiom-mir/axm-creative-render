#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeUniversalCreation } from "./donor_bridge.mjs";
import { axmSceneToHolographicSampleField, observeVisualEffectDirectSamples } from "./direct_sample_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function parseArgs(argv) {
  if (argv[0] !== "build") throw new Error("only the 'build' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "vfx-root", "scene", "state", "html", "receipt"]) {
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
  const vfxRoot = resolve(args["vfx-root"]);
  const outputs = {
    scene: resolve(args.scene),
    state: resolve(args.state),
    html: resolve(args.html),
    receipt: resolve(args.receipt),
  };
  const outputPaths = Object.values(outputs);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("direct-sample output paths must be distinct");
  for (const output of outputPaths) {
    if (pathIsInside(ucRoot, output) || pathIsInside(vfxRoot, output)) {
      throw new Error("direct-sample bridge outputs may not be written inside donor repositories");
    }
  }

  const uc = await observeUniversalCreation(ucRoot);
  const firstAdapter = axmSceneToHolographicSampleField(uc.sceneBytes, {
    id: "creative-render-axm-scene-direct-sample",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  const secondAdapter = axmSceneToHolographicSampleField(uc.sceneBytes, {
    id: "creative-render-axm-scene-direct-sample",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  if (
    JSON.stringify(firstAdapter.field) !== JSON.stringify(secondAdapter.field) ||
    JSON.stringify(firstAdapter.observation) !== JSON.stringify(secondAdapter.observation)
  ) {
    throw new Error("direct-sample adapter repeat verification failed");
  }

  const vfx = await observeVisualEffectDirectSamples(vfxRoot, firstAdapter.field);
  const sceneSha256 = sha256(uc.sceneBytes);
  if (firstAdapter.observation.source_scene_sha256 !== sceneSha256) {
    throw new Error("direct-sample adapter source digest does not match UC scene bytes");
  }
  if (vfx.observation.source_digest !== sceneSha256 || vfx.observation.source_kind !== "AXM_SCENE 1") {
    throw new Error("VFX direct-sample state lost AXM scene source identity");
  }

  await write(outputs.scene, uc.sceneBytes);
  await write(outputs.state, vfx.stateBytes);
  await write(outputs.html, vfx.htmlBytes);

  const receipt = {
    contract: "AXM_CREATIVE_DIRECT_SAMPLE_RECEIPT",
    version: 1,
    mode: "universal-creation-scene-to-vfx-direct-sample-projector",
    repeat_verification: "PASS",
    universal_creation: uc.observation,
    adapter: firstAdapter.observation,
    visual_effect_fabric: vfx.observation,
    outputs: {
      scene: { contract: "AXM_SCENE 1", sha256: sceneSha256, bytes: uc.sceneBytes.length },
      vfx_state: { media_type: "application/json", sha256: sha256(vfx.stateBytes), bytes: vfx.stateBytes.length },
      vfx_html: { media_type: "text/html", sha256: sha256(vfx.htmlBytes), bytes: vfx.htmlBytes.length },
    },
    truth_boundary: {
      proves: [
        "one UC-created renderer-consumable AXM_SCENE 1 state can be deterministically materialized into a bounded packed 3D sample field",
        "the current Visual Effect Fabric direct-sample graph accepts that field while retaining the exact AXM scene SHA-256 as source identity",
        "the same bounded adapter and VFX execution repeat under the same pinned donors and inputs",
      ],
      does_not_prove: [
        "that VFX sample state is canonical scene truth",
        "albedo/material/normal/UV preservation in the holographic sample field",
        "surface reconstruction or physical holography",
        "visual quality",
        "automatic arbitrary-world conversion",
        "cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("direct_sample_bridge=PASS");
  console.log(`uc_hands=${receipt.universal_creation.hand_count}`);
  console.log(`uc_recipes=${receipt.universal_creation.recipe_count}`);
  console.log(`scene_sha256=${receipt.outputs.scene.sha256}`);
  console.log(`projected_triangles=${receipt.adapter.projected_triangle_count}`);
  console.log(`sample_points=${receipt.adapter.point_count}`);
  console.log(`vfx_graph=${receipt.visual_effect_fabric.graph_id}`);
  console.log(`vfx_renderer=${receipt.visual_effect_fabric.renderer}`);
  console.log(`source_identity_retained=${receipt.visual_effect_fabric.source_identity_retained}`);
  console.log(`vfx_html_sha256=${receipt.outputs.vfx_html.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
