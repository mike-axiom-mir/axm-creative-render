# Donor Map

This file records why neighboring AXM repositories are relevant. A donor entry is **not** a runtime dependency, code import, authority grant, or claim of compatibility.

## `axm-render-fabric` — ACTIVE INTEROPERABILITY TARGET

Why it matters:

- owns the native render substrate;
- owns renderer-neutral scene/request/capability/receipt work;
- already exercises multiple render bodies and external renderers;
- provides the smallest real place to prove that creative state changes can become pixels.

v0.1 relationship:

- Creative Render independently implements the documented minimal `AXM_SCENE 1` triangle/albedo syntax.
- No Render Fabric source code is copied.
- No claim is made yet that Render Fabric CI consumes Creative Render output. That should become a separate executable integration gate.

## `axm-universal-creation` — ACTIVE CREATION DONOR

Useful observed directions include persistent creation machinery for humans and AI, deterministic organs/capabilities, creation decomposition and capability-gap handling, asset atom/package structures, detached candidate creation/testing, explicit provenance and four-root adoption.

Potential Creative Render use:

- represent creative tools as portable operators/organs;
- translate creation outputs into scene/material/effect operations;
- reuse capability-gap thinking when a requested visual change has no operator.

Boundary: Universal Creation remains standalone. Creative Render does not claim compatibility with its organ or asset formats yet.

## `axm-framestate` — ACTIVE TEMPORAL / FRAME DONOR

Useful observed directions include canonical state through time, deterministic frame rendering and per-frame evidence, effect organs and bounded pixel programs, compositing, masks, camera, animation, 3D, audio and video export, and exact/adaptive realization separation.

Potential Creative Render use:

- temporal creative operators;
- frame/pixel operators;
- animation/video operators;
- rendering/creative passes that retain exact state/evidence lineage.

Boundary: v0.1 is still-scene state only. No FrameState project/effect format is consumed yet.

## `axm-profession-fabric` — ACTIVE PROFESSIONAL-KNOWLEDGE DONOR

Useful observed bodies already include game-development and creative-media domains, with scoped tested work in 3D/technical art among the wider fabric.

Potential Creative Render use:

- attach professional procedures/evidence standards to operators;
- separate "tool can execute" from "professional result accepted";
- later compose art direction, 3D/technical art, cinematography, video editing, gameplay/world and QA bodies around the same operator substrate.

Boundary: a Professional Body may advise, evaluate or structure work; it never receives automatic authority to mutate user/world state. Repository maturity labels remain their own evidence and are not upgraded here.

## `axm-floor-born` — EXPLORATORY LIVE-WORLD DONOR

Why it may matter later:

- Floorborn already studies machine participation through an ordinary bounded player slot;
- world-facing visibility/actions/consequences are equalized instead of granting a privileged hidden agent channel;
- replayable receipts and retained causal state already exist.

Potential Creative Render question:

> Can a machine create from *inside* a live game/world through an ordinary legal creation/player interface, while a human can use a visual UI over the same underlying operations?

This could matter for live game worlds, machinima, world building or cooperative creation.

Boundary: Floorborn is not needed for the first still-render experiment. No player protocol is imported in v0.1. If later used, creative authority must be explicit world/product state, not an invisible privileged path.

## Not yet added as a dependency

`axm-profession-mesh` is intentionally not part of v0.1. Profession Fabric is enough to study professional-body composition first; distribution/mesh can be considered only after a real operator/profession handoff exists.
