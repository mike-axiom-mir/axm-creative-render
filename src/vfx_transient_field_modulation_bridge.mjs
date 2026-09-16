import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const RING_SEGMENTS = 20;
const MAX_PRIMITIVES = 96;
const MAX_SCENE_TRIANGLES = 1_000;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
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

function text(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function sameCounts(a, b) {
  return a.rings === b.rings && a.spokes === b.spokes && a.fragments === b.fragments;
}

function validateEvent(event, canonicalEventHash) {
  object(event, "transient event");
  if (event.schema !== "axm.transient-impulse-event/v0.1") throw new Error(`unexpected transient event schema: ${String(event.schema)}`);
  text(canonicalEventHash, "canonical event hash");
  if (!Array.isArray(event.origin) || event.origin.length !== 2) throw new Error("transient event origin must be [x,y]");
  event.origin.forEach((value, index) => bounded(value, 0, 1, `transient event origin[${index}]`));
  bounded(event.radius, 0.02, 0.9, "transient event radius");
  return event;
}

function validatePrimitiveArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > MAX_PRIMITIVES) throw new Error(`${label} exceeds bounded primitive ceiling`);
  return value;
}

function validateField(field, kind) {
  object(field, `${kind} impulse field`);
  const expected = kind === "base" ? "axm.transient-impulse-field/v0.1" : "axm.transient-impulse-modulated-field/v0.1";
  if (field.schema !== expected) throw new Error(`unexpected ${kind} impulse field schema: ${String(field.schema)}`);
  if (field.derived !== true || field.rebuildable !== true) throw new Error(`${kind} impulse field must remain explicitly derived and rebuildable`);
  text(field.canonicalEventHash, `${kind} canonical event hash`);
  text(field.geometryHash, `${kind} geometry hash`);
  object(field.geometry, `${kind} geometry`);
  object(field.counts, `${kind} counts`);
  const rings = validatePrimitiveArray(field.geometry.rings, `${kind} rings`);
  const spokes = validatePrimitiveArray(field.geometry.spokes, `${kind} spokes`);
  const fragments = validatePrimitiveArray(field.geometry.fragments, `${kind} fragments`);
  if (field.counts.rings !== rings.length || field.counts.spokes !== spokes.length || field.counts.fragments !== fragments.length) {
    throw new Error(`${kind} primitive counts drifted from geometry`);
  }
  if (rings.length + spokes.length + fragments.length > MAX_PRIMITIVES) throw new Error(`${kind} impulse field exceeds total primitive ceiling`);
  for (const ring of rings) {
    object(ring, `${kind} ring`); text(ring.id, `${kind} ring id`);
    bounded(ring.radiusScale, 0, 4, `${kind} ring radiusScale`);
    bounded(ring.widthScale, 0, 4, `${kind} ring widthScale`);
    bounded(ring.axisRatio, 0.01, 4, `${kind} ring axisRatio`);
    finite(ring.rotation, `${kind} ring rotation`); bounded(ring.intensity, 0, 8, `${kind} ring intensity`);
  }
  for (const spoke of spokes) {
    object(spoke, `${kind} spoke`); text(spoke.id, `${kind} spoke id`);
    finite(spoke.angle, `${kind} spoke angle`); finite(spoke.bend, `${kind} spoke bend`);
    bounded(spoke.startScale, 0, 4, `${kind} spoke startScale`);
    bounded(spoke.lengthScale, 0, 4, `${kind} spoke lengthScale`);
    bounded(spoke.widthScale, 0, 4, `${kind} spoke widthScale`);
    bounded(spoke.intensity, 0, 8, `${kind} spoke intensity`);
  }
  for (const fragment of fragments) {
    object(fragment, `${kind} fragment`); text(fragment.id, `${kind} fragment id`);
    finite(fragment.angle, `${kind} fragment angle`);
    bounded(fragment.radialScale, 0, 4, `${kind} fragment radialScale`);
    bounded(fragment.lengthScale, 0, 4, `${kind} fragment lengthScale`);
    finite(fragment.tangentScale, `${kind} fragment tangentScale`);
    bounded(fragment.intensity, 0, 8, `${kind} fragment intensity`);
  }
  return { rings, spokes, fragments };
}

function layoutValue(item) {
  const copy = structuredClone(item);
  delete copy.intensity;
  delete copy.scalarModulation;
  delete copy.phase;
  return copy;
}

