#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeUniversalCreation } from "./donor_bridge.mjs";
import { axmSceneToHolographicSampleField } from "./direct_sample_bridge.mjs";
import { observeVisualEffectDirectSampleShell } from "./direct_sample_shell_bridge.mjs";
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
  for (const key of ["uc-root", "vfx-root", "scene", "state", "html", "receipt"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const ucRoot = resolve(args["uc-root"]), vfxRoot = resolve(args["vfx-root"]);
  const outputs = { scene: resolve(args.scene), state: resolve(args.state), html: resolve(args.html), receipt: resolve(args.receipt) };
  const paths = Object.values(outputs);
  if (new Set(paths).size !== paths.length) throw new Error("direct-sample shell output paths must be distinct");
  for (const path of paths) if (pathIsInside(ucRoot, path) || pathIsInside(vfxRoot, path)) throw new Error("direct-sample shell outputs may not be written inside donor repositories");

  const uc = await observeUniversalCreation(ucRoot);
  const adapted = axmSceneToHolographicSampleField(uc.sceneBytes, {
    id: "creative-render-direct-sample-shell",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  const shell = await observeVisualEffectDirectSampleShell(vfxRoot, adapted.field);
  const sceneSha = sha256(uc.sceneBytes);
  if (adapted.observation.source_scene_sha256 !== sceneSha || shell.observation.source_digest !== sceneSha) throw new Error("direct-sample shell source identity mismatch");

  await write(outputs.scene, uc.sceneBytes);
  await write(outputs.state, shell.stateBytes);
  await write(outputs.html, shell.htmlBytes);

  const receipt = {
    contract: "AXM_CREATIVE_DIRECT_SAMPLE_SHELL_RECEIPT",
    version: 1,
    mode: "uc-scene-to-caller-composed-vfx-shell",
    universal_creation: uc.observation,
    adapter: adapted.observation,
    visual_effect_fabric: shell.observation,
    outputs: {
      scene: { contract: "AXM_SCENE 1", sha256: sceneSha, bytes: uc.sceneBytes.length },
      shell_state: { media_type: "application/json", sha256: sha256(shell.stateBytes), bytes: shell.stateBytes.length },
      shell_html: { media_type: "text/html", sha256: sha256(shell.htmlBytes), bytes: shell.htmlBytes.length },
    },
    truth_boundary: {
      proves: [
        "the same AXM scene identity can be admitted as bounded direct sample state and then passed through real VFX visibility/shell Hands",
        "the VFX shell renderer receives the exact AXM scene SHA-256 as canonical source identity",
        "the caller composition repeats to the same VFX final-state and output bytes in the exercised pinned environment",
      ],
      does_not_prove: [
        "that this caller-composed Hand graph is a canonical VFX graph",
        "physical holography or continuous surface reconstruction",
        "material/albedo preservation in shell state",
        "visual quality or cinematic quality",
        "whole-world conversion",
        "cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("direct_sample_shell=PASS");
  console.log(`scene_sha256=${sceneSha}`);
  console.log(`sample_points=${receipt.adapter.point_count}`);
  console.log(`graph_owner=${receipt.visual_effect_fabric.graph_owner}`);
  console.log(`renderer=${receipt.visual_effect_fabric.renderer}`);
  console.log(`visual_primary=${receipt.visual_effect_fabric.visual_language.primary}`);
  console.log(`bright_sweep=${receipt.visual_effect_fabric.visual_language.brightSweep}`);
  console.log(`shell_html_sha256=${receipt.outputs.shell_html.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
