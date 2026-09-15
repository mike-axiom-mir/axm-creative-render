# Bounded Temporal Motion -> Verified Video v0.8

v0.7 proved that a real Universal Creation frame-finishing Hand can operate on verified Render Fabric frames and survive into a FrameState video body. v0.8 adds the first bounded motion measurement and corrective temporal chain.

## Executable path

1. Universal Creation creates one rigged cube and samples the real clip at three close times: `0`, `0.25`, `0.5`.
2. Render Fabric independently renders and receipt-verifies each exact scene sample.
3. Creative Render converts those exact PPMs into Universal Creation precision-raster state.
4. Creative Render deterministically scans the first exact PPM for bounded local RGB edge energy and selects the highest-evidence tracking tile that leaves the declared search margin inside the frame.
5. Universal Creation Creative Flow executes `creative.frame-finish.block-match-track` against frame zero over that explicit selected region.
6. The exact track receipt drives `creative.frame-finish.stabilize-translation` on the current frame.
7. `creative.frame-finish.difference-frame` preserves the residual after translation-only alignment.
8. `creative.frame-finish.motion-trail` operates over the aligned progressive sequence.
9. The complete request executes twice. Tracks, stabilized rasters, residual rasters and finished PPM bytes must repeat exactly.
10. Region RGB MSE is measured before and after stabilization as explicit bridge evidence. The CI proof requires at least one non-zero track and at least one strict MSE improvement; that is evidence for this exercised sample set, not a general quality claim.
11. The exact tracked/finished frame hashes become the exact FrameState project source hashes, then pass FrameState render-repeat and read-only evidence admission before FFmpeg assembly.

## Pinned donors

- Universal Creation `026f4f5d0e669627639f404945147c9dedb48ff2` — 501 executable Hands / 508 callable recipes
- Render Fabric `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- FrameState `41c9c6827e64613b523b28536ab864dddf046d93`

## Failed-first-run evidence

The first exact-head v0.8 workflow did **not** pass the motion gate. All source creation/render verification succeeded, the temporal motion Creative Flow itself repeated exactly, but the original proportion-based tracking region landed on a spatially flat part of the rendered frame. The block matcher therefore reported `dx=0`, `dy=0`, and both pre/post region MSE were `0` for the two non-reference samples. The workflow stopped before FrameState/video assembly because the proof had not actually demonstrated motion measurement.

That failure is retained as evidence. The repair does not weaken the assertion or manufacture a displacement. Instead, the bridge now selects a tracking region from the reference-frame bytes using deterministic local RGB edge energy, records the selection method, score, candidate count, search margin, chosen rectangle and modeled tracker work, then asks the unchanged Universal Creation block matcher to prove or fail the displacement.

## Current bounds

- 2..16 input frames;
- equal P6 RGB8 frame dimensions;
- at most 32 MiB decoded RGBA working state in the bridge;
- deterministic `max-local-rgb-edge-energy/v1` auto-selection over the exact reference PPM unless a bridge caller explicitly supplies a region;
- selected auto-regions reserve the declared search radius as an in-frame margin;
- featureless reference frames fail closed rather than silently choosing an arbitrary tile;
- search radius `0..64`, additionally constrained by Universal Creation's 32,000,000 pixel-test block-match work budget;
- motion-trail window `1..8`;
- decay `0..1`;
- translation-only stabilization;
- proof video remains three source states held to 12 realized frames at 12 fps / one second.

The first public CLI deliberately does not expose arbitrary region coordinates. That keeps the product-facing gate narrower even though the bridge contract can accept an explicit region for controlled callers/tests.

## Authority and truth boundary

Render Fabric remains renderer authority. Universal Creation owns and executes the tracking, stabilization, residual and trail Hands through its public Creative Flow. Creative Render owns deterministic region selection, adapter logic and evidence binding only; region selection is not a semantic-object claim. FrameState remains `EVIDENCE_ADMISSION_ONLY`. FFmpeg remains a named external assembly boundary.

This does not prove optical flow, feature tracking, semantic object identity, occlusion reasoning, perspective/camera solving, rotation or scale stabilization, continuous-time interpolation, cinematic quality, or universal tracking correctness. It proves a smaller thing that matters: real rendered motion can be measured by a bounded executable Hand, used to drive another executable Hand, quantitatively checked without hiding its limits, and carried losslessly through the evidence chain into a real video body.
