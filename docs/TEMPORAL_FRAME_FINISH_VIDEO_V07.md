# Temporal Frame Finishing -> Verified Video v0.7

This gate connects the newer Universal Creation frame-finishing surface to Creative Render's already verified temporal + FrameState video path.

## Executable path

1. Universal Creation rig/clip state is sampled at explicit times `t=0,1,2`.
2. Render Fabric renders each sample to an exact P6 RGB8 PPM and verifies its render receipt.
3. Creative Render converts those exact PPM bytes into `axm.precision-raster/v1` state.
4. Universal Creation Creative Flow invokes `creative.frame-finish.motion-trail` over bounded progressive frame windows.
5. The same sequence and policy are executed twice; output raster digests and PPM bytes must repeat exactly.
6. The finished PPM sequence becomes a canonical FrameState project with one explicit non-overlapping hold layer per source frame.
7. FrameState renders 12 frames, proves deterministic repeat state, performs caller-pinned read-only evidence admission, and assembles a one-second MP4 through the named FFmpeg boundary.
8. `AXM_CREATIVE_TEMPORAL_FINISH_VIDEO_EVIDENCE 1` binds the original rendered frame hashes, finished frame hashes, exact FrameState source hashes, FrameState evidence and final MP4 hash.

## Pinned proof donors

- Universal Creation: `026f4f5d0e669627639f404945147c9dedb48ff2`
  - expected public surface: **501 executable Hands / 508 callable recipes**
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- FrameState: `41c9c6827e64613b523b28536ab864dddf046d93`

## Bounds

- 2..32 input PPM frames;
- equal dimensions required;
- at most 32 MiB total decoded RGBA state in the Creative Render bridge;
- progressive finishing window: 1..8 frames;
- decay: explicit finite value in `0..1`;
- the proof uses 3 input frames, window 3, decay `0.65`, 12 fps and four held frames per source frame.

Universal Creation retains its own motion-trail work bound. Creative Render does not bypass it.

## Authority boundary

Creative Render owns only the adapter and evidence binding. It does not silently absorb donor authority.

- Render Fabric remains the source-frame renderer.
- Universal Creation remains the executor of the frame-finishing Hand through its public Creative Flow.
- FrameState remains an `EVIDENCE_ADMISSION_ONLY` verifier for the video body.
- FFmpeg remains an explicit external assembly boundary used inside the isolated CI proof.

## Truth boundary

This gate proves real executable frame-sequence finishing and a real finished video body in the exercised environment. It does **not** claim optical flow, semantic object tracking, camera solving, continuous interpolation, cinematic quality, universal aesthetic judgment, cross-machine bit-identical MP4 output, or that motion-trail finishing should be applied to every project.

The purpose is narrower: prove that a newly grown Universal Creation frame capability can operate on verified renderer output and survive, byte-bound, all the way into a verified video artifact without erasing provenance or authority boundaries.
