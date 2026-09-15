import { createHash } from "node:crypto";

const SCENE_HEADER = "AXM_SCENE 1";
const OPERATOR_CONTRACT = "AXM_CREATIVE_OPERATOR";
const OPERATOR_VERSION = 1;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function finiteNumber(token, label) {
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function rgbByte(token, label) {
  if (!/^-?\d+$/.test(token)) throw new Error(`${label} must be an integer`);
  const value = Number(token);
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be in 0..255`);
  }
  return value;
}

export function parseScene(text) {
  const meaningful = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (meaningful[0] !== SCENE_HEADER) {
    throw new Error(`unsupported scene header; expected "${SCENE_HEADER}"`);
  }

  const triangles = meaningful.slice(1).map((line, index) => {
    const tokens = line.split(/\s+/);
    if (tokens[0] !== "triangle" || tokens.length !== 13) {
      throw new Error(`scene line ${index + 2}: expected triangle + 12 values`);
    }
    const coords = tokens.slice(1, 10).map((t, i) => finiteNumber(t, `coord[${i}]`));
    const rgb = tokens.slice(10, 13).map((t, i) => rgbByte(t, `rgb[${i}]`));
    return {
      vertices: [coords.slice(0, 3), coords.slice(3, 6), coords.slice(6, 9)],
      albedo: rgb,
    };
  });

  return { version: 1, triangles };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) throw new Error("cannot serialize non-finite coordinate");
  if (Object.is(value, -0)) value = 0;
  const fixed = value.toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
}

export function serializeScene(scene) {
  if (scene.version !== 1) throw new Error("only scene version 1 can be serialized");
  const lines = ["# AXM Creative Render canonical scene output.", SCENE_HEADER];
  for (const triangle of scene.triangles) {
    const coords = triangle.vertices.flat().map(formatNumber);
    const rgb = triangle.albedo.map((v) => String(rgbByte(String(v), "albedo")));
    lines.push(`triangle ${[...coords, ...rgb].join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseOperator(text) {
  let op;
  try {
    op = JSON.parse(text);
  } catch (error) {
    throw new Error(`operator must be valid JSON: ${error.message}`);
  }
  if (op.contract !== OPERATOR_CONTRACT || op.version !== OPERATOR_VERSION) {
    throw new Error(`unsupported operator contract; expected ${OPERATOR_CONTRACT} ${OPERATOR_VERSION}`);
  }
  if (typeof op.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(op.id)) {
    throw new Error("operator id must be a non-empty token");
  }
  if (op.domain !== "scene") throw new Error("v0.1 supports only domain=scene");
  if (!["tint", "translate"].includes(op.kind)) {
    throw new Error(`unsupported operator kind: ${String(op.kind)}`);
  }
  if (op.parameters === null || typeof op.parameters !== "object" || Array.isArray(op.parameters)) {
    throw new Error("operator parameters must be an object");
  }
  return op;
}

function scaleChannel(value, scale) {
  const next = Math.round(value * scale);
  return Math.max(0, Math.min(255, next));
}

export function applyOperator(scene, op) {
  const result = structuredClone(scene);

  if (op.kind === "tint") {
    const scales = ["r_scale", "g_scale", "b_scale"].map((name) => {
      const raw = op.parameters[name] ?? 1;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 16) {
        throw new Error(`${name} must be finite and in 0..16`);
      }
      return value;
    });
    for (const triangle of result.triangles) {
      triangle.albedo = triangle.albedo.map((c, i) => scaleChannel(c, scales[i]));
    }
  } else if (op.kind === "translate") {
    const delta = ["dx", "dy", "dz"].map((name) => {
      const raw = op.parameters[name] ?? 0;
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
      return value;
    });
    for (const triangle of result.triangles) {
      triangle.vertices = triangle.vertices.map((vertex) =>
        vertex.map((coordinate, i) => coordinate + delta[i]),
      );
    }
  }

  return result;
}

export function executeCreativeOperation(sceneBytes, operatorBytes) {
  const scene = parseScene(sceneBytes.toString("utf8"));
  const op = parseOperator(operatorBytes.toString("utf8"));
  const outputScene = applyOperator(scene, op);
  const outputBytes = Buffer.from(serializeScene(outputScene), "utf8");

  const receipt = {
    contract: "AXM_CREATIVE_RECEIPT",
    version: 1,
    operator_id: op.id,
    operator_kind: op.kind,
    input_scene_contract: "AXM_SCENE 1",
    output_scene_contract: "AXM_SCENE 1",
    input_sha256: sha256(sceneBytes),
    operator_sha256: sha256(operatorBytes),
    output_sha256: sha256(outputBytes),
    triangle_count: outputScene.triangles.length,
  };

  return { outputBytes, receipt };
}
