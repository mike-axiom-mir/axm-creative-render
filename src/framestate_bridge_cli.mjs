#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildFrameStateProject } from "./framestate_bridge.mjs";
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
  for (const key of ["frames", "machine-root", "project", "receipt"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function write(path, bytes) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: "w" }); }

try {
  const args = parseArgs(process.argv.slice(2));
  const machineRoot = resolve(args["machine-root"]);
  const projectPath = resolve(args.project);
  const receiptPath = resolve(args.receipt);
  const framePaths = String(args.frames).split(",").map((value) => resolve(value.trim())).filter(Boolean);
  if (projectPath === receiptPath) throw new Error("project and receipt paths must differ");
  for (const frame of framePaths) if (frame === projectPath || frame === receiptPath) throw new Error("FrameState bridge refuses to overwrite source frames");
  if (!pathIsInside(machineRoot, projectPath) || !pathIsInside(machineRoot, receiptPath)) throw new Error("project and receipt outputs must remain inside the declared machine root");

  const built = await buildFrameStateProject({
    framePaths,
    machineRoot,
    fps: args.fps == null ? 12 : Number(args.fps),
    holdFrames: args["hold-frames"] == null ? 4 : Number(args["hold-frames"]),
    projectId: args["project-id"] ?? "axm-creative-render-sequence",
  });
  await write(projectPath, built.projectBytes);
  const receiptBytes = Buffer.from(`${JSON.stringify(built.receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("framestate_project_bridge=PASS");
  console.log(`frame_count=${built.receipt.frame_count}`);
  console.log(`canvas=${built.receipt.width}x${built.receipt.height}`);
  console.log(`fps=${built.receipt.fps}`);
  console.log(`duration_frames=${built.receipt.duration_frames}`);
  console.log(`duration_seconds=${built.receipt.duration_seconds}`);
  console.log(`project_sha256=${built.receipt.project_sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
