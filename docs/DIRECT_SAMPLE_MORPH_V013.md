# Direct sample morph v0.13

## Question

v0.11 proved that one exact `AXM_SCENE 1` could become direct VFX sample state while remaining the source identity for an independent native render. v0.12 then reused current VFX shell Hands around that admitted sample state without pretending the scene had first become a VFX primitive.

v0.13 asks the next narrow question:

> Can two distinct AXM scene states remain separately identifiable while the current Visual Effect Fabric state-morph machinery builds one deterministic derived transition body between them?

## Executable path

The dedicated proof uses two real Universal Creation animation samples:

`UC rig/clip -> exact AXM scene at t=0 -> direct sample field A`

`UC rig/clip -> exact AXM scene at t=2 -> direct sample field B`

Those two derived fields enter the pinned Visual Effect Fabric `fx.holographic-state-morph` graph:

`sample-field-morph-prepare -> state-morph-webgl`

The resulting morph state and HTML must preserve both exact AXM scene SHA-256 identities. The same two source scene files are independently rendered and receipt-verified through the owned native Render Fabric.

## Pinned proof bodies

- Universal Creation: `c89839485a6d09a3e70dbd633c5f1292348f37b1`
- Visual Effect Fabric: `bed7e20374e27b8a6edc1772c606232b196a5869`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

## Pairing policy

The donor's current morph preparation policy is:

`deterministic-spatial-order-v0.1`

It spatially orders the derived sample points and resamples the shorter side when point counts differ. That is useful executable geometry pairing, but it is **not semantic correspondence**. A point paired between the two states is not proven to be the same vertex, bone, material feature, object, or semantic body location.

The receipt therefore records the pairing policy, point counts, whether either side was resampled, both source digests, the final state hash, and the HTML digest.

## Authority boundaries

- Both `AXM_SCENE 1` inputs remain caller/source state.
- Both direct sample fields are derived and rebuildable projection state.
- The VFX morph field is derived working state.
- The WebGL/HTML morph is derived realization.
- Render Fabric pixels are independent derived output from each exact source scene.
- No morph output becomes canonical source truth.

## Four-root gate

- **Truth:** both source scene identities, both sample adapters, donor pairing policy, morph state, morph HTML, native render requests, receipts and frames remain separately inspectable.
- **Agency / non-domination:** neither endpoint is silently rewritten into the other's authority domain; VFX performs an explicit derived morph only.
- **Continuity:** both exact scene SHA-256 identities must survive into the morph state while each source independently passes Render Fabric receipt replay.
- **Wisdom before speed:** prove one bounded deterministic state-to-state morph before claiming semantic deformation, arbitrary world morphing, continuous simulation or universal transition logic.

## Truth boundary

A passing v0.13 proof does not establish:

- semantic vertex/object/bone correspondence;
- topology-aware deformation;
- skeletal animation interpolation;
- continuous reconstructed surfaces or physical morphing;
- material, albedo, normal, UV, skin or animation-clip preservation inside morph state;
- visually pleasing or cinematic transitions;
- arbitrary whole-world conversion;
- cross-machine bitwise determinism.

It proves only that two distinct exact AXM scene identities can be adapted into bounded direct sample fields, consumed by the current real VFX state-morph Hands, repeated deterministically in the pinned environment, and independently rendered/verified through the owned native renderer.