function geometryLayout(field) {
  return {
    rings: field.geometry.rings.map(layoutValue),
    spokes: field.geometry.spokes.map(layoutValue),
    fragments: field.geometry.fragments.map(layoutValue),
  };
}

export function impulseFieldLayoutSha256(field) {
  return sha256(Buffer.from(JSON.stringify(geometryLayout(field)), "utf8"));
}

function intensityStats(field) {
  const values = [
    ...field.geometry.rings.map((row) => Number(row.intensity)),
    ...field.geometry.spokes.map((row) => Number(row.intensity)),
    ...field.geometry.fragments.map((row) => Number(row.intensity)),
  ];
  if (values.length === 0) return { min: 0, max: 0, mean: 0, samples: 0 };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    samples: values.length,
  };
}

function colorForIntensity(intensity, kind) {
  const v = Math.min(1, bounded(intensity, 0, 8, "scene intensity") / 1.5);
  if (kind === "ring") return [20 + Math.round(60 * v), 70 + Math.round(160 * v), 110 + Math.round(145 * v)];
  if (kind === "spoke") return [80 + Math.round(175 * v), 42 + Math.round(160 * v), 20 + Math.round(100 * v)];
  return [30 + Math.round(110 * v), 80 + Math.round(150 * v), 80 + Math.round(175 * v)];
}

function point(cx, cy, radius, angle, xScale = 1, yScale = 1) {
  return [cx + Math.cos(angle) * radius * xScale, cy + Math.sin(angle) * radius * yScale, 0];
}

function rotateAround([x, y, z], [cx, cy], angle) {
  const dx = x - cx, dy = y - cy, c = Math.cos(angle), s = Math.sin(angle);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c, z];
}

function pushQuad(triangles, a, b, halfWidth, albedo) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
  const px = -dy / length * halfWidth, py = dx / length * halfWidth;
  const p0 = [a[0] + px, a[1] + py, 0], p1 = [b[0] + px, b[1] + py, 0];
  const p2 = [b[0] - px, b[1] - py, 0], p3 = [a[0] - px, a[1] - py, 0];
  triangles.push({ vertices: [p0, p1, p2], albedo: [...albedo] }, { vertices: [p0, p2, p3], albedo: [...albedo] });
}

