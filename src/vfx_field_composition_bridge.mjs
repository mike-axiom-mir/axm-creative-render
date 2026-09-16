import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const MAX_GRID_CELLS = 4_096;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return number;
}

function scalar(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${label} must be finite and within 0..1`);
  }
  return number;
}

function validateGrid(field) {
  object(field, "composed scalar grid");
  if (field.schema !== "axm.scalar-field-composed-grid/v0.1") {
    throw new Error(`unexpected composed grid schema: ${String(field.schema)}`);
  }
  if (field.derived !== true || field.rebuildable !== true) {
    throw new Error("composed scalar grid must remain explicitly derived and rebuildable");
  }
  const width = integer(field.width, "composed grid width", 4, 128);
  const height = integer(field.height, "composed grid height", 4, 128);
  const cells = width * height;
  if (cells > MAX_GRID_CELLS) throw new Error(`composed grid exceeds ${MAX_GRID_CELLS}-cell scene-adapter ceiling`);
  if (!Array.isArray(field.values) || field.values.length !== cells) {
    throw new Error("composed grid values must match width*height");
  }
  field.values.forEach((value, index) => scalar(value, `composed grid value[${index}]`));
  for (const [key, label] of [
    ["compositionSourceHash", "composition source hash"],
    ["inputAHash", "input A hash"],
    ["inputBHash", "input B hash"],
    ["fieldHash", "field hash"],
  ]) {
    if (typeof field[key] !== "string" || !field[key]) throw new Error(`composed grid requires ${label}`);
  }
  return { width, height, cells };
}

function colorForScalar(value) {
  const v = scalar(value, "scalar albedo input");
  return [
    20 + Math.round(220 * v),
    32 + Math.round(188 * v),
    54 + Math.round(176 * v),
  ];
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export function composedFieldGridToAxmScene(field) {
  const { width, height, cells } = validateGrid(field);
  const triangles = [];
  for (let y = 0; y < height; y += 1) {
    const y0 = -1 + (2 * y) / height;
    const y1 = -1 + (2 * (y + 1)) / height;
    for (let x = 0; x < width; x += 1) {
      const x0 = -1 + (2 * x) / width;
      const x1 = -1 + (2 * (x + 1)) / width;
      const value = field.values[y * width + x];
      const albedo = colorForScalar(value);
      triangles.push(
        { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], albedo: [...albedo] },
        { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], albedo: [...albedo] },
      );
    }
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== cells * 2) throw new Error("field scene triangle count changed during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-composed-field-grid-to-axm-scene/v1",
      source_grid_schema: field.schema,
      source_grid_hash: field.fieldHash,
      composition_source_hash: field.compositionSourceHash,
      input_a_hash: field.inputAHash,
      input_b_hash: field.inputBHash,
      source_width: width,
      source_height: height,
      source_cells: cells,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: reparsed.triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_scalar_values: false,
      albedo_encodes_scalar_values: true,
      material_semantics_preserved: false,
      adapter_policy: "each retained derived scalar-grid sample becomes one fixed XY tile made of two triangles; only the declared RGB albedo mapping encodes the sampled scalar value",
    },
  };
}

export async function observeVisualEffectFieldComposition(root, options = {}) {
  const operation = String(options.operation ?? "multiply");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    field: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
    composition: resolve(rootPath, "hand-lab/src/field-composition-operators.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const modules = {};
  for (const [name, path] of Object.entries(paths)) {
    modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);
  }
  const { runtime, composition } = modules;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(composition.FIELD_COMPOSITION_HANDS) || !composition.FIELD_COMPOSITION_GRAPH) {
    throw new Error("VFX donor field-composition graph is unavailable");
  }
  if (typeof composition.makeFieldCompositionState !== "function") {
    throw new Error("VFX donor field-composition state factory is unavailable");
  }
  if (composition.FIELD_COMPOSITION_GRAPH.id !== "fx.field.compose2d" || composition.FIELD_COMPOSITION_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX field-composition graph identity");
  }

  const stateOptions = {
    id: String(options.id ?? `creative-render-${operation}`),
    operation,
    a: options.a ?? {
      id: "creative-render-field-a",
      seed: 1201,
      frequency: 3.25,
      octaves: 4,
      lacunarity: 2,
      gain: 0.5,
      offset: [0.1, -0.2],
    },
    b: options.b ?? {
      id: "creative-render-field-b",
      seed: 9127,
      frequency: 5.5,
      octaves: 3,
      lacunarity: 2.2,
      gain: 0.45,
      offset: [1.3, 0.7],
    },
  };
  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(composition.FIELD_COMPOSITION_HANDS),
    graph: composition.FIELD_COMPOSITION_GRAPH,
    initialState: composition.makeFieldCompositionState(stateOptions),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) {
    throw new Error("VFX field-composition repeat verification failed");
  }

  const finalState = object(first.finalState, "VFX field-composition final state");
  const sourceA = object(finalState.fieldSources?.a, "VFX input field A");
  const sourceB = object(finalState.fieldSources?.b, "VFX input field B");
  const compositionSource = object(finalState.fieldCompositionSource, "VFX composition source");
  if (sourceA.schema !== "axm.scalar-field-source/v0.1" || sourceB.schema !== "axm.scalar-field-source/v0.1") {
    throw new Error("VFX field-composition input source schema drifted");
  }
  if (compositionSource.schema !== "axm.scalar-field-composition-source/v0.1") {
    throw new Error("VFX field-composition source schema drifted");
  }
  if (compositionSource.operation !== operation) throw new Error("VFX field-composition operation drifted");
  if (compositionSource.inputA?.sourceHash !== finalState.fieldSourceHashes?.a || compositionSource.inputB?.sourceHash !== finalState.fieldSourceHashes?.b) {
    throw new Error("VFX field-composition source lineage drifted");
  }
  const grid = object(finalState.composedFields?.[compositionSource.id], "VFX composed grid");
  const shape = validateGrid(grid);
  if (grid.compositionSourceHash !== finalState.fieldCompositionSourceHash) {
    throw new Error("VFX composed grid lost composition-source identity");
  }
  if (grid.inputAHash !== finalState.fieldSourceHashes.a || grid.inputBHash !== finalState.fieldSourceHashes.b) {
    throw new Error("VFX composed grid lost input-source identity");
  }

  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  return {
    field: structuredClone(grid),
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-field-composition-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      graph_id: composition.FIELD_COMPOSITION_GRAPH.id,
      graph_version: composition.FIELD_COMPOSITION_GRAPH.version,
      donor_hand_ids: composition.FIELD_COMPOSITION_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: first.finalStateHash,
      repeat_verification: "PASS",
      operation,
      input_a: { id: sourceA.id, schema: sourceA.schema, source_hash: finalState.fieldSourceHashes.a },
      input_b: { id: sourceB.id, schema: sourceB.schema, source_hash: finalState.fieldSourceHashes.b },
      composition_source: {
        schema: compositionSource.schema,
        id: compositionSource.id,
        source_hash: finalState.fieldCompositionSourceHash,
        operation: compositionSource.operation,
      },
      grid: {
        schema: grid.schema,
        field_hash: grid.fieldHash,
        width: shape.width,
        height: shape.height,
        cells: shape.cells,
        min: grid.min,
        max: grid.max,
        mean: grid.mean,
        derived: grid.derived,
        rebuildable: grid.rebuildable,
      },
      truth_boundary: {
        input_fields_authority: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
        composition_authority: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
        grid_authority: "DERIVED_REBUILDABLE_VFX_WORKING_SET",
        consumer_semantics_proven: false,
        aesthetic_quality_proven: false,
      },
    },
  };
}
