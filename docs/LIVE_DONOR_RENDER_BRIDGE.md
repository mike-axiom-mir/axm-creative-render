# Live Donor / Render Bridge — v0.2

## Question

Can AXM Creative Render call useful creative machinery that already exists elsewhere, adapt only the state required by a proven boundary, and then show that the resulting state is actually executable by the rendering/effect body that owns it?

The v0.2 proof deliberately uses three different repositories without merging their authority or internal representations.

## Pinned proof inputs

The integration workflow pins:

- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- Universal Creation: `c5496a17b9580abf870432ed2fed324b86d1fa37`
- Visual Effect Fabric: `6639742ec3b909ae697dadb5b5290b94b41354a3`

A newer donor can be studied later, but changing one of these pins changes the experiment and must be reverified.

## Path A — Universal Creation -> Creative Render -> Render Fabric

The bridge loads only Universal Creation's public Platform Hands entry point from an explicitly supplied local repository path.

It observes:

- `creativeHands.version`;
- `creativeHands.audit()`;
- `creativeHands.recipeRegistry()`;
- executable invocation of `creative.mesh-primitive.cube`.

The returned precision mesh is checked for finite flat XYZ positions and valid indexed triangles. Creative Render then performs one **visible adapter step**:

```text
axm.precision-mesh/v1-like donor result
            |
            | explicit scale 0.62
            | fixed RGB [94,196,255]
            v
        AXM_SCENE 1
```

That adapter is intentionally lossy because current `AXM_SCENE 1` contains only triangle positions and one RGB albedo per triangle. UVs, richer materials, rigging, animation and other Universal Creation state are not silently projected into fields that do not exist.

The integration workflow then builds the pinned Render Fabric, constructs an `AXM_RENDER_REQUEST 1` selecting `axm.native.cpu.reference`, renders the adapted scene, emits an `AXM_RENDER_RECEIPT 1`, and runs Render Fabric's independent receipt replay verifier.

Passing this path means:

> one real Universal Creation creative Hand produced state that crossed an explicit adapter and became verified Render Fabric pixels.

It does not mean the two repositories now share a complete scene model.

## Path B — Visual Effect Fabric -> Creative Render donor evidence

The bridge loads two explicit Visual Effect Fabric modules from the supplied local donor path:

- `hand-lab/src/hand-runtime.mjs`
- `hand-lab/src/holographic-ai-state-native.mjs`

It executes the donor's exported `HOLOGRAPHIC_AI_STATE_NATIVE_GRAPH` using the donor's own `createHandRegistry()` and `executeHandGraph()` implementation.

The bridge requires the resulting realization to preserve these declared state-native properties:

- canonical state retained;
- derived GPU data rebuildable;
- a non-empty working set;
- derived HTML canvas realization;
- explicit renderer identity.

It records SHA-256 for the donor runtime source, effect module source, derived state JSON and derived HTML. The effect itself is not copied into Creative Render.

Passing this path means:

> Creative Render can explicitly invoke a real special-effect Hand graph and retain evidence about its canonical-state / derived-working-set boundary.

It does not mean Render Fabric can yet consume that effect state as a native render pass.

## `AXM_CREATIVE_DONOR_RECEIPT 1`

The donor snapshot CLI emits a local JSON evidence envelope containing:

- exact observed source-file SHA-256 values;
- Universal Creation Hand/recipe census and probe result facts;
- SHA-256 of the adapted `AXM_SCENE 1` body;
- Visual Effect graph ID/version and executed-stage count;
- final-state hash reported by the donor Hand runtime;
- state-native renderer / working-set facts;
- SHA-256 of output state and HTML bytes.

This receipt is a Creative Render experimental evidence record, not a claim that the donor repositories have adopted the format.

## Agency boundary

- Donor paths are explicit caller input.
- The bridge performs no network discovery or automatic checkout.
- Output paths are rejected if they sit inside either donor repository.
- No donor is modified.
- No donor grants permission, CANON or merge authority.
- No AI or professional body receives hidden execution authority.

## Continuity boundary

The workflow pins exact donor commits and records source/output digests so a later donor update cannot silently masquerade as the same experiment.

The long-term desired direction is contract compatibility, not permanent commit pinning. Pins are temporary experimental anchors while the shared boundaries are still being learned.

## Next gates

Useful next gates, in evidence order, are:

1. preserve the UC -> Render Fabric proof while adapting a richer mesh operation than one primitive;
2. define the smallest honest material/effect state intersection instead of stuffing special effects into triangle RGB;
3. let a Visual Effect Hand contribute an explicit render/effect pass only after Render Fabric has a versioned pass contract;
4. bridge Universal Creation rig/animation state toward FrameState or another temporal contract without inventing equivalence;
5. later test equal-interface live-world creative operations with Floorborn/game systems.
