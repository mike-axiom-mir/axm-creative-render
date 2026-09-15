# Bounded Temporal Motion -> Verified Video v0.8

v0.7 proved that a real Universal Creation frame-finishing Hand can operate on verified Render Fabric frames and survive into a FrameState video body. v0.8 adds the first bounded motion measurement and corrective temporal chain.

## Executable path

1. Universal Creation creates one rigged cube and samples the real clip at three close times: `0`, `0.25`, `0.5`.
2. Render Fabric independently renders and receipt-verifies each exact scene sample.
3. Creative Render converts those exact PPMs into Universal Creation precision-raster state.
4. Universal Creation Creative Flow executes `creative.frame-finish.block-match-track` against frame zero over one explicit bounded region.
5. The exact track receipt drives `creative.frame-finish.stabilize-translation` on the current frame.
6. `creative.frame-finish.difference-frame` preserves the residual after translation-only alignment.
7. `creative.frame-finish.motion-trail` operates over the aligned progressive sequence.
8. The complete request executes twice. Tracks, stabilized rasters, residual rasters and finished PPM bytes must repeat exactly.
9. Region RGB MSE is measured before and after stabilization as explicit bridge evidence. The CI proof requires at least one non-zero track and at least one strict MSE improvement; that is evidence for this exercised sample set, not a general quality claim.
10. The exact tracked/finished frame hashes become the exact FrameState project source hashes, then pass FrameState render-repeat and read-only evidence admission before FFmpeg assembly.

## Pinned donors

- Universal Creation `026f4f5d0e669627639f404945147c9dedb48ff2` — 501 executable Hands / 508 callable recipes
- Render Fabric `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- FrameState `41c9c6827e64613b523b28536ab864dddf046d93`

## Current bounds

- 2..16 input frames;
- equal P6 RGB8 frame dimensions;
- at most 32 MiB decoded RGBA working state in the bridge;
- automatically derived fixed tracking region for this first gate;
- search radius `0..64`, additionally constrained by Universal Creation's 32,000,000 pixel-test block-match work budget;
- motion-trail window `1..8`;
- decay `0..1`;
- translation-only stabilization;
- proof video remains three source states held to 12 realized frames at 12 fps / one second.

The first public CLI deliberately does not expose arbitrary region coordinates. That keeps this gate narrower than the underlying bridge until caller-owned region selection is separately proven.

## Authority and truth boundary

Render Fabric remains renderer authority. Universal Creation owns and executes the tracking, stabilization, residual and trail Hands through its public Creative Flow. Creative Render owns adapter/evidence binding only. FrameState remains `EVIDENCE_ADMISSION_ONLY`. FFmpeg remains a named external assembly boundary.

This does not prove optical flow, feature tracking, semantic object identity, occlusion reasoning, perspective/camera solving, rotation or scale stabilization, continuous-time interpolation, cinematic quality, or universal tracking correctness. It proves a smaller thing that matters: real rendered motion can be measured by a bounded executable Hand, used to drive another executable Hand, quantitatively checked without hiding its limits, and carried losslessly through the evidence chain into a real video body.
