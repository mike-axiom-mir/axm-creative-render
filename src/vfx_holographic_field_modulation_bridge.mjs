import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const STRIDE = 7;
const MAX_POINTS = 4096;
const MAX_TRIANGLES = MAX_POINTS * 2;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function bounded(value, min, max, label) {
  const number = finite(value, label);
  if (number < min || number > max) throw new Error(`${label} must be within [${min},${max}]`);
  return number;
}

function validateSampleField(field, label, { modulated = false } = {}) {
  const value = object(field, label);
  const expected = modulated ? "axm.holographic-modulated-sample-field/v0.1" : "axm.holographic-sample-field/v0.1";
  if (value.schema !== expected) throw new Error(`${label} schema must be ${expected}`);
  if (value.stride !== STRIDE) throw new Error(`${label}.stride must be ${STRIDE}`);
  if (!Array.isArray(value.points) || value.points.length < STRIDE || value.points.length % STRIDE !== 0) throw new Error(`${label}.points must be a non-empty stride-${STRIDE} array`);
  const pointCount = value.points.length / STRIDE;
  if (pointCount < 1 || pointCount > MAX_POINTS) throw new Error(`${label} point count must be within 1..${MAX_POINTS}`);
  if (value.pointCount !== pointCount) throw new Error(`${label}.pointCount does not match points`);
  for (let i = 0; i < value.points.length; i += STRIDE) {
    finite(value.points[i], `${label}.points[${i}] x`);
    finite(value.points[i + 1], `${label}.points[${i + 1}] y`);
    finite(value.points[i + 2], `${label}.points[${i + 2}] z`);
    bounded(value.points[i + 3], 0.05, 64, `${label}.points[${i + 3}] size`);
    finite(value.points[i + 4], `${label}.points[${i + 4}] role`);
    finite(value.points[i + 5], `${label}.points[${i + 5}] phase`);
    bounded(value.points[i + 6], 0, 4, `${label}.points[${i + 6}] intensity`);
  }
  text(value.canonicalFormHash, `${label}.canonicalFormHash`);
  if (modulated) {
    text(value.baseSampleFieldHash, `${label}.baseSampleFieldHash`);
    text(value.fieldCompositionSourceHash, `${label}.fieldCompositionSourceHash`);
    text(value.holographicFieldModulationSourceHash, `${label}.holographicFieldModulationSourceHash`);
    if (value.derived !== true || value.rebuildable !== true) throw new Error(`${label} must remain derived and rebuildable`);
  }
  return pointCount;
}

function layoutValue(points) {
  const out = [];
  for (let i = 0; i < points.length; i += STRIDE) out.push(points.slice(i, i + 6));
  return out;
}

export function holographicSampleLayoutSha256(field) {
  validateSampleField(field, "holographic sample field", { modulated: field?.schema === "axm.holographic-modulated-sample-field/v0.1" });
  return sha256(Buffer.from(JSON.stringify(layoutValue(field.points)), "utf8"));
}

function intensityStats(points) {
  const values = [];
  for (let i = 6; i < points.length; i += STRIDE) values.push(Number(points[i]));
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    samples: values.length,
  };
}

function albedoForIntensity(value) {
  const v = Math.min(1, Math.max(0, Number(value) / 1.15));
  return [
    18 + Math.round(72 * v),
    58 + Math.round(170 * v),
    86 + Math.round(169 * v),
  ];
}

function pushPointQuad(triangles, x, y, z, size, albedo) {
  const half = Math.max(0.0025, Math.min(0.035, Number(size) * 0.0045));
  const p0 = [x - half, y - half, z];
  const p1 = [x + half, y - half, z];
  const p2 = [x + half, y + half, z];
  const p3 = [x - half, y + half, z];
  triangles.push(
    { vertices: [p0, p1, p2], albedo: [...albedo] },
    { vertices: [p0, p2, p3], albedo: [...albedo] },
  );
}

