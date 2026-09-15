# VFX state -> rendered frame composite — v0.5

## Question

Can a special effect remain canonical/editable in Visual Effect Fabric, cross an explicit bounded realization adapter, and then be composited onto pixels produced by Render Fabric using the same Universal Creation creative Hands available to other callers?

v0.5 tests one bounded path instead of inventing a universal render-pass protocol.

## Executable path

```text
Visual Effect Fabric
  fx.electric-storm Hand graph
          |
          +-- canonical paths / energy / width / layers
          +-- derived SVG retained as separate donor evidence
          |
          v
Creative Render bounded path raster adapter
          |
    effect PPM + raster receipt
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

## Bounded canonical-state raster adapter

The current electric donor exposes richer canonical state than its disposable SVG preview: normalized path points plus energy/width, alongside layer-module and motion intent. The current Render Fabric contract has no native electric-effect/pass contract yet, while Universal Creation's composite Hand consumes raster state.

v0.5 therefore adds a deliberately small Creative Render adapter:

- accepts only `axm.effect-work-state/v0.1` with 1..64 canonical paths;
- accepts 2..256 normalized points per path;
- uses integer Bresenham segment traversal;
- materializes a bounded cyan/white core+glow raster from path points, energy and width;
- caps dimensions at 4096 per axis and 4,194,304 pixels;
- emits P6 RGB8 plus `AXM_CREATIVE_VFX_RASTER_RECEIPT 1`;
- runs the same rasterization twice and requires byte-identical PPM evidence in the exercised runtime.

This adapter **does not** claim to implement the donor's AetherFX layer-module semantics, pulse timing, SVG Gaussian-blur filter behavior, or physical light interaction. Those richer fields remain retained in the donor state/source receipt rather than being silently called realized.

The donor's SVG stays in the proof pack as a separate derived realization and continuity check. It is no longer an implicit runtime dependency for the raster path.

## CI correction preserved

The first PR-head integration run passed all 18 Creative Render tests, all 33 Render Fabric tests, source rendering/receipt replay, and the real `fx.electric-storm` graph, then failed at the attempted ImageMagick SVG-rasterization step before a VFX raster was accepted.

That failure exposed an unearned environment dependency. The evidence did not establish why that external command returned failure, so this work does not invent a cause. Instead of installing or assuming the tool, the VFX raster gate was replaced with the bounded local canonical-state adapter above. The failed run remains part of the PR history; no test was weakened to hide it.

## Repeat gates

Two repeat gates are required:

1. the exact canonical electric state must materialize to identical effect PPM bytes twice;
2. the Universal Creation screen-composite + contrast flow must produce the same Creative Flow digest, output precision-raster digest and final PPM bytes twice.

The final composited PPM must differ from the source Render Fabric frame while retaining the same dimensions.

## Four-root gate

**Truth** — canonical VFX state, donor SVG, bounded path rasterization, UC compositing and final frame are separate evidence planes.

**Agency / non-domination** — the caller explicitly selects the effect graph seed, donor paths, adapter dimensions, blend mode/opacity and output; no donor gains hidden authority.

**Continuity** — source scene/render receipt, VFX state/SVG receipt, raster receipt, effect raster and final composite remain distinct and hash-bound.

**Wisdom before speed** — one well-evidenced electric effect proves the route before attempting a universal VFX/plugin abstraction or forcing an external raster dependency.

## Does not prove

- native Render Fabric effect-pass integration;
- WebGPU/GPU shader composition;
- complete realization of Visual Effect Fabric layer-module semantics;
- physical lighting interaction with the 3D scene;
- alpha-preserving interchange through PPM;
- general compatibility with every Visual Effect Fabric family;
- artistic or professional visual quality;
- temporal VFX across video/game frames;
- FrameState integration;
- live game-world effect insertion;
- cross-machine bitwise determinism.
