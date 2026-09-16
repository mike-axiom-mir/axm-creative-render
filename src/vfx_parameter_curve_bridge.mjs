import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PARAMETER_CURVE_NATIVE_RECEIPT";
const VERSION = 1;
const FIXED_VERTICES = [
  [-0.42, -0.32, 0],
  [0.42, -0.32, 0],
  [0.42, 0.32, 0],
  [-0.42, 0.32, 0],
];

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function unit(value, label) {
  const number = finite(value, label);
  if (number < 0 || number > 1) throw new Error(`${label} must be within 0..1 for this observation adapter`);
  return number;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function albedoForValue(value) {
  const v = unit(value, "parameter-curve sample value");
  return [
    48 + Math.round(v * 176),
    72 + Math.round(v * 128),
    144 + Math.round(v * 96),
  ];
}

export function parameterCurveSampleToAxmScene(sample) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw new Error("parameter-curve scene adapter requires a sample object");
  const sourceHash = String(sample.sourceHash || "").trim();
  if (!sourceHash) throw new Error("parameter-curve scene adapter requires sourceHash");
  const t = unit(sample.t, "parameter-curve sample t");
  const value = unit(sample.value, "parameter-curve sample value");
  const albedo = albedoForValue(value);
  const [a, b, c, d] = FIXED_VERTICES.map((vertex) => [...vertex]);
  const scene = {
    version: 1,
    triangles: [
      { vertices: [a, b, c], albedo: [...albedo] },
      { vertices: [a, c, d], albedo: [...albedo] },
    ],
  };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== 2) throw new Error("parameter-curve scene adapter triangle count drifted");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-parameter-curve-to-axm-scene/v1",
      source_hash: sourceHash,
      t,
      value,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: 2,
      output_sha256: sha256(bytes),
      geometry_is_fixed: true,
      albedo_encodes_only_sample_value: true,
      consumer_semantics_assigned: false,
      adapter_policy: "one retained scalar sample in 0..1 changes only RGB albedo on a fixed two-triangle observation body; geometry and canonical curve truth are not rewritten",
    },
  };
}

function sameGeometry(aBytes, bBytes) {
  const a = parseScene(aBytes.toString("utf8"));
  const b = parseScene(bBytes.toString("utf8"));
  return JSON.stringify(a.triangles.map((triangle) => triangle.vertices)) === JSON.stringify(b.triangles.map((triangle) => triangle.vertices));
}

