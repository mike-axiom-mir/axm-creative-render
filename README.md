# AXM Creative Render

AXM Creative Render is an experimental bridge between **creative capability** and **render/world state**.

The core question is:

> Can creative capabilities operate directly on canonical renderer/world state, produce inspectable changed state or derived realizations, and leave exact evidence of what actually happened?

The long-term direction includes still renders, live game worlds, animation/video timelines, websites and other machine-visible creative surfaces without forcing a machine to imitate a human clicking through a GUI.

## v0.2 — live donor bridge

The repository now has two layers.

### 1. Native tiny scene operators

The dependency-free v0.1 path remains:

```text
AXM_SCENE 1 -> explicit creative operator -> AXM_SCENE 1 + AXM_CREATIVE_RECEIPT 1
```

Implemented local operators:

- `tint` — deterministic RGB channel scaling;
- `translate` — deterministic XYZ translation of every triangle vertex.

### 2. Explicit live donor observation and execution

`src/donor_bridge.mjs` and `src/donor_cli.mjs` add a deliberately explicit local bridge to current AXM creative bodies.

```text
Universal Creation Creative Flow
          |
   several real Hands
 create -> scale -> rotate -> inspect
          |
          v
  precision mesh state
          |
    explicit adapter
          v
      AXM_SCENE 1
          |
          v
    AXM Render Fabric
          |
      actual pixels
          |
    render receipt

Visual Effect Fabric Hand graph
          |
          v
canonical effect/anatomy state
          |
          v
state-native rebuildable GPU working set
          |
          v
derived WebGL realization + donor evidence
```

The integration workflow pins exact donor revisions and proves these paths rather than treating repository names as capability.

Current pinned donors for the v0.2 proof:

- `axm-render-fabric@6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- `axm-universal-creation@c5496a17b9580abf870432ed2fed324b86d1fa37`
- `axm-visual-effect-fabric@6639742ec3b909ae697dadb5b5290b94b41354a3`

The Universal Creation bridge observes the public `PlatformHands.creativeHands` audit/recipe registry and then executes a bounded `PlatformHands.creativeFlow` plan. That plan creates a cube, scales it, rotates it and inspects its bounds through existing Universal Creation Hands/recipes. Creative Render adapts only the final precision mesh into the currently tiny Render Fabric scene subset and hands that scene to the native renderer in CI.

The Visual Effect Fabric bridge executes the exported state-native holographic-AI Hand graph through the donor's own runtime. Creative Render records the exact donor source digests, graph/final-state evidence, working-set facts, and derived HTML realization. The effect implementation stays in Visual Effect Fabric.

Run local unit verification:

```bash
npm test
```

Run the donor snapshot when the donor repositories are already present locally:

```bash
node src/donor_cli.mjs snapshot \
  --uc-root ../axm-universal-creation \
  --vfx-root ../axm-visual-effect-fabric \
  --receipt build/donor-observation.json \
  --uc-scene build/uc-cube.axmscene \
  --vfx-state build/vfx-state.json \
  --vfx-html build/vfx-state-native.html
```

No network discovery or silent repository fetching occurs in the bridge itself. The caller supplies the donor paths.

## Why this matters

The experiment is no longer limited to two toy operations invented inside this repository.

Universal Creation now carries a large deterministic creative-Hand body spanning raster/masks/compositing, precision meshes, local modeling, sculpt/UV/topology work, deeper modeling, rigging and animation. Creative Render can begin treating that body as **callable creative machinery around rendering**, instead of duplicating it. The v0.2 proof already uses Creative Flow rather than pretending a single primitive call represents the larger system.

Visual Effect Fabric contributes the other half: deterministic special-effect Hand graphs with editable checkpoints and replaceable realizations, including a state-native holographic AI that already applies the `canonical state -> rebuildable working set -> small state deltas` direction.

That gives the experimental shape we actually wanted:

```text
creative Hands / effects / professions / machine intent
                       |
                       v
             CREATIVE RENDER BRIDGE
                       |
       canonical state + explicit adapters
                       |
              +--------+--------+
              |                 |
              v                 v
       Render Fabric       effect realization
              |                 |
            pixels           live visual
              |                 |
              +--------+--------+
                       |
                    evidence
```

## Donor / neighboring systems

- `mike-axiom-mir/axm-render-fabric` — active renderer/evidence substrate.
- `mike-axiom-mir/axm-universal-creation` — active executable creative-Hand / Creative Flow donor.
- `mike-axiom-mir/axm-visual-effect-fabric` — active special-effect and state-native VFX donor.
- `mike-axiom-mir/axm-framestate` — active temporal/frame/video donor for later work.
- `mike-axiom-mir/axm-profession-fabric` — professional procedures/evidence around tools, without automatic authority.
- `mike-axiom-mir/axm-floor-born` — exploratory later path for equal-interface creation from inside a live world.

See `DONORS.md`.

## Four roots

Internal adoption is gated by:

1. **Truth**
2. **Agency / non-domination**
3. **Continuity**
4. **Wisdom before speed**

No founder, model, profession body, renderer, donor repository, or Git permission is by itself the constitutional merge gate.

## Current truth boundary

v0.2 is still an **integration experiment**, not a finished creative studio or universal render-edit protocol.

It aims to prove three bounded facts:

1. local creative state can be changed deterministically and receipted;
2. one real bounded Universal Creation Creative Flow can create/transform a precision mesh, cross an explicit adapter into Render Fabric and become actual pixels;
3. one real Visual Effect Fabric state-native Hand graph can execute through its own donor runtime and return inspectable canonical/derived-state evidence.

It does **not** yet claim general Universal Creation compatibility, shared material/lighting/rig/animation contracts, direct VFX injection into Render Fabric, frame/post-process plugins, game-world mutation, FrameState video integration, AI visual judgment, professional acceptance, visual quality, GPU parity, cross-machine bitwise determinism, or autonomous creativity.

See `FOUNDATION.md`, `DONORS.md`, `docs/LIVE_DONOR_RENDER_BRIDGE.md`, and `docs/TRUTH_BOUNDARY.md`.
