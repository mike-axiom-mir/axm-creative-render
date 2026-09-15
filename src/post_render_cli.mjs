#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { applyUniversalCreationToRenderedPpm } from "./post_render_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function usage() {
  console.error("usage: node src/post_render_cli.mjs apply --uc-root PATH --input INPUT.ppm --output OUTPUT.ppm --receipt RECEIPT.json --render-request REQUEST.axmrender --render-receipt RECEIPT.axmreceipt");
}

function parseArgs(argv) {
  if (argv[0] !== "apply") throw new Error("only the 'apply' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "input", "output", "receipt", "render-request", "render-receipt"]) {
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
  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  const receiptPath = resolve(args.receipt);
  const renderRequestPath = resolve(args["render-request"]);
  const renderReceiptPath = resolve(args["render-receipt"]);

  const outputPaths = [outputPath, receiptPath];
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("post-render output and receipt paths must differ");
  if (outputPath === inputPath || receiptPath === inputPath) throw new Error("post-render proof refuses to overwrite the renderer output");
  for (const path of outputPaths) if (pathIsInside(ucRoot, path)) throw new Error("post-render proof outputs may not be written inside the Universal Creation donor repository");

  const [inputPpm, renderRequestBytes, renderReceiptBytes] = await Promise.all([
    readFile(inputPath),
    readFile(renderRequestPath),
    readFile(renderReceiptPath),
  ]);
  const result = await applyUniversalCreationToRenderedPpm(ucRoot, inputPpm);
  await write(outputPath, result.outputPpm);

  const receipt = {
    contract: "AXM_CREATIVE_POST_RENDER_RECEIPT",
    version: 1,
    mode: "render-fabric-output-to-universal-creation-creative-flow",
    upstream: {
      verification: "external-required",
      render_request_sha256: sha256(renderRequestBytes),
      render_receipt_sha256: sha256(renderReceiptBytes),
      renderer_output_sha256: sha256(inputPpm),
    },
    universal_creation: result.observation,
    output: {
      media_type: "image/x-portable-pixmap; format=P6-rgb8",
      sha256: sha256(result.outputPpm),
      bytes: result.outputPpm.length,
    },
    truth_boundary: {
      proves: [
        "a Render Fabric PPM can become explicit axm.precision-raster/v1 working state",
        "real Universal Creation creative.adjust.tint and creative.adjust.contrast Hands can execute through Creative Flow over that frame",
        "the same explicit input and Creative Flow repeat to identical styled PPM bytes in the exercised environment",
      ],
      does_not_prove: [
        "in-render-pass execution",
        "GPU shader integration",
        "visual or artistic quality",
        "alpha preservation through PPM",
        "cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("post_render_creative_flow=PASS");
  console.log(`hand_count=${receipt.universal_creation.hand_count}`);
  console.log(`recipe_count=${receipt.universal_creation.recipe_count}`);
  console.log(`operations=${receipt.universal_creation.operation_ids.join(",")}`);
  console.log(`input_ppm_sha256=${receipt.upstream.renderer_output_sha256}`);
  console.log(`output_ppm_sha256=${receipt.output.sha256}`);
  console.log(`repeat_verification=${receipt.universal_creation.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