export function impulseFieldToAxmScene(event, canonicalEventHash, field, kind = "base") {
  validateEvent(event, canonicalEventHash);
  validateField(field, kind);
  if (field.canonicalEventHash !== canonicalEventHash) throw new Error(`${kind} field lost canonical event identity`);

  const cx = (event.origin[0] - 0.5) * 1.4;
  const cy = (0.5 - event.origin[1]) * 0.8;
  const radius = event.radius * 1.55;
  const triangles = [];

  for (const ring of field.geometry.rings) {
    const albedo = colorForIntensity(ring.intensity, "ring");
    const outer = radius * ring.radiusScale;
    const thickness = Math.max(0.003, 0.009 * ring.widthScale);
    const inner = Math.max(0, outer - thickness);
    for (let i = 0; i < RING_SEGMENTS; i += 1) {
      const a0 = i / RING_SEGMENTS * Math.PI * 2;
      const a1 = (i + 1) / RING_SEGMENTS * Math.PI * 2;
      const p0 = rotateAround(point(cx, cy, outer, a0, 1, ring.axisRatio), [cx, cy], ring.rotation);
      const p1 = rotateAround(point(cx, cy, outer, a1, 1, ring.axisRatio), [cx, cy], ring.rotation);
      const p2 = rotateAround(point(cx, cy, inner, a1, 1, ring.axisRatio), [cx, cy], ring.rotation);
      const p3 = rotateAround(point(cx, cy, inner, a0, 1, ring.axisRatio), [cx, cy], ring.rotation);
      triangles.push({ vertices: [p0, p1, p2], albedo: [...albedo] }, { vertices: [p0, p2, p3], albedo: [...albedo] });
    }
  }

  for (const spoke of field.geometry.spokes) {
    const start = point(cx, cy, radius * spoke.startScale, spoke.angle);
    const end = point(cx, cy, radius * spoke.lengthScale, spoke.angle + spoke.bend);
    pushQuad(triangles, start, end, Math.max(0.002, 0.004 * spoke.widthScale), colorForIntensity(spoke.intensity, "spoke"));
  }

  for (const fragment of field.geometry.fragments) {
    const tangent = fragment.angle + Math.PI / 2;
    const center = [
      cx + Math.cos(fragment.angle) * radius * fragment.radialScale + Math.cos(tangent) * radius * fragment.tangentScale,
      cy + Math.sin(fragment.angle) * radius * fragment.radialScale + Math.sin(tangent) * radius * fragment.tangentScale,
      0,
    ];
    const half = radius * fragment.lengthScale * 0.5;
    const a = [center[0] - Math.cos(fragment.angle) * half, center[1] - Math.sin(fragment.angle) * half, 0];
    const b = [center[0] + Math.cos(fragment.angle) * half, center[1] + Math.sin(fragment.angle) * half, 0];
    pushQuad(triangles, a, b, 0.0025, colorForIntensity(fragment.intensity, "fragment"));
  }

  if (triangles.length < 1 || triangles.length > MAX_SCENE_TRIANGLES) throw new Error(`derived impulse scene triangle count outside 1..${MAX_SCENE_TRIANGLES}`);
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangles.length) throw new Error("impulse scene triangle count changed during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-transient-field-to-axm-scene/v1",
      field_kind: kind,
      source_schema: field.schema,
      canonical_event_hash: canonicalEventHash,
      source_geometry_hash: field.geometryHash,
      geometry_layout_sha256: impulseFieldLayoutSha256(field),
      intensity: intensityStats(field),
      counts: structuredClone(field.counts),
      output_contract: "AXM_SCENE 1",
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_intensity: false,
      albedo_encodes_intensity: true,
      semantic_material_meaning_preserved: false,
      adapter_policy: "rings/spokes/fragments become bounded fixed XY triangle geometry; source intensity changes only declared RGB albedo, never canonical event or primitive placement",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export async function observeVisualEffectImpulseFieldModulation(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    transient: resolve(rootPath, "hand-lab/src/transient-impulse-hands.mjs"),
    field: resolve(rootPath, "hand-lab/src/field-operators.mjs"),
    composition: resolve(rootPath, "hand-lab/src/field-composition-operators.mjs"),
    modulation: resolve(rootPath, "hand-lab/src/transient-impulse-field-modulation.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const modulation = await import(`${pathToFileURL(paths.modulation).href}?sha=${sources.modulation.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") throw new Error("VFX donor Hand runtime is unavailable");
  if (!Array.isArray(modulation.TRANSIENT_IMPULSE_FIELD_MODULATION_HANDS) || !modulation.TRANSIENT_IMPULSE_FIELD_MODULATION_GRAPH) throw new Error("VFX donor transient field-modulation graph is unavailable");
  if (typeof modulation.makeTransientImpulseFieldModulationState !== "function") throw new Error("VFX donor transient field-modulation state factory is unavailable");
  const graph = modulation.TRANSIENT_IMPULSE_FIELD_MODULATION_GRAPH;
  if (graph.id !== "fx.transient-impulse.composed-field-modulation" || graph.version !== "0.1.0") throw new Error("unexpected VFX transient field-modulation graph identity");

  const stateOptions = {
    id: String(options.id ?? "creative-render-modulated-proof"),
    strength: options.strength ?? 1,
    floor: options.floor ?? 0.08,
    impulse: options.impulse ?? {
      id: "creative-render-shared-impulse",
      seed: 20260916,
      origin: [0.5, 0.5],
      direction: [1, -0.15],
      energy: 1.18,
      radius: 0.31,
      controls: { symmetry: 0.2, directionality: 0.94, fragmentation: 0.78, ringWeight: 0.72, spokeWeight: 1.12 },
    },
    composition: options.composition ?? {
      id: "creative-render-shared-composition",
      operation: "multiply",
      a: { id: "creative-render-broad", seed: 771, frequency: 2.2, octaves: 4, lacunarity: 2, gain: 0.56, offset: [0.11, -0.19] },
      b: { id: "creative-render-detail", seed: 9021, frequency: 7.1, octaves: 3, lacunarity: 1.9, gain: 0.43, offset: [-0.27, 0.21] },
    },
  };
  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(modulation.TRANSIENT_IMPULSE_FIELD_MODULATION_HANDS),
    graph,
    initialState: modulation.makeTransientImpulseFieldModulationState(stateOptions),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute(), second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("VFX transient field-modulation repeat verification failed");

  const finalState = object(first.finalState, "VFX transient field-modulation final state");
  const event = validateEvent(finalState.event, finalState.eventCanonicalHash);
  const baseField = object(finalState.impulseField, "VFX base impulse field");
  const modulatedField = object(finalState.modulatedImpulseFields?.[stateOptions.id], "VFX modulated impulse field");
  validateField(baseField, "base"); validateField(modulatedField, "modulated");
  if (baseField.canonicalEventHash !== finalState.eventCanonicalHash || modulatedField.canonicalEventHash !== finalState.eventCanonicalHash) throw new Error("VFX field modulation lost canonical event identity");
  if (modulatedField.baseFieldGeometryHash !== baseField.geometryHash) throw new Error("VFX modulated field lost base geometry identity");
  if (!sameCounts(baseField.counts, modulatedField.counts)) throw new Error("VFX field modulation changed primitive counts");
  if (impulseFieldLayoutSha256(baseField) !== impulseFieldLayoutSha256(modulatedField)) throw new Error("VFX field modulation changed primitive placement/layout");
  if (JSON.stringify(baseField.geometry.rings) !== JSON.stringify(modulatedField.geometry.rings)) throw new Error("VFX field modulation changed ring baseline");
  if (modulatedField.fieldCompositionSourceHash !== finalState.fieldCompositionSourceHash) throw new Error("VFX modulated field lost composition-source identity");
  if (modulatedField.inputAHash !== finalState.fieldSourceHashes?.a || modulatedField.inputBHash !== finalState.fieldSourceHashes?.b) throw new Error("VFX modulated field lost scalar source identity");
  if (modulatedField.fieldModulationSourceHash !== finalState.fieldModulationSourceHash) throw new Error("VFX modulated field lost modulation-source identity");
  if (modulatedField.factorStats?.samples !== baseField.counts.spokes + baseField.counts.fragments) throw new Error("VFX modulation factor sample count drifted");
  const changedDetail = modulatedField.geometry.spokes.some((item, index) => item.intensity !== baseField.geometry.spokes[index].intensity)
    || modulatedField.geometry.fragments.some((item, index) => item.intensity !== baseField.geometry.fragments[index].intensity);
  if (stateOptions.strength > 0 && !changedDetail) throw new Error("VFX field modulation did not change derived detail intensity");

  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  return {
    event: structuredClone(event),
    canonicalEventHash: finalState.eventCanonicalHash,
    baseField: structuredClone(baseField),
    modulatedField: structuredClone(modulatedField),
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-transient-field-modulation-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_reused: true,
      graph_id: graph.id,
      graph_version: graph.version,
      donor_hand_ids: modulation.TRANSIENT_IMPULSE_FIELD_MODULATION_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: first.finalStateHash,
      repeat_verification: "PASS",
      canonical_event_hash: finalState.eventCanonicalHash,
      base_field: { schema: baseField.schema, geometry_hash: baseField.geometryHash, layout_sha256: impulseFieldLayoutSha256(baseField), counts: structuredClone(baseField.counts), derived: baseField.derived, rebuildable: baseField.rebuildable },
      composition_source: { schema: finalState.fieldCompositionSource?.schema, source_hash: finalState.fieldCompositionSourceHash, operation: finalState.fieldCompositionSource?.operation, input_a_hash: finalState.fieldSourceHashes?.a, input_b_hash: finalState.fieldSourceHashes?.b },
      modulation_source: { schema: finalState.fieldModulationSource?.schema, source_hash: finalState.fieldModulationSourceHash, mode: finalState.fieldModulationSource?.mode, strength: finalState.fieldModulationSource?.strength, floor: finalState.fieldModulationSource?.floor },
      modulated_field: { schema: modulatedField.schema, geometry_hash: modulatedField.geometryHash, base_geometry_hash: modulatedField.baseFieldGeometryHash, layout_sha256: impulseFieldLayoutSha256(modulatedField), counts: structuredClone(modulatedField.counts), factor_stats: structuredClone(modulatedField.factorStats), derived: modulatedField.derived, rebuildable: modulatedField.rebuildable },
      invariants: { canonical_event_preserved: true, base_field_preserved: true, ring_baseline_preserved: true, primitive_counts_preserved: true, primitive_layout_preserved: true, detail_intensity_changed: changedDetail },
      truth_boundary: { event_authority: "CANONICAL_VFX_TRANSIENT_EVENT", scalar_sources_authority: "CANONICAL_VFX_SCALAR_FIELD_SOURCES", composition_authority: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE", modulation_control_authority: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE", base_field_authority: "DERIVED_REBUILDABLE_VFX_BODY", modulated_field_authority: "DERIVED_REBUILDABLE_VFX_BODY", consumer_semantics_proven: false, aesthetic_quality_proven: false },
    },
  };
}
