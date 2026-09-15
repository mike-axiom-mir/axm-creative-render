# Donor refresh v0.10

## Purpose

Creative Render is an integration laboratory. Its donor proofs should periodically be rerun against newer *pinned* revisions of the machines it composes rather than silently assuming that old compatibility evidence still applies.

This refresh does not copy Universal Creation or Visual Effect Fabric into Creative Render. It changes only the revisions exercised by the existing live-donor and VFX-frame integration lanes.

## Pinned candidates

- Universal Creation: `c89839485a6d09a3e70dbd633c5f1292348f37b1`
- Visual Effect Fabric: `bed7e20374e27b8a6edc1772c606232b196a5869`
- Render Fabric remains: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

At the pinned Universal Creation revision, the public creative service still composes the rigging, UV/material and finishing registries and exposes the current 501 executable Hands / 508 callable recipes surface. The refresh deliberately checks that existing Creative Render flows continue to operate through that public service rather than reaching into new internal implementation details.

The pinned Visual Effect Fabric revision includes the newer holographic projector work and its projected-shell realization changes. The refresh keeps Creative Render's authority boundary unchanged: VFX owns its effect/projector state and realization; Creative Render only adapts/binds explicit outputs.

## Required executable gates

The refreshed `live-donor-render-bridge` must still prove:

1. Universal Creation Creative Flow creates/scales/rotates/inspects a precision mesh through public Hands.
2. The same mesh-derived holographic form remains identifiable through the generic Visual Effect Fabric projector.
3. VFX retains canonical-form state and a rebuildable derived GPU working set.
4. The UC-produced AXM scene still renders through the pinned native Render Fabric and its receipt verifier.

The refreshed `vfx-frame-composite` must still prove:

1. the real VFX electric Hand graph executes and repeats;
2. its canonical effect state is materialized through the bounded Creative Render raster adapter;
3. the exact Render Fabric frame and exact effect raster are composited using public Universal Creation Hands;
4. the composite repeats and changes the source frame bytes;
5. no donor repository is rewritten by the proof.

## Four-root gate

- **Truth:** newer donor compatibility is not assumed. CI must execute the pinned revisions before this refresh may merge.
- **Agency / non-domination:** all donor revisions and operations remain explicit; no donor gains hidden authority over another.
- **Continuity:** the existing contracts, receipts, hashes and renderer verification remain in the path while donor revisions change.
- **Wisdom before speed:** this refresh validates known paths against newer bodies before Creative Render starts depending on additional new donor capabilities.

## Truth boundary

Passing these lanes would prove compatibility only for the exercised bounded paths. It would not prove compatibility with every one of Universal Creation's Hands, every VFX graph/realization, all future donor revisions, visual quality, performance, or cross-machine bitwise determinism.
