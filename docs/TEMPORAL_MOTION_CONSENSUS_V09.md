# Multi-Region Temporal Motion Consensus v0.9

v0.8 proved that one deterministic evidence-rich image region can be measured by Universal Creation's translation block matcher, drive translation stabilization, reduce the exercised region's error, and survive into a verified video body. v0.9 tests whether that motion evidence remains coherent across several spatially distinct regions before allowing one real track receipt to drive stabilization.

## Executable path

1. Universal Creation rig/clip state is sampled at `0`, `0.25`, `0.5` and independently rendered/receipt-verified by Render Fabric.
2. Creative Render scans the exact reference PPM and deterministically chooses three spatially diverse local RGB edge-energy regions.
3. Each selected region independently invokes the unchanged Universal Creation `creative.frame-finish.block-match-track` Hand against each non-reference frame.
4. Creative Render computes component-wise integer median `dx/dy` as consensus evidence only.
5. A regional track is an inlier only when both axis deviations from that median stay within the explicit `maxAxisSpread` policy. Three regions require at least two inliers; five regions require at least three.
6. If fewer than that strict-majority quorum remain, the lane fails closed. Disagreeing regional track receipts are retained as visible outliers rather than erased.
7. Creative Render selects the **actual inlier Universal Creation track receipt** nearest the median, breaking ties by lower tracker MSE and then stable region index. It does not manufacture or relabel a synthetic consensus track.
8. That real receipt is passed back into Universal Creation Creative Flow to invoke `stabilize-translation`, followed by `difference-frame` and aligned `motion-trail` finishing.
9. The full two-phase track/post path executes twice. Regional track receipts, inlier/outlier classification, consensus, representative choice, stabilized frames, residual frames and final PPM bytes must repeat exactly.
10. Mean RGB MSE across all selected regions is measured before/after representative-track stabilization as bounded evidence. It is not an aesthetic or global-motion claim.
11. The exact final PPM hashes become the exact FrameState project source hashes before deterministic repeat verification, read-only evidence admission and explicit FFmpeg MP4 assembly.

## Pinned donors

- Universal Creation `026f4f5d0e669627639f404945147c9dedb48ff2` — 501 executable Hands / 508 callable recipes
- Render Fabric `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- FrameState `41c9c6827e64613b523b28536ab864dddf046d93`

## Failed-first-run evidence

The first exact-head v0.9 run reached the new consensus lane after **39/39 Creative Render tests**, three distinct Universal Creation temporal samples, **33/33 Render Fabric tests**, and three verified renderer outputs. It then failed before FrameState/video assembly at frame 2:

`multi-region track disagreement at frame 2: spread dx=0, dy=11`

That failure exposed a real weakness in the first consensus rule: it required every selected local patch to agree inside one global raw-spread bound. A single ambiguous/local-motion patch could therefore veto two coherent measurements even when the disagreement itself was useful evidence.

The repair does **not** widen the threshold and does not delete the disagreeing track. The rule is now `component-median-with-axis-bounded-majority-inliers/v1`: compute the median, classify every real Universal Creation track against the same unchanged per-axis threshold, require a strict majority of inliers, retain all outlier receipts and raw spread, and choose one actual inlier receipt nearest the median to drive stabilization. If fewer than a strict majority agree, execution still fails before video admission.

## Bounds

- 2..12 source frames;
- 3 or 5 tracking regions only so component-wise median coordinates remain observed integer values;
- equal P6 RGB8 dimensions;
- at most 32 MiB decoded RGBA bridge state;
- local-region overlap limited to 25% of the smaller region area during automatic selection;
- each Universal Creation block-match call remains under its native 32,000,000 pixel-test work bound;
- total modeled regional tracking work is capped at 64,000,000 pixel tests per bridge invocation;
- search radius `0..64`;
- per-axis median-deviation threshold `0..32` pixels, proof default `4`;
- strict-majority quorum: 2/3 or 3/5;
- inlier and outlier indices, raw regional spread, inlier spread and representative receipt identity remain explicit evidence;
- trail window `1..8`, decay `0..1`;
- translation-only stabilization.

## Authority boundary

Universal Creation remains the executor and authority for each regional track, stabilization, difference and trail Hand. Creative Render owns deterministic region selection, consensus evidence, fail-closed majority policy and selection of one already-existing real **inlier** UC track receipt. The median is never represented as a UC-generated receipt. Outliers remain visible and are not rewritten as failures of the donor. Render Fabric remains renderer authority. FrameState remains `EVIDENCE_ADMISSION_ONLY`. FFmpeg remains an explicit external assembly boundary.

## Truth boundary

This does not prove optical flow, semantic object tracking, global camera motion under parallax, independently moving-object separation, rotation/scale/perspective stabilization, continuous-time interpolation, cinematic quality or universal correctness. A majority of agreeing local translation measurements is stronger evidence than one patch, but it remains bounded local translation evidence and can still be wrong under scene structures outside this gate.
