# Multi-Region Temporal Motion Consensus v0.9

v0.8 proved that one deterministic evidence-rich image region can be measured by Universal Creation's translation block matcher, drive translation stabilization, reduce the exercised region's error, and survive into a verified video body. v0.9 tests whether that motion evidence remains coherent across several spatially distinct regions before allowing one real track receipt to drive stabilization.

## Executable path

1. Universal Creation rig/clip state is sampled at `0`, `0.25`, `0.5` and independently rendered/receipt-verified by Render Fabric.
2. Creative Render scans the exact reference PPM and deterministically chooses three spatially diverse local RGB edge-energy regions.
3. Each selected region independently invokes the unchanged Universal Creation `creative.frame-finish.block-match-track` Hand against each non-reference frame.
4. Creative Render computes the integer median `dx/dy` only as consensus evidence and measures the regional axis spread.
5. If either axis spread exceeds the explicit policy threshold, the lane fails closed.
6. Creative Render selects the **actual Universal Creation track receipt** nearest the median. It does not manufacture or relabel a synthetic consensus track.
7. That real receipt is passed back into Universal Creation Creative Flow to invoke `stabilize-translation`, followed by `difference-frame` and aligned `motion-trail` finishing.
8. The full two-phase track/post path executes twice. Regional track receipts, consensus, representative choice, stabilized frames, residual frames and final PPM bytes must repeat exactly.
9. Mean RGB MSE across all selected regions is measured before/after representative-track stabilization as bounded evidence. It is not an aesthetic or global-motion claim.
10. The exact final PPM hashes become the exact FrameState project source hashes before deterministic repeat verification, read-only evidence admission and explicit FFmpeg MP4 assembly.

## Pinned donors

- Universal Creation `026f4f5d0e669627639f404945147c9dedb48ff2` — 501 executable Hands / 508 callable recipes
- Render Fabric `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- FrameState `41c9c6827e64613b523b28536ab864dddf046d93`

## Bounds

- 2..12 source frames;
- 3 or 5 tracking regions only so component-wise median coordinates remain observed integer values;
- equal P6 RGB8 dimensions;
- at most 32 MiB decoded RGBA bridge state;
- local-region overlap limited to 25% of the smaller region area during automatic selection;
- each Universal Creation block-match call remains under its native 32,000,000 pixel-test work bound;
- total modeled regional tracking work is capped at 64,000,000 pixel tests per bridge invocation;
- search radius `0..64`;
- axis disagreement threshold `0..32` pixels, proof default `4`;
- trail window `1..8`, decay `0..1`;
- translation-only stabilization.

## Authority boundary

Universal Creation remains the executor and authority for each regional track, stabilization, difference and trail Hand. Creative Render owns deterministic region selection, consensus evidence, fail-closed disagreement policy and selection of one already-existing real UC track receipt. The median is never represented as a UC-generated receipt. Render Fabric remains renderer authority. FrameState remains `EVIDENCE_ADMISSION_ONLY`. FFmpeg remains an explicit external assembly boundary.

## Truth boundary

This does not prove optical flow, semantic object tracking, global camera motion under parallax, independently moving-object separation, rotation/scale/perspective stabilization, continuous-time interpolation, cinematic quality or universal correctness. Multiple agreeing local translation measurements are stronger evidence than one patch, but they remain local translation measurements.
