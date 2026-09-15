# Post-render Creative Hand bridge — v0.4

## Question

Can the machine use the same deterministic creative tools that exist in Universal Creation **directly on pixels produced by Render Fabric**, instead of imitating a human operating a separate image editor?

v0.4 tests the smallest real version of that question.

## Executable path

```text
AXM_SCENE 1
    |
    v
Render Fabric native renderer
    |
    +-- render receipt -> independent replay verification
    |
    v
ppm-rgb8 frame
    |
explicit PPM <-> axm.precision-raster/v1 adapter
    |
    v
Universal Creation Creative Flow
    |
    +-- creative.adjust.tint
    +-- creative.adjust.contrast
    |
    v
styled axm.precision-raster/v1
    |
    v
ppm-rgb8 output
    |
AXM_CREATIVE_POST_RENDER_RECEIPT 1
```

The Universal Creation donor remains external and explicit. Creative Render does not copy the tint or contrast algorithms. It supplies one caller-owned precision-raster state to the donor's public `PlatformHands.creativeFlow` surface and records the donor's step receipts.

## Pinned proof bodies

- Universal Creation: `30d62f80c84732dbeebd1e58984525b3f8ec1d60`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

At the pinned Universal Creation revision the public body reports 441 executable creative Hands and 448 callable recipes. The proof deliberately uses only two exact operations rather than implying that every Hand is already meaningful over a rendered frame.

## Adapter boundary

Render Fabric currently emits P6 RGB8 PPM in this proof. Universal Creation's adjustment Hands consume `axm.precision-raster/v1`, which is RGBA.

The v0.4 adapter therefore:

1. parses bounded P6 / max-value-255 PPM;
2. preserves each RGB byte exactly;
3. introduces alpha `255` for every pixel;
4. creates the donor-compatible precision-raster state with explicit source/digest evidence;
5. after Creative Flow, exports RGB back to PPM and discards alpha.

This is an explicit format bridge, not a claim that PPM is the future Creative Render frame contract.

## Repeat evidence

The same input frame and same Creative Flow request are executed twice. Acceptance requires:

- both flows report `PASS`;
- both flow digests match;
- both final precision-raster digests match;
- both exported PPM bodies are byte-identical;
- the styled PPM differs from the source renderer PPM.

The dedicated workflow independently replay-verifies the upstream Render Fabric receipt before calling Universal Creation.

## Four-root gate

**Truth** — post-render execution is distinguished from an in-render render pass; PPM/RGBA conversion and alpha loss are explicit.

**Agency / non-domination** — the caller explicitly chooses the donor, input frame, operations and output paths; no hidden renderer or creative-tool substitution occurs.

**Continuity** — the source Render Fabric request/receipt and source frame are retained and SHA-256-bound into the post-render receipt; the original frame is not overwritten.

**Wisdom before speed** — two known bounded adjustment Hands prove the direct-frame path before a general plugin/pass system is invented.

## Does not prove

v0.4 does not establish:

- execution inside the renderer's own rasterization pass;
- GPU/WebGPU shader integration;
- preservation of alpha through PPM;
- visual or artistic quality;
- professional color grading;
- arbitrary Creative Hand compatibility with rendered frames;
- FrameState/video integration;
- direct VFX compositing into Render Fabric;
- live game-world editing;
- cross-machine bitwise determinism.

Those are separate evidence gates.
