# Donor Map

This file records why neighboring AXM repositories are relevant. A donor entry is **not** authority, CANON, an automatic runtime dependency, or a claim that every donor representation should become a Creative Render contract.

The v0.2 rule is stricter than a vague architectural reference: executable donor bridges use **explicit local repository paths**, observe exact source bytes, and keep donor-owned formats separate until an adapter is proven.

## `axm-render-fabric` — ACTIVE INTEROPERABILITY TARGET

Why it matters:

- owns the AXM native render substrate;
- owns renderer-neutral scene/request/capability/receipt work;
- exercises multiple renderer bodies and real external renderers;
- provides the smallest real place to prove that creative state changes become pixels.

Current Creative Render relationship:

- the v0.1 scene operator independently implements the documented minimal `AXM_SCENE 1` triangle/albedo syntax;
- v0.2 integration CI builds a pinned Render Fabric revision, renders an `AXM_SCENE 1` body adapted from a real Universal Creation mesh, emits a Render Fabric receipt, and independently replay-verifies it;
- no Render Fabric source is copied into Creative Render.

Boundary: current `AXM_SCENE 1` is intentionally tiny. A precision mesh can be adapted into its triangle subset, but that does not mean the full Universal Creation mesh/material/rig/animation body fits the current Render Fabric scene contract.

## `axm-universal-creation` — ACTIVE EXECUTABLE CREATION DONOR

Universal Creation has grown substantially beyond the donor map used for Creative Render v0.1. Its public `PlatformHands.creativeHands` surface now aggregates deterministic creative microtools across raster/masks/compositing, precision meshes, local face/edge/vertex modeling, sculpt/UV/topology/modifiers, deeper modeling, rigging and animation. Its separate `creativeFlow` surface can execute bounded multi-Hand plans without making an AI the capability owner.

The pinned v0.2 integration donor is:

`mike-axiom-mir/axm-universal-creation@c5496a17b9580abf870432ed2fed324b86d1fa37`

That revision follows merged rigging/animation Wave 10. The bridge observes the public creative-Hand audit/recipe registry and invokes the real `creative.mesh-primitive.cube` Hand. The resulting precision mesh is adapted into the tiny Render Fabric `AXM_SCENE 1` triangle subset, then rendered by Render Fabric in integration CI.

Potential later Creative Render use:

- call existing creative Hands as state operators instead of reimplementing their algorithms;
- consume Creative Flow as a bounded multi-operator planning/execution surface;
- bridge materials, masks, effects, mesh editing, rigging and animation only when shared contracts are earned;
- expose capability gaps when a requested render/world operation has no truthful adapter.

Boundary: Universal Creation remains standalone and authoritative for its own Hand/mesh/rig/animation semantics. Creative Render v0.2 proves one explicit local public-service call plus one mesh-to-scene adapter; it does **not** claim general UC format compatibility or copy the 388-Hand body into this repository.

## `axm-visual-effect-fabric` — ACTIVE SPECIAL-EFFECT DONOR

Visual Effect Fabric is now a first-class donor rather than an implied future effects source.

Useful observed work includes:

- caller-neutral deterministic Hand graphs with hashed editable checkpoints;
- electric-storm and holographic effect families;
- volumetric hologram state and replaceable realizations;
- an original procedural holographic AI;
- a state-native holographic-AI realization that keeps canonical anatomy/effect state separate from a rebuildable GPU point working set and changes semantic behavior through small state/uniform deltas.

The pinned v0.2 integration donor is:

`mike-axiom-mir/axm-visual-effect-fabric@6639742ec3b909ae697dadb5b5290b94b41354a3`

Creative Render executes the donor's exported `fx.holographic-ai-entity-state-native` Hand graph through the donor's own Hand runtime. It records source digests, final-state evidence, state-native working-set facts, and the derived HTML realization without copying the effect implementation into Creative Render.

Potential later use:

- effect operators before/during/after render;
- state-native live special effects in games/worlds;
- effect checkpoints that a human UI or machine can edit and replay downstream;
- bridge effect state into renderer passes once Render Fabric has an earned effect/pass contract.

Boundary: v0.2 does **not** inject the holographic effect into the native Render Fabric frame. The effect still realizes through its own state-native WebGL path. Executing and receipting the donor graph proves an explicit bridge, not a shared render-pass contract or universal visual quality.

## `axm-framestate` — ACTIVE TEMPORAL / FRAME DONOR

Useful directions include canonical state through time, deterministic frame rendering and per-frame evidence, effect organs and bounded pixel programs, compositing, masks, camera, animation, 3D, audio/video export, and exact/adaptive realization separation.

Potential Creative Render use:

- temporal creative operators;
- frame/pixel operators;
- animation/video operators;
- rendering/creative passes that retain exact state/evidence lineage;
- a later bridge from Universal Creation rig/clip state into temporal realization, only after an explicit contract exists.

Boundary: the current live bridge is still-scene + donor-effect evidence. No FrameState project/effect format is consumed yet.

## `axm-profession-fabric` — ACTIVE PROFESSIONAL-KNOWLEDGE DONOR

Profession Fabric already contains creative-media and game-development bodies plus scoped tested work in 3D/technical art among the wider fabric.

Potential Creative Render use:

- attach professional procedures/evidence standards to operator use;
- separate "tool executed" from "professional result accepted";
- later compose art direction, 3D/technical art, cinematography, video editing, gameplay/world and QA bodies around the same operator substrate.

Boundary: a Professional Body may advise, evaluate or structure work; it never receives automatic authority to mutate user/world state. Repository maturity labels remain their own evidence and are not upgraded here.

## `axm-floor-born` — EXPLORATORY LIVE-WORLD DONOR

Why it may matter later:

- Floorborn studies machine participation through an ordinary bounded player slot;
- world-facing visibility/actions/consequences are equalized instead of granting a privileged hidden agent channel;
- replayable receipts and retained causal state already exist.

Potential Creative Render question:

> Can a machine create from *inside* a live game/world through an ordinary legal creation/player interface, while a human can use a visual UI over the same underlying operations?

This could matter for live game worlds, machinima, world building or cooperative creation.

Boundary: Floorborn is not needed for the current render/effect bridge. No player protocol is imported. If later used, creative authority must be explicit world/product state, not an invisible privileged path.

## Not yet added as a dependency

`axm-profession-mesh` remains outside the current experiment. Profession Fabric is enough to study professional-body composition first; distribution/mesh belongs after a real operator/profession handoff exists.
