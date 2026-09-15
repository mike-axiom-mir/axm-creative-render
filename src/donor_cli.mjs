#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { observeUniversalCreation, observeVisualEffectFabric } from "./donor_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

function usage() {
  console.error(
    "usage: node src/donor_cli.mjs snapshot --uc-root PATH --vfx-root PATH --receipt PATH --uc-scene PATH --vfx-state PATH --vfx-html PATH",
  );
}

function parseArgs(argv) {
  if (argv[0] !== "snapshot") throw new Error("only the 'snapshot' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "vfx-root", "receipt", "uc-scene", "vfx-state", "vfx-html"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

function pathInside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
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
    receipt: resolve(args.receipt),
    ucScene: resolve(args["uc-scene"]),
    vfxState: resolve(args["vfx-state"]),
    vfxHtml: resolve(args["vfx-html"]),
  };

  const outputPaths = Object.values(outputs);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("all output paths must be distinct");
  for (const outputPath of outputPaths) {
    if (pathInside(outputPath, ucRoot) || pathInside(outputPath, vfxRoot)) {
      throw new Error("donor snapshot outputs may not be written inside donor repositories");
    }
  }

  const [uc, vfx] = await Promise.all([
    observeUniversalCreation(ucRoot),
    observeVisualEffectFabric(vfxRoot),
  ]);

  await write(outputs.ucScene, uc.sceneBytes);
  await write(outputs.vfxState, vfx.stateBytes);
  await write(outputs.vfxHtml, vfx.htmlBytes);

  const receipt = {
    contract: "AXM_CREATIVE_DONOR_RECEIPT",
    version: 1,
    mode: "explicit-local-donor-observation",
    universal_creation: uc.observation,
    visual_effect_fabric: vfx.observation,
    outputs: {
      uc_scene: {
        contract: "AXM_SCENE 1",
        sha256: sha256(uc.sceneBytes),
      },
      vfx_state: {
        media_type: "application/json",
        sha256: sha256(vfx.stateBytes),
      },
      vfx_html: {
        media_type: "text/html",
        sha256: sha256(vfx.htmlBytes),
      },
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("donor_snapshot=PASS");
  console.log(`uc_creative_hands=${receipt.universal_creation.hand_count}`);
  console.log(`uc_creative_recipes=${receipt.universal_creation.recipe_count}`);
  console.log(`uc_scene_sha256=${receipt.outputs.uc_scene.sha256}`);
  console.log(`vfx_graph=${receipt.visual_effect_fabric.graph_id}`);
  console.log(`vfx_renderer=${receipt.visual_effect_fabric.renderer}`);
  console.log(`vfx_point_count=${receipt.visual_effect_fabric.point_count}`);
  console.log(`vfx_modeled_buffer_bytes=${receipt.visual_effect_fabric.modeled_buffer_bytes}`);
  console.log(`vfx_html_sha256=${receipt.outputs.vfx_html.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
