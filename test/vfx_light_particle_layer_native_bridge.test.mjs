import assert from "node:assert/strict";
import test from "node:test";

import { lightParticleLayerPlanToAxmScene } from "../src/vfx_light_particle_layer_native_bridge.mjs";

const triangle = (x, albedo) => ({ vertices: [[x, 0, 0], [x + 0.1, 0, 0], [x, 0.1, 0]], albedo });
const observers = {
  lightRays: { scene: { version: 1, triangles: [triangle(-0.5, [80, 80, 80]), triangle(-0.3, [120, 120, 120])] } },
  particles: { scene: { version: 1, triangles: [triangle(0.3, [236, 174, 76])] } },
};

function plan(orderMode) {
  const ids = orderMode === "rays-under-particles" ? ["light-rays", "particles"] : ["particles", "light-rays"];
  return {
    schema: "axm.effect-layer-plan2d/v0.1",
    contract: "independent-light-ray-and-particle-render-order-plan2d",
    coordinateSpace: "normalized-2d",
    layerAuthority: "derived-order-only",
    blendModeAuthority: "none",
    opacityAuthority: "none",
    materialAuthority: "none",
    rendererAuthority: "none",
    consumerAuthority: "none",
    geometryMutation: "none",
    sourceMerge: "none",
    id: "test-plan",
    orderMode,
    layers: ids.map((layerId) => ({ layerId })),
    derived: true,
    rebuildable: true,
    planHash: `${orderMode}-hash`,
  };
}

test("native layer-plan adapter preserves exact donor group order without assigning blend/material meaning", () => {
  const under = lightParticleLayerPlanToAxmScene(plan("rays-under-particles"), observers, { maxTriangles: 3 });
  const over = lightParticleLayerPlanToAxmScene(plan("particles-under-rays"), observers, { maxTriangles: 3 });
  assert.deepEqual(under.observation.groups.map((group) => group.layer_id), ["light-rays", "particles"]);
  assert.deepEqual(over.observation.groups.map((group) => group.layer_id), ["particles", "light-rays"]);
  assert.equal(under.observation.output_triangles, 3);
  assert.equal(over.observation.output_triangles, 3);
  assert.notEqual(under.bytes.toString("utf8"), over.bytes.toString("utf8"));
  for (const observation of [under.observation, over.observation]) {
    assert.equal(observation.source_geometry_mutated, false);
    assert.equal(observation.blend_mode_assigned, false);
    assert.equal(observation.opacity_assigned, false);
    assert.equal(observation.material_meaning_assigned, false);
    assert.equal(observation.depth_meaning_assigned, false);
    assert.equal(observation.consumer_semantics_assigned, false);
    assert.equal(observation.canonical_source_rewritten, false);
    assert.equal(observation.layer_order_consumed_from_donor_plan, true);
    assert.equal(observation.derived, true);
    assert.equal(observation.replaceable, true);
  }
});

test("observer capacity is structural: roomy matches exact and one-below fails closed", () => {
  const candidate = plan("rays-under-particles");
  const exact = lightParticleLayerPlanToAxmScene(candidate, observers, { maxTriangles: 3 });
  const roomy = lightParticleLayerPlanToAxmScene(candidate, observers, { maxTriangles: 99 });
  assert.deepEqual(exact.bytes, roomy.bytes);
  assert.throws(() => lightParticleLayerPlanToAxmScene(candidate, observers, { maxTriangles: 2 }), /triangle budget exceeded/);
});

test("adapter refuses order drift, extra layers, and unsupported layer families", () => {
  const drifted = plan("rays-under-particles");
  drifted.layers.reverse();
  assert.throws(() => lightParticleLayerPlanToAxmScene(drifted, observers), /disagrees with donor orderMode/);

  const extra = plan("rays-under-particles");
  extra.layers.push({ layerId: "light-rays" });
  assert.throws(() => lightParticleLayerPlanToAxmScene(extra, observers), /exactly two donor layers/);

  const unknown = plan("rays-under-particles");
  unknown.layers[1] = { layerId: "fog" };
  assert.throws(() => lightParticleLayerPlanToAxmScene(unknown, observers), /disagrees with donor orderMode/);
});