export async function observeVisualEffectParameterCurve(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    parameterCurve: resolve(rootPath, "hand-lab/src/parameter-curve.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const parameterCurve = await import(`${pathToFileURL(paths.parameterCurve).href}?sha=${sources.parameterCurve.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(parameterCurve.PARAMETER_CURVE_HANDS) || !parameterCurve.PARAMETER_CURVE_GRAPH || typeof parameterCurve.makeParameterCurveState !== "function" || typeof parameterCurve.sampleParameterCurveSource !== "function") {
    throw new Error("VFX donor parameter-curve graph is unavailable");
  }
  if (parameterCurve.PARAMETER_CURVE_GRAPH.id !== "fx.animation.parameter-curve1d" || parameterCurve.PARAMETER_CURVE_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX parameter-curve graph identity");
  }
  const expectedHands = ["fx.animation.parameter-curve-source-normalize", "fx.animation.parameter-curve-samples-build"];
  if (JSON.stringify(parameterCurve.PARAMETER_CURVE_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX parameter-curve Hand boundary");
  }

  const request = {
    id: "creative-render-neutral-pulse",
    wrapMode: "clamp",
    keyframes: [
      { t: 0, value: 0.12, interpolation: "smoothstep" },
      { t: 0.35, value: 1, interpolation: "smoothstep" },
      { t: 0.72, value: 0.42, interpolation: "linear" },
      { t: 1, value: 0.08, interpolation: "linear" },
    ],
  };
  const requestBytesBefore = stableBytes(request);
  const makeState = () => parameterCurve.makeParameterCurveState(request);
  const executeGraph = (callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(parameterCurve.PARAMETER_CURVE_HANDS),
    graph: parameterCurve.PARAMETER_CURVE_GRAPH,
    initialState: makeState(),
    context: { callerKind },
  });

  const human = executeGraph("human");
  const machine = executeGraph("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX parameter-curve caller-neutral repeat verification failed");
  const finalState = human.finalState;
  const source = finalState.parameterCurveSource;
  const sourceHash = finalState.parameterCurveSourceHash;
  if (!source || runtime.hashValue(source) !== sourceHash) throw new Error("VFX parameter-curve canonical source hash drifted");
  if (stableBytes(finalState.parameterCurveRequest).compare(requestBytesBefore) !== 0) throw new Error("VFX parameter-curve caller request mutated");

  const normalized = parameterCurve.normalizeParameterCurveHand.execute(makeState());
  if (normalized.state.parameterCurveSourceHash !== sourceHash) throw new Error("VFX parameter-curve normalization source identity drifted");
  const built33 = parameterCurve.buildParameterCurveSamplesHand.execute(normalized.state, { sampleCount: 33 });
  const built129 = parameterCurve.buildParameterCurveSamplesHand.execute(normalized.state, { sampleCount: 129 });
  const set33 = built33.state.parameterCurveSamples[source.id];
  const set129 = built129.state.parameterCurveSamples[source.id];
  const graphSet = finalState.parameterCurveSamples[source.id];
  if (!set33 || !set129 || !graphSet) throw new Error("VFX parameter-curve derived sample tables are unavailable");
  for (const set of [set33, set129, graphSet]) {
    if (set.schema !== "axm.parameter-curve-samples/v0.1" || set.derived !== true || set.rebuildable !== true || set.sourceHash !== sourceHash) {
      throw new Error("VFX parameter-curve derived sample truth boundary drifted");
    }
  }
  if (set33.sampleSetHash === set129.sampleSetHash) throw new Error("VFX parameter-curve sample density did not change derived table identity");
  if (graphSet.sampleSetHash !== set129.sampleSetHash) throw new Error("VFX parameter-curve graph default no longer matches 129-sample build");
  if (runtime.hashValue(built33.state.parameterCurveSource) !== sourceHash || runtime.hashValue(built129.state.parameterCurveSource) !== sourceHash) {
    throw new Error("VFX parameter-curve sample density rewrote canonical source truth");
  }

  const times = [0, 0.5, 1];
  const samples = times.map((t) => ({ t, value: parameterCurve.sampleParameterCurveSource(source, t) }));
  if (samples.some((sample) => sample.value < 0 || sample.value > 1)) throw new Error("fixture curve escaped the explicit 0..1 observation adapter domain");
  if (new Set(samples.map((sample) => sample.value)).size !== samples.length) throw new Error("parameter-curve proof fixture must produce distinct retained sample values");

  const renderedSamples = samples.map((sample) => ({
    sample,
    adapted: parameterCurveSampleToAxmScene({ sourceHash, ...sample }),
  }));
  if (!sameGeometry(renderedSamples[0].adapted.bytes, renderedSamples[1].adapted.bytes) || !sameGeometry(renderedSamples[1].adapted.bytes, renderedSamples[2].adapted.bytes)) {
    throw new Error("parameter-curve observation adapter changed geometry across retained samples");
  }
  const albedos = renderedSamples.map(({ adapted }) => parseScene(adapted.bytes.toString("utf8")).triangles[0].albedo.join(","));
  if (new Set(albedos).size !== albedos.length) throw new Error("distinct retained curve values did not reach distinct observation albedo");

  const sourceBytes = stableBytes(source);
  const samples33Bytes = stableBytes(set33);
  const samples129Bytes = stableBytes(set129);
  const stateBytes = stableBytes(finalState);
  const sampleRecords = renderedSamples.map(({ sample, adapted }, index) => ({
    id: ["start", "mid", "end"][index],
    t: sample.t,
    value: sample.value,
    scene_sha256: sha256(adapted.bytes),
    scene_adapter: adapted.observation,
  }));

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: parameterCurve.PARAMETER_CURVE_GRAPH.id,
      graph_version: parameterCurve.PARAMETER_CURVE_GRAPH.version,
      hand_ids: expectedHands,
      files: {
        "hand-lab/src/hand-runtime.mjs": sources.runtime.sha256,
        "hand-lab/src/parameter-curve.mjs": sources.parameterCurve.sha256,
      },
    },
    caller_authority: {
      request_mutated: false,
      caller_neutral_repeat_verification: "PASS",
      canonical_curve_source_remains_authoritative: true,
      sample_density_is_canonical: false,
      consumer_semantics_assigned: false,
    },
    canonical_source: {
      schema: source.schema,
      id: source.id,
      hash: sourceHash,
      bytes_sha256: sha256(sourceBytes),
      keyframe_count: source.keyframes.length,
      wrap_mode: source.wrapMode,
    },
    derived_sample_tables: {
      sample_33: { sample_count: set33.sampleCount, sample_set_hash: set33.sampleSetHash, bytes_sha256: sha256(samples33Bytes), derived: true, rebuildable: true },
      sample_129: { sample_count: set129.sampleCount, sample_set_hash: set129.sampleSetHash, bytes_sha256: sha256(samples129Bytes), derived: true, rebuildable: true },
      canonical_source_hash_preserved: true,
    },
    observations: sampleRecords,
    state_sha256: sha256(stateBytes),
    authority: "caller request and normalized parameter-curve source are authoritative; rebuilt sample tables, observation scenes, render requests, receipts and pixels are derived evidence",
    truth_boundary: {
      proven: "current VFX parameter-curve graph, canonical-source continuity across sample density, deterministic caller-neutral sampling, fixed-geometry scalar-to-albedo observation, and downstream native-render eligibility",
      not_proven: ["animation timing", "motion quality", "pacing quality", "accessibility suitability", "aesthetic quality", "physical meaning", "real-time performance", "GPU or browser equivalence", "cross-machine bitwise determinism"],
    },
  };

  return {
    sourceBytes,
    samples33Bytes,
    samples129Bytes,
    stateBytes,
    startSceneBytes: renderedSamples[0].adapted.bytes,
    midSceneBytes: renderedSamples[1].adapted.bytes,
    endSceneBytes: renderedSamples[2].adapted.bytes,
    receipt,
  };
}
