#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { observeVisualEffectBranchGrowthNative } from "./vfx_branch_growth_native_bridge.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { out._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a._[0] !== "build") throw new Error("expected build command");
  const required = [
    "vfx-root", "vfx-revision",
    "symmetric-source", "asymmetric-source",
    "symmetric-network", "asymmetric-network",
    "symmetric-svg", "asymmetric-svg",
    "symmetric-state", "asymmetric-state",
    "symmetric-scene", "asymmetric-scene",
    "receipt",
  ];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectBranchGrowthNative(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a["symmetric-source"], result.symmetricSourceBytes],
    [a["asymmetric-source"], result.asymmetricSourceBytes],
    [a["symmetric-network"], result.symmetricNetworkBytes],
    [a["asymmetric-network"], result.asymmetricNetworkBytes],
    [a["symmetric-svg"], result.symmetricSvgBytes],
    [a["asymmetric-svg"], result.asymmetricSvgBytes],
    [a["symmetric-state"], result.symmetricStateBytes],
    [a["asymmetric-state"], result.asymmetricStateBytes],
    [a["symmetric-scene"], result.symmetricSceneBytes],
    [a["asymmetric-scene"], result.asymmetricSceneBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];

  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_branch_growth_native=PASS");
  for (const [name, row] of Object.entries(result.receipt.variants)) {
    console.log(`${name}_source_hash=${row.source.hash}`);
    console.log(`${name}_network_hash=${row.network.hash}`);
    console.log(`${name}_segments=${row.network.segment_count}`);
    console.log(`${name}_svg_sha256=${row.donor_svg.bytes_sha256}`);
    console.log(`${name}_scene_sha256=${row.native_scene.bytes_sha256}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