export function holographicSampleFieldToAxmScene(field, kind, identity) {
  if (kind !== "base" && kind !== "modulated") throw new Error("holographic scene kind must be base or modulated");
  const pointCount = validateSampleField(field, `${kind} holographic field`, { modulated: kind === "modulated" });
  const source = object(identity, `${kind} source identity`);
  text(source.source_hash, `${kind} source identity hash`);
  if (kind === "modulated") {
    if (source.source_schema !== "axm.holographic-modulated-sample-field/v0.1") throw new Error(`unexpected modulated source schema: ${String(source.source_schema)}`);
    if (source.derived !== true || source.rebuildable !== true) throw new Error("modulated holographic source must remain derived and rebuildable");
    text(source.base_sample_hash, "modulated base sample hash");
  }

  const triangles = [];
  for (let i = 0; i < field.points.length; i += STRIDE) {
    const x = finite(field.points[i], "sample x");
    const y = finite(field.points[i + 1], "sample y");
    const z = finite(field.points[i + 2], "sample z");
    const size = bounded(field.points[i + 3], 0.05, 64, "sample size");
    const intensity = bounded(field.points[i + 6], 0, 4, "sample intensity");
    pushPointQuad(triangles, x, y, z, size, albedoForIntensity(intensity));
  }
  if (triangles.length !== pointCount * 2 || triangles.length > MAX_TRIANGLES) throw new Error("derived holographic scene triangle budget drifted");
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangles.length) throw new Error("holographic scene triangle count changed during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-holographic-sample-to-axm-scene/v1",
      sample_kind: kind,
      source_schema: source.source_schema ?? "axm.holographic-sample-field/v0.1",
      source_hash: source.source_hash,
      base_sample_hash: source.base_sample_hash ?? source.source_hash,
      canonical_form_hash: field.canonicalFormHash,
      geometry_layout_sha256: holographicSampleLayoutSha256(field),
      point_count: pointCount,
      intensity: intensityStats(field.points),
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_intensity: false,
      albedo_encodes_intensity: true,
      role_phase_semantics_realized: false,
      adapter_policy: "retained xyz/size become bounded camera-facing XY quads at retained z; only sample intensity changes RGB albedo; role, phase, holographic projection, shimmer, breakup and physical-light meaning remain outside this adapter",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes) };
}

function defaultForm() {
  return {
    id: "creative-render-holographic-grid",
    style: { pattern: "waves", amount: 0.28, scale: 5.5 },
    primitives: [{
      type: "points",
      points: [
        [-0.48, -0.28, 0.02, 3.5, 0, 0.02, 1], [-0.18, -0.30, 0.00, 3.3, 1, 0.13, 1], [0.14, -0.27, -0.02, 3.6, 0, 0.24, 1], [0.46, -0.22, 0.01, 3.2, 2, 0.35, 1],
        [-0.44, 0.02, -0.01, 3.4, 1, 0.46, 1], [-0.14, 0.04, 0.03, 3.6, 0, 0.57, 1], [0.18, 0.05, 0.01, 3.4, 2, 0.68, 1], [0.48, 0.08, -0.03, 3.5, 0, 0.79, 1],
        [-0.38, 0.31, 0.02, 3.2, 2, 0.90, 1], [-0.08, 0.28, -0.02, 3.7, 0, 0.11, 1], [0.23, 0.30, 0.02, 3.3, 1, 0.22, 1], [0.42, 0.34, 0.00, 3.5, 0, 0.33, 1]
      ]
    }]
  };
}

