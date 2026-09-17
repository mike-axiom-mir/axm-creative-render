import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_BRANCH_GROWTH_NATIVE_RECEIPT";
const VERSION = 1;
const HALF_WIDTH = 0.006;
const FIXED_ALBEDO = [126, 194, 232];

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function scenePoint(point) {
  if (!Array.isArray(point) || point.length !== 2) throw new Error("branch-growth adapter requires 2D points");
  const [x, y] = point.map(Number);
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error("branch-growth adapter points must remain inside normalized 0..1 space");
  }
  return [(x - 0.5) * 1.8, (0.5 - y) * 1.8, 0];
}

function segmentQuad(segment) {
  const start = scenePoint(segment.start);
  const end = scenePoint(segment.end);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) throw new Error(`branch-growth adapter does not silently realize zero-length segment ${segment.id}`);
  const nx = (-dy / length) * HALF_WIDTH;
  const ny = (dx / length) * HALF_WIDTH;
  const a = [start[0] + nx, start[1] + ny, 0];
  const b = [start[0] - nx, start[1] - ny, 0];
  const c = [end[0] - nx, end[1] - ny, 0];
  const d = [end[0] + nx, end[1] + ny, 0];
  return [
    { vertices: [a, b, c], albedo: [...FIXED_ALBEDO] },
    { vertices: [a, c, d], albedo: [...FIXED_ALBEDO] },
  ];
}

export function branchGrowthNetworkToAxmScene(network) {
  if (!network || typeof network !== "object" || Array.isArray(network)) throw new Error("branch-growth scene adapter requires a network object");
  if (network.schema !== "axm.branch-growth-network2d/v0.1" || network.derived !== true || network.rebuildable !== true) {
    throw new Error("branch-growth scene adapter accepts only derived rebuildable v0.1 networks");
  }
  if (!String(network.sourceHash || "").trim() || !String(network.networkHash || "").trim()) {
    throw new Error("branch-growth scene adapter requires retained source and network hashes");
  }
  if (!Array.isArray(network.segments) || network.segments.length !== network.segmentCount || network.segmentCount < 1) {
    throw new Error("branch-growth scene adapter requires an internally consistent non-empty segment set");
  }

  const ordered = [...network.segments].sort((a, b) => a.index - b.index);
  ordered.forEach((segment, index) => {
    if (!segment || segment.index !== index || typeof segment.id !== "string" || !segment.id) {
      throw new Error(`branch-growth adapter segment order/identity mismatch at index ${index}`);
    }
  });

  const scene = {
    version: 1,
    triangles: ordered.flatMap(segmentQuad),
  };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== network.segmentCount * 2) throw new Error("branch-growth scene adapter triangle count drifted");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-branch-growth-network-to-axm-scene/v1",
      source_hash: network.sourceHash,
      network_hash: network.networkHash,
      input_segment_count: network.segmentCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: scene.triangles.length,
      output_sha256: sha256(bytes),
      segment_order_is_retained_index_order: true,
      geometry_encodes_only_derived_network_endpoints: true,
      style_is_fixed: true,
      consumer_semantics_assigned: false,
      adapter_policy: "each positive-length derived segment becomes one fixed-width two-triangle strip; fixed albedo carries no root/tree/crack/vein/river/UI/game meaning and canonical VFX source/network state is not rewritten",
    },
  };
}

function sourceWithoutOffsets(source) {
  const copy = structuredClone(source);
  delete copy.branchOffsetsTurns;
  return copy;
}

export async function observeVisualEffectBranchGrowthNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    branchGrowth: resolve(rootPath, "hand-lab/src/branch-growth2d.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const branchGrowth = await import(`${pathToFileURL(paths.branchGrowth).href}?sha=${sources.branchGrowth.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(branchGrowth.BRANCH_GROWTH_2D_HANDS) || !branchGrowth.BRANCH_GROWTH_2D_GRAPH || typeof branchGrowth.makeBranchGrowth2dState !== "function") {
    throw new Error("VFX donor branch-growth graph is unavailable");
  }
  if (branchGrowth.BRANCH_GROWTH_2D_GRAPH.id !== "fx.growth.branching2d-static-svg" || branchGrowth.BRANCH_GROWTH_2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX branch-growth graph identity");
  }
  const expectedHands = [
    "fx.growth.branching2d-source-normalize",
    "fx.growth.branching2d-network-build",
    "fx.growth.branching2d-static-svg-realize",
  ];
  if (JSON.stringify(branchGrowth.BRANCH_GROWTH_2D_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX branch-growth Hand boundary");
  }

  const common = {
    id: "creative-render-branch-growth",
    origin: [0.5, 0.88],
    headingTurns: 0.75,
    baseLength: 0.18,
    lengthDecay: 0.64,
    generations: 5,
  };
  const requests = {
    symmetric: { ...common, branchOffsetsTurns: [-0.07, 0.07] },
    asymmetric: { ...common, branchOffsetsTurns: [-0.03, 0.11] },
  };

  const execute = (request, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(branchGrowth.BRANCH_GROWTH_2D_HANDS),
    graph: branchGrowth.BRANCH_GROWTH_2D_GRAPH,
    initialState: branchGrowth.makeBranchGrowth2dState(request),
    context: { callerKind },
  });

  const variants = {};
  for (const [name, request] of Object.entries(requests)) {
    const requestBytesBefore = stableBytes(request);
    const human = execute(request, "human");
    const machine = execute(request, "machine");
    if (human.finalStateHash !== machine.finalStateHash) throw new Error(`VFX branch-growth caller-neutral repeat verification failed for ${name}`);

    const finalState = human.finalState;
    const source = finalState.branchGrowthSource;
    const sourceHash = finalState.branchGrowthSourceHash;
    const network = finalState.branchGrowthNetworks?.[source?.id];
    const realization = finalState.realizations?.branchGrowthStaticSvg;
    if (!source || runtime.hashValue(source) !== sourceHash) throw new Error(`VFX branch-growth canonical source hash drifted for ${name}`);
    if (stableBytes(finalState.branchGrowthRequest).compare(requestBytesBefore) !== 0) throw new Error(`VFX branch-growth caller request mutated for ${name}`);
    if (!network || network.schema !== "axm.branch-growth-network2d/v0.1" || network.sourceHash !== sourceHash || network.derived !== true || network.rebuildable !== true) {
      throw new Error(`VFX branch-growth derived network boundary drifted for ${name}`);
    }
    if (network.segmentCount !== 31 || network.clippedSegmentCount !== 0) throw new Error(`VFX branch-growth bounded fixture topology drifted for ${name}`);
    if (!realization || realization.schema !== "axm.vfx.branch-growth-static-svg/v0.1" || realization.sourceHash !== sourceHash || realization.networkHash !== network.networkHash) {
      throw new Error(`VFX branch-growth SVG lineage drifted for ${name}`);
    }

    const normalized = branchGrowth.normalizeBranchGrowthSourceHand.execute(branchGrowth.makeBranchGrowth2dState(request));
    const exactBudget = branchGrowth.buildBranchGrowthNetworkHand.execute(normalized.state, { maxSegments: 31 }).state.branchGrowthNetworks[source.id];
    const roomyBudget = branchGrowth.buildBranchGrowthNetworkHand.execute(normalized.state, { maxSegments: 2048 }).state.branchGrowthNetworks[source.id];
    if (exactBudget.networkHash !== roomyBudget.networkHash || roomyBudget.networkHash !== network.networkHash) {
      throw new Error(`VFX branch-growth working-set budget changed derived topology for ${name}`);
    }
    let budgetFailure = null;
    try {
      branchGrowth.buildBranchGrowthNetworkHand.execute(normalized.state, { maxSegments: 30 });
    } catch (error) {
      budgetFailure = String(error?.message || error);
    }
    if (!budgetFailure?.includes("segment budget exceeded")) throw new Error(`VFX branch-growth insufficient budget did not fail loudly for ${name}`);
    if (runtime.hashValue(normalized.state.branchGrowthSource) !== sourceHash) throw new Error(`VFX branch-growth failed budget attempt rewrote canonical source for ${name}`);

    const adapted = branchGrowthNetworkToAxmScene(network);
    variants[name] = {
      request,
      requestBytes: requestBytesBefore,
      source,
      sourceBytes: stableBytes(source),
      network,
      networkBytes: stableBytes(network),
      svgBytes: Buffer.from(realization.content, "utf8"),
      stateBytes: stableBytes(finalState),
      adapted,
      finalStateHash: human.finalStateHash,
      budgetFailure,
      realization,
    };
  }

  if (JSON.stringify(sourceWithoutOffsets(variants.symmetric.source)) !== JSON.stringify(sourceWithoutOffsets(variants.asymmetric.source))) {
    throw new Error("branch-growth proof fixture changed canonical source fields other than explicit branch offsets");
  }
  if (variants.symmetric.source.branchOffsetsTurns.join(",") === variants.asymmetric.source.branchOffsetsTurns.join(",")) {
    throw new Error("branch-growth proof fixture did not exercise distinct caller-authored branch offsets");
  }
  if (variants.symmetric.source.branchGrowthSourceHash === variants.asymmetric.source.branchGrowthSourceHash) {
    throw new Error("branch-growth explicit source choice did not change source identity");
  }
  if (variants.symmetric.network.networkHash === variants.asymmetric.network.networkHash) {
    throw new Error("branch-growth explicit source choice did not change derived network identity");
  }
  if (variants.symmetric.adapted.bytes.compare(variants.asymmetric.adapted.bytes) === 0) {
    throw new Error("branch-growth distinct derived networks did not change native observation scene bytes");
  }

  const receiptVariants = Object.fromEntries(Object.entries(variants).map(([name, row]) => [name, {
    request_sha256: sha256(row.requestBytes),
    source: {
      schema: row.source.schema,
      hash: row.sourceHash ?? row.source.branchGrowthSourceHash ?? row.sourceHash,
      bytes_sha256: sha256(row.sourceBytes),
      branch_offsets_turns: row.source.branchOffsetsTurns,
      generations: row.source.generations,
    },
    network: {
      schema: row.network.schema,
      hash: row.network.networkHash,
      bytes_sha256: sha256(row.networkBytes),
      segment_count: row.network.segmentCount,
      clipped_segment_count: row.network.clippedSegmentCount,
      terminal_segment_count: row.network.terminalSegmentCount,
      derived: row.network.derived,
      rebuildable: row.network.rebuildable,
    },
    working_set_budget: {
      exact_31_matches_default_2048: true,
      insufficient_30_failed_loudly: true,
      insufficient_30_error: row.budgetFailure,
    },
    donor_svg: {
      schema: row.realization.schema,
      renderer: row.realization.renderer,
      bytes_sha256: sha256(row.svgBytes),
      source_hash: row.realization.sourceHash,
      network_hash: row.realization.networkHash,
      replaceable_realization: true,
    },
    native_scene: {
      bytes_sha256: sha256(row.adapted.bytes),
      adapter: row.adapted.observation,
    },
    final_state_sha256: sha256(row.stateBytes),
    caller_neutral_final_state_hash: row.finalStateHash,
  }]));

  // Bind source hash explicitly from the retained canonical source; the donor stores it beside rather than inside the source object.
  for (const [name, row] of Object.entries(variants)) receiptVariants[name].source.hash = row.network.sourceHash;

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: branchGrowth.BRANCH_GROWTH_2D_GRAPH.id,
      graph_version: branchGrowth.BRANCH_GROWTH_2D_GRAPH.version,
      hand_ids: expectedHands,
      files: {
        "hand-lab/src/hand-runtime.mjs": sources.runtime.sha256,
        "hand-lab/src/branch-growth2d.mjs": sources.branchGrowth.sha256,
      },
    },
    caller_authority: {
      explicit_choice: "branchOffsetsTurns",
      all_other_canonical_source_fields_held_constant: true,
      caller_requests_mutated: false,
      caller_neutral_repeat_verification: "PASS",
      canonical_growth_sources_remain_authoritative: true,
      derived_networks_are_canonical: false,
      donor_svg_is_canonical: false,
      native_scene_is_canonical: false,
      consumer_semantics_assigned: false,
    },
    variants: receiptVariants,
    replaceability: {
      same_derived_network_can_feed_donor_svg_and_native_scene_realizations: true,
      donor_svg_and_native_scene_do_not_rewrite_source_or_network_truth: true,
    },
    authority: "caller branch-growth requests and normalized VFX growth sources are authoritative; bounded networks are derived/rebuildable and SVG/native scene/render bodies remain replaceable observations",
    truth_boundary: {
      proven: "current VFX branching-growth graph execution, caller-neutral replay, explicit branch-offset source choice, bounded deterministic network lineage, budget-independence when sufficient, loud insufficient-budget failure, donor-SVG lineage and native Render Fabric scene eligibility from the same derived network",
      not_proven: ["tree/root/crack/vein/river/game/UI meaning", "organic realism", "aesthetic quality", "browser appearance", "motion or animation", "physical growth", "accessibility", "real-time performance", "GPU equivalence", "cross-machine bitwise determinism"],
    },
  };

  return {
    symmetricSourceBytes: variants.symmetric.sourceBytes,
    asymmetricSourceBytes: variants.asymmetric.sourceBytes,
    symmetricNetworkBytes: variants.symmetric.networkBytes,
    asymmetricNetworkBytes: variants.asymmetric.networkBytes,
    symmetricSvgBytes: variants.symmetric.svgBytes,
    asymmetricSvgBytes: variants.asymmetric.svgBytes,
    symmetricStateBytes: variants.symmetric.stateBytes,
    asymmetricStateBytes: variants.asymmetric.stateBytes,
    symmetricSceneBytes: variants.symmetric.adapted.bytes,
    asymmetricSceneBytes: variants.asymmetric.adapted.bytes,
    receipt,
  };
}
