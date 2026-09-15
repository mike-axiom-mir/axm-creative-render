# Direct sample + render bridge v0.11

## Question

Can one renderer-consumable scene state feed both the owned AXM renderer and a newer Visual Effect Fabric realization without either derived body becoming the source of truth?

v0.11 tests the smallest useful version of that question.

## Executable path

The proof uses the pinned current donor bodies:

- Universal Creation `c89839485a6d09a3e70dbd633c5f1292348f37b1`
- Visual Effect Fabric `bed7e20374e27b8a6edc1772c606232b196a5869`
- Render Fabric `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

The path is:

`UC Creative Flow precision mesh -> AXM_SCENE 1`

then the exact same scene bytes split into two explicit derived paths:

1. `AXM_SCENE 1 -> Render Fabric native CPU renderer -> PPM + render receipt + replay verification`
2. `AXM_SCENE 1 -> bounded packed stride-7 sample adapter -> VFX fx.holographic-state-projector-direct-sample -> HTML/WebGL realization`

Creative Render SHA-256-binds the source scene, VFX state/realization, render request, Render Fabric receipt and rendered frame into one evidence record after the native receipt verifier passes.

## Direct-sample adapter

The adapter does not pretend that `AXM_SCENE 1` and the VFX sample field are the same contract.

For each admitted triangle it emits:

- the three exact triangle vertices;
- a caller-fixed number of deterministic barycentric surface samples;
- point size, role, phase and intensity fields required by the VFX packed sample contract.

v0.11 defaults to 24 interior samples per triangle and at most 512 triangles. It fails closed if the resulting working set would exceed the current VFX 24,000-point ceiling.

The exact SHA-256 of the complete AXM scene bytes is retained as `sourceDigest` through VFX direct-sample admission. If the adapter admits only a bounded subset, that fact remains explicit while the digest still identifies the complete caller source from which the projection was derived.

## Deliberately omitted semantics

`AXM_SCENE 1` currently contains ordered triangles and RGB albedo. The holographic stride-7 projection has no matching material/albedo contract in this bridge. v0.11 therefore records `albedo_semantics_projected: false` rather than converting color into an undocumented role/intensity meaning.

Normals, UVs, rich materials, rigging, animation clips and lighting semantics are not present in `AXM_SCENE 1` and are not invented here.

## Authority

The source scene remains caller-owned scene state.

The VFX sample field is **derived, editable, rebuildable projection state**. The VFX donor owns its Hand graph and realization behavior, but it does not become authoritative over the source scene.

Render Fabric pixels are also derived output. A successful render receipt proves the exercised render output is bound to its request/scene bytes under Render Fabric's current evidence rules; it does not promote pixels into canonical scene truth.

## Four-root gate

- **Truth:** source bytes, sample adapter, VFX state, VFX realization, render request, render receipt and render pixels remain separately inspectable and hash-bound.
- **Agency / non-domination:** both derived bodies are explicit. No renderer or effect system silently rewrites source scene authority.
- **Continuity:** the exact AXM scene SHA-256 must survive into the VFX source identity while the same scene file is independently exercised through Render Fabric receipt replay.
- **Wisdom before speed:** this proves one shared-state/two-projection path before attempting whole-world conversion, automatic semantic material mapping, native VFX render passes or cross-system state morphing.

## Truth boundary

A passing v0.11 proof does **not** establish:

- visual or artistic quality;
- pixel equivalence between the native PPM and the WebGL holographic realization;
- physical holography or reconstructed continuous surfaces;
- preservation of albedo/material/normal/UV semantics in the VFX sample field;
- arbitrary whole-game-world conversion;
- performance or memory superiority;
- browser/GPU parity;
- cross-machine bitwise determinism.

It proves only that one exact renderer-consumable AXM scene can remain the source identity while two independently derived visual bodies are successfully exercised from it.
