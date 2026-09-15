#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { executeCreativeOperation } from "./creative_scene_operator.mjs";

function usage() {
  console.error("usage: node src/cli.mjs apply --scene PATH --operator PATH --out PATH --receipt PATH");
}

function parseArgs(argv) {
  if (argv[0] !== "apply") throw new Error("only the 'apply' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --key value pairs");
    }
    values[key.slice(2)] = value;
  }
  for (const key of ["scene", "operator", "out", "receipt"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const scenePath = resolve(args.scene);
  const operatorPath = resolve(args.operator);
  const outPath = resolve(args.out);
  const receiptPath = resolve(args.receipt);

  if (outPath === scenePath || outPath === operatorPath || receiptPath === scenePath || receiptPath === operatorPath) {
    throw new Error("v0.1 refuses to overwrite source scene/operator files");
  }
  if (outPath === receiptPath) throw new Error("output and receipt paths must differ");

  const [sceneBytes, operatorBytes] = await Promise.all([readFile(scenePath), readFile(operatorPath)]);
  const { outputBytes, receipt } = executeCreativeOperation(sceneBytes, operatorBytes);

  await mkdir(dirname(outPath), { recursive: true });
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(outPath, outputBytes, { flag: "w" });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "w" });

  console.log(`operator=${receipt.operator_id}`);
  console.log(`kind=${receipt.operator_kind}`);
  console.log(`input_sha256=${receipt.input_sha256}`);
  console.log(`operator_sha256=${receipt.operator_sha256}`);
  console.log(`output_sha256=${receipt.output_sha256}`);
  console.log(`triangle_count=${receipt.triangle_count}`);
} catch (error) {
  usage();
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
