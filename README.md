# AXM Creative Render

AXM Creative Render is an experimental bridge between **creative capability** and **render/world state**.

The core question is:

> Can creative capabilities operate directly on canonical renderer/world state, produce inspectable changed state or derived realizations, and leave exact evidence of what actually happened?

The long-term direction includes still renders, live game worlds, animation/video timelines, websites and other machine-visible creative surfaces without forcing a machine to imitate a human clicking through a GUI.

## v0.3 — temporal sampled render bridge

v0.3 adds the first bounded **creation-through-time -> renderer** proof.

A pinned Universal Creation revision with its merged rigging/animation and UV/material-production waves is asked to build one explicit rigged cube, create one two-second animation clip, bind the mesh, sample that clip at three times, deform the mesh at each sampled pose, and expose the resulting geometry through the same deterministic Creative Flow surface used by v0.2.

```text
Universal Creation Creative Flow
          |
  skeleton + mesh + clip + skin
          |
     sample t=0 / 1 / 2
          |
      deformed meshes
          |
   explicit lossy adapter
          v
     AXM_SCENE 1 x 3
          |
          v
     Render Fabric
          |
      pixels x 3
          |
 render receipts + combined evidence
```

`src/temporal_uc_bridge.mjs` owns the caller-side rig/clip request and the bounded temporal sampling bridge. `src/temporal_cli.mjs` repeats the complete sampling pass and refuses the proof if the repeated scene hashes or flow digests drift. It writes one renderer-neutral request per scene. `src/temporal_render_verify.mjs` then binds the scene/request/output/receipt files into one temporal evidence set after Render Fabric independently verifies every render receipt.

The dedicated workflow pins:

- `axm-universal-creation@30d62f80c84732dbeebd1e58984525b3f8ec1d60` — merged Wave 11, currently 441 executable creative Hands / 448 callable recipes;
- `axm-render-fabric@6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b` — the existing renderer-neutral evidence substrate.

The `AXM_SCENE 1` adapter remains deliberately lossy. It carries the sampled triangle positions and a bounded albedo into the current tiny renderer contract while explicitly recording that normals, UVs, materials, skin, skeleton and animation-clip semantics are omitted. The richer Universal Creation state stays with its donor; it is not silently flattened and redefined as equivalent.

This is **sampled temporal rendering**, not video. It proves that different canonical animation samples can become different verified rendered frames. It does not yet establish continuous-time correctness between samples, video encoding, temporal effects, FrameState compatibility, material preservation or a game-world runtime loop.

## v0.2 — live donor bridge

The repository also retains two earlier layers.

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

Run the temporal sampler when Universal Creation is already present locally:

```bash
node src/temporal_cli.mjs sample \
  --uc-root ../axm-universal-creation \
  --out-dir build/temporal \
  --receipt build/temporal/temporal.receipt.json \
  --times 0,1,2
```

No network discovery or silent repository fetching occurs in the bridge itself. The caller supplies the donor paths.

## Why this matters

The experiment is no longer limited to two toy operations invented inside this repository.

Universal Creation now carries a large deterministic creative-Hand body spanning raster/masks/compositing, precision meshes, local modeling, sculpt/UV/topology work, deeper modeling, rigging, animation and UV/material/texture production. Creative Render can begin treating that body as **callable creative machinery around rendering**, instead of duplicating it. The v0.2 proof uses Creative Flow for spatial creation; v0.3 proves that the same machine-facing substrate can also provide sampled animated geometry to rendering.

Visual Effect Fabric contributes another side: deterministic special-effect Hand graphs with editable checkpoints and replaceable realizations, including a state-native holographic AI that already applies the `canonical state -> rebuildable working set -> small state deltas` direction.

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
- `mike-axiom-mir/axm-framestate` — active temporal/frame/video donor for a later continuous timeline/video bridge; v0.3 does not claim FrameState integration.
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

v0.3 is still an **integration experiment**, not a finished creative studio, animation engine, game engine or universal render-edit protocol.

It aims to prove four bounded facts:

1. local creative state can be changed deterministically and receipted;
2. one bounded Universal Creation Creative Flow can create/transform a precision mesh, cross an explicit adapter into Render Fabric and become actual pixels;
3. one Visual Effect Fabric state-native Hand graph can execute through its own donor runtime and return inspectable canonical/derived-state evidence;
4. one explicit Universal Creation rig/clip can be sampled at several times, deformed through Creative Flow, adapted into distinct `AXM_SCENE 1` bodies, rendered into distinct frames and independently receipt-verified.

It does **not** yet claim general Universal Creation compatibility, shared material/lighting/UV/rig/animation contracts, direct VFX injection into Render Fabric, frame/post-process plugins, continuous video, game-world mutation, FrameState integration, AI visual judgment, professional acceptance, visual quality, GPU parity, cross-machine bitwise determinism, or autonomous creativity.

See `FOUNDATION.md`, `DONORS.md`, `docs/LIVE_DONOR_RENDER_BRIDGE.md`, `docs/TRUTH_BOUNDARY.md`, and the temporal workflow/evidence outputs.
