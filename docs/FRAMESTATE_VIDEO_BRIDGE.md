# Creative Render -> FrameState video bridge — v0.6

## Question

Can verified rendered frames produced from machine-native creative state be admitted into a separate state-native video body and become a playable video without hiding the handoff?

v0.6 tests one deliberately sparse sequence.

## Executable path

```text
Universal Creation rig / clip / skin
            |
       sample t=0/1/2
            |
       AXM_SCENE 1 x3
            |
       Render Fabric
            |
 verified RGB8 PPM frames x3
            |
 AXM Creative Render FrameState bridge
            |
 canonical FrameState project/v0.5
            |
        FrameState
            |
 native PPM media conform + 12 deterministic frames
            |
 exact FrameState receipt + repeat verification
            |
 explicit FFmpeg MP4 assembly boundary
            |
 caller-pinned read-only render verification
            |
 AXM_CREATIVE_FRAMESTATE_VIDEO_EVIDENCE 1
```

The bridge does not teach FrameState about Universal Creation rigs. It admits only the exact rendered image bytes as image media. Each sparse input image receives one explicit non-overlapping hold interval.

## Pinned proof bodies

- Universal Creation: `30d62f80c84732dbeebd1e58984525b3f8ec1d60`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`
- FrameState: `41c9c6827e64613b523b28536ab864dddf046d93`

The proof uses three 320x180 source frames at FrameState 12 fps, each held for four frames. The resulting canonical project therefore requests 12 FrameState frames / 1 second.

## FrameState project boundary

`src/framestate_bridge.mjs`:

- accepts 2..32 P6 RGB8 PPM source images;
- requires equal dimensions;
- requires all media paths to remain relative to a caller-declared machine root;
- binds every exact source file with SHA-256;
- generates `axm.framestate.project/v0.5` with one explicit image media record and one non-overlapping image layer per source frame;
- does not add transitions, interpolation, effects, text, audio or invented motion.

The generated `AXM_CREATIVE_FRAMESTATE_PROJECT_RECEIPT 1` proves the project construction only. It explicitly does not claim FrameState successfully rendered or encoded the project.

## Final video evidence gate

The integration workflow then uses FrameState itself for four distinct observations:

1. canonical project admission through `framestate inspect`;
2. normal render + MP4 assembly through `framestate render --profile fast`;
3. native deterministic frame/audio repeat check through `framestate verify-repeat`;
4. caller-pinned, read-only local evidence admission through `framestate verify-render`.

`src/framestate_video_verify.mjs` accepts the result only when:

- the exact project bytes still match the Creative Render bridge receipt;
- FrameState reports successful requested/attempted MP4 assembly;
- the MP4 bytes match FrameState's own receipted SHA-256;
- repeat verification passes;
- read-only verification reports `verified: true` and `authority: EVIDENCE_ADMISSION_ONLY`;
- the caller-pinned FrameState receipt/project digests match the same render receipt;
- the verified frame count matches the Creative Render project's declared duration.

## FFmpeg boundary

FrameState explicitly treats container assembly as an external FFmpeg boundary. v0.6 preserves that wording.

A green proof establishes that the exercised runner successfully produced one MP4 and binds its exact bytes. It does **not** claim the MP4 is bit-identical across different FFmpeg versions, operating systems or machines.

## Four-root gate

**Truth** — sparse source samples, FrameState project state, deterministic FrameState frame rendering, read-only evidence verification and external MP4 encoding are separate claims.

**Agency / non-domination** — Creative Render chooses explicit source frames and hold durations; FrameState receives no authority over upstream creative state, and its verifier returns evidence-only authority.

**Continuity** — original Render Fabric frames stay intact; exact source hashes, project bytes, FrameState receipts/manifests, repeat evidence, verification evidence and MP4 bytes stay separately bound.

**Wisdom before speed** — three sparse frames and one one-second video prove the handoff before attempting continuous rig transfer, video interpolation or a universal temporal protocol.

## Does not prove

- continuous-time motion between Universal Creation samples;
- FrameState understanding of Universal Creation rig/skin/clip semantics;
- a shared temporal ontology between UC and FrameState;
- cinematic or artistic quality;
- bit-identical MP4 encoding across machines;
- live video streaming;
- temporal Visual Effect Fabric animation across the sequence;
- game-world recording or machinima capture;
- cross-machine bitwise determinism for the whole pipeline.