export async function observeVisualEffectHolographicFieldModulation(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    projector: resolve(rootPath, "hand-lab/src/holographic-state-projector.mjs"),
    field: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
    composition: resolve(rootPath, "hand-lab/src/field-composition-operators.mjs"),
    modulation: resolve(rootPath, "hand-lab/src/holographic-field-modulation.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const modulation = await import(`${pathToFileURL(paths.modulation).href}?sha=${sources.modulation.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(modulation.HOLOGRAPHIC_FIELD_MODULATION_HANDS) || !modulation.HOLOGRAPHIC_FIELD_MODULATION_GRAPH) throw new Error("VFX donor holographic field-modulation graph is unavailable");
  if (typeof modulation.makeHolographicFieldModulationState !== "function") throw new Error("VFX donor holographic field-modulation state factory is unavailable");
  const graph = modulation.HOLOGRAPHIC_FIELD_MODULATION_GRAPH;
  if (graph.id !== "fx.holographic-state-projector.composed-field-modulation" || graph.version !== "0.1.0") throw new Error("unexpected VFX holographic field-modulation graph identity");

  const id = String(options.id ?? "creative-render-holographic-modulation");
  const stateOptions = {
    id,
    seed: options.seed ?? 71,
    axes: options.axes ?? "xy",
    strength: options.strength ?? 0.88,
    floor: options.floor ?? 0.12,
    composition: options.composition ?? {
      id: "creative-render-holographic-composition",
      operation: "multiply",
      a: { id: "holographic-broad", seed: 1601, frequency: 2.1, octaves: 3, lacunarity: 2, gain: 0.55, offset: [0.12, -0.08] },
      b: { id: "holographic-detail", seed: 1602, frequency: 6.7, octaves: 2, lacunarity: 1.9, gain: 0.44, offset: [-0.21, 0.17] },
    },
  };
  const form = structuredClone(options.form ?? defaultForm());
  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(modulation.HOLOGRAPHIC_FIELD_MODULATION_HANDS),
    graph,
    initialState: modulation.makeHolographicFieldModulationState(form, stateOptions),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("VFX holographic field-modulation repeat verification failed");

  const finalState = object(first.finalState, "VFX holographic field-modulation final state");
  const base = object(finalState.sampleField, "VFX retained holographic sample field");
  const baseCount = validateSampleField(base, "VFX retained holographic sample field");
  text(finalState.holographicBaseSampleFieldHash, "VFX retained holographic base sample hash");
  if (runtime.hashValue(finalState.form) !== base.canonicalFormHash) throw new Error("VFX canonical holographic form drifted after sampling");
  if (runtime.hashValue(base) !== finalState.holographicBaseSampleFieldHash) throw new Error("VFX retained holographic sample field drifted after lineage capture");
  const modulated = object(finalState.modulatedHolographicSampleFields?.[id], "VFX modulated holographic sample field");
  const modCount = validateSampleField(modulated, "VFX modulated holographic sample field", { modulated: true });
  if (modulated.baseSampleFieldHash !== finalState.holographicBaseSampleFieldHash) throw new Error("VFX modulated holographic field lost retained base identity");
  if (runtime.hashValue(modulated.points) !== modulated.sampleFieldHash) throw new Error("VFX modulated holographic point hash drifted");
  if (modulated.fieldCompositionSourceHash !== finalState.fieldCompositionSourceHash) throw new Error("VFX modulated holographic field lost composition-source identity");
  if (modulated.holographicFieldModulationSourceHash !== finalState.holographicFieldModulationSourceHash) throw new Error("VFX modulated holographic field lost modulation-source identity");
  if (modulated.inputAHash !== finalState.fieldSourceHashes?.a || modulated.inputBHash !== finalState.fieldSourceHashes?.b) throw new Error("VFX modulated holographic field lost scalar source identity");
  if (baseCount !== modCount) throw new Error("VFX holographic modulation changed point count");
  if (holographicSampleLayoutSha256(base) !== holographicSampleLayoutSha256(modulated)) throw new Error("VFX holographic modulation changed retained renderer geometry channels");
  if (JSON.stringify(layoutValue(base.points)) !== JSON.stringify(layoutValue(modulated.points))) throw new Error("VFX holographic modulation changed non-intensity sample channels");
  if (modulated.factorStats?.samples !== baseCount) throw new Error("VFX holographic modulation factor sample count drifted");
  const intensityChanged = modulated.points.some((value, index) => index % STRIDE === 6 && value !== base.points[index]);
  if (stateOptions.strength > 0 && !intensityChanged) throw new Error("VFX holographic modulation did not change derived intensity");

  return {
    base: structuredClone(base),
    modulated: structuredClone(modulated),
    stateBytes: Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8"),
    observation: {
      schema: "axm.creative-render.vfx-holographic-field-modulation-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      graph_id: graph.id,
      graph_version: graph.version,
      donor_hand_ids: modulation.HOLOGRAPHIC_FIELD_MODULATION_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: first.finalStateHash,
      repeat_verification: "PASS",
      canonical_form: { source_hash: base.canonicalFormHash, id: finalState.form?.id },
      base_sample: {
        schema: base.schema,
        source_hash: finalState.holographicBaseSampleFieldHash,
        point_hash: runtime.hashValue(base.points),
        layout_sha256: holographicSampleLayoutSha256(base),
        point_count: baseCount,
        intensity: intensityStats(base.points),
      },
      composition_source: {
        schema: finalState.fieldCompositionSource?.schema,
        source_hash: finalState.fieldCompositionSourceHash,
        operation: finalState.fieldCompositionSource?.operation,
        input_a_hash: finalState.fieldSourceHashes?.a,
        input_b_hash: finalState.fieldSourceHashes?.b,
      },
      modulation_source: {
        schema: finalState.holographicFieldModulationSource?.schema,
        source_hash: finalState.holographicFieldModulationSourceHash,
        mode: finalState.holographicFieldModulationSource?.mode,
        axes: finalState.holographicFieldModulationSource?.axes,
        strength: finalState.holographicFieldModulationSource?.strength,
        floor: finalState.holographicFieldModulationSource?.floor,
      },
      modulated_sample: {
        schema: modulated.schema,
        sample_field_hash: modulated.sampleFieldHash,
        base_sample_hash: modulated.baseSampleFieldHash,
        layout_sha256: holographicSampleLayoutSha256(modulated),
        point_count: modCount,
        factor_stats: structuredClone(modulated.factorStats),
        intensity: intensityStats(modulated.points),
        derived: modulated.derived,
        rebuildable: modulated.rebuildable,
      },
      invariants: {
        canonical_form_hash_still_valid: runtime.hashValue(finalState.form) === base.canonicalFormHash,
        retained_base_hash_still_valid: runtime.hashValue(base) === finalState.holographicBaseSampleFieldHash,
        non_intensity_channels_preserved: JSON.stringify(layoutValue(base.points)) === JSON.stringify(layoutValue(modulated.points)),
        point_count_preserved: baseCount === modCount,
        renderer_layout_preserved: holographicSampleLayoutSha256(base) === holographicSampleLayoutSha256(modulated),
        derived_intensity_changed: intensityChanged,
      },
      truth_boundary: {
        physical_holography_proven: false,
        donor_webgl_equivalence_proven: false,
        aesthetic_quality_proven: false,
        realtime_performance_proven: false,
      },
    },
  };
}
