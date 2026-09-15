# VFX state -> rendered frame composite — v0.5

## Question

Can a special effect remain canonical/editable in Visual Effect Fabric, cross an explicit realization boundary, and then be composited onto pixels produced by Render Fabric using the same Universal Creation creative Hands available to other callers?

v0.5 tests one bounded path instead of inventing a universal render-pass protocol.

## Executable path

```text
Visual Effect Fabric
  fx.electric-storm Hand graph
          |
          +-- canonical paths / layers / checkpointed state
          |
          v
   derived SVG realization
          |
  evidenced ImageMagick boundary
          v
      effect PPM
          |
          |                      AXM_SCENE 1
          |                           |
          |                     Render Fabric
          |                           |
          |                    verified source PPM
          |                           |
          +-------------+-------------+
                        |
                        v
          Universal Creation Creative Flow
                        |
          creative.composite.screen
                        |
          creative.adjust.contrast
                        |
                        v
                 composited PPM
                        |
       AXM_CREATIVE_VFX_COMPOSITE_RECEIPT 1
```

The electric-storm implementation remains owned by Visual Effect Fabric. Creative Render executes its exported Hand graph through the donor's own runtime and records exact runtime/effect-source hashes plus final-state and SVG evidence.

Universal Creation remains the creative-tool donor. Creative Render does not copy the screen-blend or contrast algorithms; it supplies explicit precision-raster state to the public `PlatformHands.creativeFlow` surface.

## Pinned proof bodies

- Visual Effect Fabric: `6639742ec3b909ae697dadb5b5290b94b41354a3`
- Universal Creation: `30d62f80c84732dbeebd1e58984525b3f8ec1d60`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

## External SVG rasterization boundary

The current electric proof already provides a deterministic derived SVG, while Universal Creation's composite Hand consumes raster state. v0.5 therefore uses the runner's ImageMagick `convert` executable as an explicit bridge.

The workflow records:

- the resolved rasterizer executable path;
- SHA-256 of those executable bytes;
- the tool's reported version text;
- SHA-256 of the canonical VFX SVG;
- SHA-256 of the materialized effect PPM.

The rasterizer evidence is itself SHA-256-bound into the final composite receipt.

This does **not** upgrade ImageMagick into a canonical AXM renderer, prove all of its loaded libraries/delegates, or claim cross-machine raster equality. The boundary is named rather than hidden.

## Repeat gate

The Universal Creation screen-composite + contrast flow is executed twice over the exact same base/effect raster state. Acceptance requires the same:

- Creative Flow digest;
- output precision-raster digest;
- PPM bytes.

The final PPM must differ from the source Render Fabric frame while retaining the same dimensions.

## Four-root gate

**Truth** — canonical VFX state, SVG realization, external SVG rasterization, UC compositing and final frame are separate evidence planes.

**Agency / non-domination** — the caller explicitly selects the effect graph seed, donor paths, rasterizer boundary, blend mode/opacity and output; no donor gains hidden authority.

**Continuity** — source scene/render receipt, VFX state/SVG receipt, rasterizer evidence, effect raster and final composite remain distinct and hash-bound.

**Wisdom before speed** — one well-evidenced electric effect proves the route before attempting a universal VFX/plugin abstraction.

## Does not prove

- native Render Fabric effect-pass integration;
- WebGPU/GPU shader composition;
- physical lighting interaction with the 3D scene;
- alpha-preserving interchange through PPM;
- deterministic ImageMagick SVG rasterization across machines;
- general compatibility with every Visual Effect Fabric family;
- artistic or professional visual quality;
- temporal VFX across video/game frames;
- FrameState integration;
- live game-world effect insertion.
