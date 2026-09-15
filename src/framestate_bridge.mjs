import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { parsePpmRgb8 } from "./post_render_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";

function portableRelative(fromRoot, target) {
  const rel = relative(resolve(fromRoot), resolve(target));
  if (!rel || rel.startsWith("..") || resolve(fromRoot, rel) !== resolve(target)) {
    throw new Error("FrameState media path must resolve inside the declared machine root");
  }
  return rel.split(sep).join("/");
}

function boundedInt(value, label, lo, hi) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new Error(`${label} must be an integer in ${lo}..${hi}`);
  return n;
}

export async function buildFrameStateProject({
  framePaths,
  machineRoot,
  fps = 12,
  holdFrames = 4,
  projectId = "axm-creative-render-sequence",
}) {
  if (!Array.isArray(framePaths) || framePaths.length < 2 || framePaths.length > 32) {
    throw new Error("FrameState bridge requires 2..32 source frames");
  }
  fps = boundedInt(fps, "fps", 1, 120);
  holdFrames = boundedInt(holdFrames, "holdFrames", 1, 240);
  if (typeof projectId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(projectId)) {
    throw new Error("projectId must be a portable token");
  }

  const root = resolve(machineRoot);
  const rows = [];
  let width = null;
  let height = null;
  for (let index = 0; index < framePaths.length; index += 1) {
    const path = resolve(framePaths[index]);
    const bytes = await readFile(path);
    const ppm = parsePpmRgb8(bytes);
    if (width === null) {
      width = ppm.width;
      height = ppm.height;
    } else if (ppm.width !== width || ppm.height !== height) {
      throw new Error(`source frame ${index} dimensions do not match the first frame`);
    }
    rows.push({
      index,
      declared_path: portableRelative(root, path),
      sha256: sha256(bytes),
      bytes: bytes.length,
      width: ppm.width,
      height: ppm.height,
    });
  }

  if (width > 4096 || height > 4096 || width * height > 4_194_304) {
    throw new Error("FrameState bridge source frames exceed bounded image dimensions");
  }

  const durationFrames = rows.length * holdFrames;
  const media = rows.map((row) => ({
    id: `source-${String(row.index).padStart(3, "0")}`,
    kind: "image",
    path: row.declared_path,
  }));
  const layers = rows.map((row) => ({
    id: `source-layer-${String(row.index).padStart(3, "0")}`,
    kind: "image",
    z: 1,
    start_frame: row.index * holdFrames,
    end_frame: (row.index + 1) * holdFrames,
    media_id: `source-${String(row.index).padStart(3, "0")}`,
    x: Math.floor(width / 2),
    y: Math.floor(height / 2),
    w: width,
    h: height,
  }));

  const project = {
    schema: "axm.framestate.project/v0.5",
    id: projectId,
    title: "AXM Creative Render -> FrameState sequence",
    canvas: { width, height, fps },
    duration_frames: durationFrames,
    background: [0, 0, 0],
    camera: { x: 0, y: 0, zoom_milli: 1000 },
    media,
    layers,
    captions: [],
    audio: [],
    effects: [],
    markers: [{ frame: 0, label: "creative-render-bridge", kind: "scene" }],
    metadata: {
      source: "axm-creative-render",
      bridge: "framestate-video-v0.6",
      source_frame_count: rows.length,
      source_frame_sha256: rows.map((row) => row.sha256),
      frame_hold: holdFrames,
    },
  };

  const projectBytes = Buffer.from(`${JSON.stringify(project, null, 2)}\n`, "utf8");
  const receipt = {
    contract: "AXM_CREATIVE_FRAMESTATE_PROJECT_RECEIPT",
    version: 1,
    mode: "verified-ppm-sequence-to-framestate-project",
    project_schema: project.schema,
    project_sha256: sha256(projectBytes),
    machine_root_policy: "all media paths are relative and confined to caller-declared machine root",
    source_frames: rows,
    frame_count: rows.length,
    width,
    height,
    fps,
    hold_frames_per_source: holdFrames,
    duration_frames: durationFrames,
    duration_seconds: durationFrames / fps,
    truth_boundary: {
      proves: [
        "input frames are bounded P6 RGB8 PPM with equal dimensions",
        "the generated FrameState project references the exact input frame bytes by SHA-256",
        "each input frame receives one explicit non-overlapping hold interval",
      ],
      does_not_prove: [
        "FrameState rendered or assembled this project",
        "video encoding success",
        "motion interpolation between source samples",
        "visual quality",
      ],
    },
  };
  return { project, projectBytes, receipt };
}
