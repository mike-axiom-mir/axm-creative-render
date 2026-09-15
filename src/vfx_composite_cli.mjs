#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { compositeElectricRasterWithUniversalCreation } from "./vfx_frame_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

function parseArgs(argv) {
  if (argv[0] !== "composite") throw new Error("only the 'composite' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "base", "effect", "output", "receipt", "render-request", "render-receipt", "vfx-receipt", "vfx-svg", "vfx-raster-receipt"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

function inside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !resolve(rel).startsWith("/"));
}
async function write(path, bytes) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: "w" }); }

try {
  const args = parseArgs(process.argv.slice(2));
  const ucRoot = resolve(args["uc-root"]);
  const outputPath = resolve(args.output);
  const receiptPath = resolve(args.receipt);
  const basePath = resolve(args.base);
  if (outputPath === basePath || receiptPath === basePath || outputPath === receiptPath) throw new Error("VFX composite refuses to overwrite the source frame or collide output paths");
  if (inside(outputPath, ucRoot) || inside(receiptPath, ucRoot)) throw new Error("VFX composite outputs may not be written inside the Universal Creation donor repository");

  const [baseBytes, effectBytes, renderRequest, renderReceipt, vfxReceiptBytes, vfxSvg, vfxRasterReceiptBytes] = await Promise.all([
    readFile(basePath),
    readFile(resolve(args.effect)),
    readFile(resolve(args["render-request"])),
    readFile(resolve(args["render-receipt"])),
    readFile(resolve(args["vfx-receipt"])),
    readFile(resolve(args["vfx-svg"])),
    readFile(resolve(args["vfx-raster-receipt"])),
  ]);
  const vfxReceipt = JSON.parse(vfxReceiptBytes.toString("utf8"));
  if (vfxReceipt.contract !== "AXM_CREATIVE_VFX_SOURCE_RECEIPT" || vfxReceipt.version !== 1) throw new Error("unsupported VFX source receipt");
  if (vfxReceipt.outputs?.svg?.sha256 !== sha256(vfxSvg)) throw new Error("VFX SVG bytes do not match their source receipt");

  const vfxRasterReceipt = JSON.parse(vfxRasterReceiptBytes.toString("utf8"));
  if (vfxRasterReceipt.contract !== "AXM_CREATIVE_VFX_RASTER_RECEIPT" || vfxRasterReceipt.version !== 1) {
    throw new Error("unsupported VFX raster receipt");
  }
  if (vfxRasterReceipt.source?.vfx_source_receipt_sha256 !== sha256(vfxReceiptBytes)) {
    throw new Error("VFX raster receipt is not bound to the supplied VFX source receipt");
  }
  if (vfxRasterReceipt.output?.sha256 !== sha256(effectBytes)) {
    throw new Error("effect PPM bytes do not match their VFX raster receipt");
  }

  const result = await compositeElectricRasterWithUniversalCreation(ucRoot, baseBytes, effectBytes);
  await write(outputPath, result.outputPpm);
  const receipt = {
    contract: "AXM_CREATIVE_VFX_COMPOSITE_RECEIPT",
    version: 1,
    mode: "vfx-state-raster-to-universal-creation-screen-composite",
    upstream_render: {
      verification: "external-required",
      request_sha256: sha256(renderRequest),
      receipt_sha256: sha256(renderReceipt),
      frame_sha256: sha256(baseBytes),
    },
    vfx_source: {
      receipt_sha256: sha256(vfxReceiptBytes),
      graph_id: vfxReceipt.visual_effect_fabric?.graph_id ?? null,
      final_state_hash: vfxReceipt.visual_effect_fabric?.final_state_hash ?? null,
      svg_sha256: sha256(vfxSvg),
      raster_receipt_sha256: sha256(vfxRasterReceiptBytes),
      raster_adapter_schema: vfxRasterReceipt.adapter?.schema ?? null,
      effect_raster_sha256: sha256(effectBytes),
    },
    universal_creation: result.observation,
    output: { media_type: "image/x-portable-pixmap; format=P6-rgb8", sha256: sha256(result.outputPpm), bytes: result.outputPpm.length },
    truth_boundary: {
      proves: [
        "a deterministic Visual Effect Fabric Hand graph produced canonical electric-effect state and an SVG realization",
        "a bounded Creative Render adapter materialized canonical electric path state into a PPM effect frame with repeat evidence",
        "Universal Creation creative.composite.screen and creative.adjust.contrast Hands composited that effect raster over a verified Render Fabric frame",
        "the same bounded composite flow repeats to identical output bytes in the exercised environment",
      ],
      does_not_prove: [
        "native Render Fabric VFX pass integration",
        "complete realization of all Visual Effect Fabric layer-module semantics",
        "physical lighting interaction between the effect and scene",
        "visual or artistic quality",
        "alpha-preserving effect compositing through the PPM proof path",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);
  console.log("vfx_frame_composite=PASS");
  console.log(`vfx_graph=${receipt.vfx_source.graph_id}`);
  console.log(`raster_adapter=${receipt.vfx_source.raster_adapter_schema}`);
  console.log(`operations=${receipt.universal_creation.operation_ids.join(",")}`);
  console.log(`base_ppm_sha256=${receipt.upstream_render.frame_sha256}`);
  console.log(`effect_ppm_sha256=${receipt.vfx_source.effect_raster_sha256}`);
  console.log(`output_ppm_sha256=${receipt.output.sha256}`);
  console.log(`repeat_verification=${receipt.universal_creation.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
