# Truth Boundary — v0.6

## Verified by the repository-local implementation

- A dependency-free Node.js tool can parse the documented minimal `AXM_SCENE 1` triangle/albedo subset.
- The tool can apply explicit `AXM_CREATIVE_OPERATOR 1` `tint` and `translate` operations.
- Local creative operations write a new scene instead of overwriting source state and emit SHA-256-bound `AXM_CREATIVE_RECEIPT 1` evidence.
- Repeating the same local input + operator produces identical output bytes and receipt digest fields in the current implementation.
- Unknown scene versions, operator versions and unsupported operator kinds fail explicitly.
- A bounded adapter can convert a finite indexed precision triangle mesh into the current minimal `AXM_SCENE 1` subset while making its scale/albedo mapping explicit.
- Explicit local donor bridges can inspect Universal Creation `creativeHands` / `creativeFlow` surfaces and execute Visual Effect Fabric Hand graphs without copying those donor implementations into this repository.
- Donor snapshot outputs are forbidden inside supplied donor repository roots.
- The temporal bridge has an explicit caller-owned skeleton/clip request, bounded increasing sample times, repeat verification, and a declared lossy adapter boundary.
- The temporal CLI emits renderer-neutral `AXM_RENDER_REQUEST 1` files next to each sampled `AXM_SCENE 1` body instead of silently invoking a renderer inside the state sampler.
- The post-render bridge can parse bounded P6 RGB8 PPM, construct explicit `axm.precision-raster/v1` state with opaque alpha, and export precision-raster state back to PPM.
- The post-render bridge repeat-checks the same Creative Flow result before accepting output and refuses to overwrite the renderer source frame.
- The VFX source bridge can execute a donor electric Hand graph twice and require matching final-state/SVG evidence before accepting the source proof.
- The bounded electric-path raster adapter consumes canonical VFX path points/energy/width directly, has explicit path/point/pixel budgets, and repeat-checks byte-identical PPM output in the exercised runtime.
- The VFX frame-composite bridge requires base/effect raster dimensions to match and repeat-checks the same Universal Creation screen-composite flow before accepting output.
- The FrameState project bridge accepts only bounded equal-sized P6 RGB8 source frames, confines media paths to an explicit machine root, binds every input with SHA-256, and creates non-overlapping sequential image layers in `axm.framestate.project/v0.5`.
- The FrameState video verifier requires the exact bridge project bytes, successful FrameState assembly evidence, FrameState repeat verification, caller-pinned read-only verification with `EVIDENCE_ADMISSION_ONLY` authority, and the exact MP4 digest to agree before emitting Creative Render video evidence.

## Verified only when the v0.2 live integration workflow is green

The dedicated `live-donor-render-bridge` workflow pins exact revisions of Universal Creation, Visual Effect Fabric and Render Fabric. A passing run establishes only the following bounded cross-repository facts:

- the pinned Universal Creation public `creativeHands` and `creativeFlow` surfaces can be loaded;
- its audit and recipe registry can be observed;
- a bounded multi-Hand flow can create, scale, rotate and inspect a precision mesh;
- the adapted scene can be consumed by the pinned AXM native Render Fabric renderer;
- Render Fabric can emit and independently replay-verify its render receipt for that output;
- the pinned Visual Effect Fabric can execute `fx.holographic-ai-entity-state-native` through its own Hand runtime;
- the resulting effect realization retains the checked canonical-state / rebuildable-derived-working-set declarations and produces derived HTML evidence.

These are exact pinned-donor integration facts. They are not automatically inherited by later donor revisions.

## Verified only when the v0.3 temporal workflow is green

The dedicated `temporal-render-bridge` workflow pins Universal Creation at `30d62f80c84732dbeebd1e58984525b3f8ec1d60` and Render Fabric at `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`.

A passing run establishes only these additional facts:

- the pinned Universal Creation public body reports the expected 441 executable creative Hands and 448 callable recipes;
- one explicit caller-owned skeleton, precision mesh, animation clip and nearest-bone skin can be constructed through Creative Flow;
- the clip can be sampled at the declared times and the skin can produce a deformed precision mesh for each sample;
- repeating the same bounded sampling path produces the same Creative Flow digests and `AXM_SCENE 1` scene hashes in that verified environment;
- the sampled scenes are distinct from one another for the exercised clip;
- every sampled scene can be rendered by the pinned AXM native Render Fabric renderer;
- every render produces a non-empty frame and render receipt that passes Render Fabric's own replay verifier;
- the rendered frame bytes are distinct across the exercised sample times in that verified run;
- one combined temporal evidence record can bind the exact scene, request, output and render-receipt file hashes.

The adapter explicitly records that normals, UVs, materials, skin, skeleton and animation-clip semantics are omitted when each deformed mesh is flattened into the current tiny `AXM_SCENE 1` contract. The passing workflow therefore proves sampled geometry-to-pixels continuity, **not semantic equivalence between the richer animation body and the renderer contract**.

## Verified only when the v0.4 post-render workflow is green

The dedicated `post-render-creative-hand` workflow pins Universal Creation at `30d62f80c84732dbeebd1e58984525b3f8ec1d60` and Render Fabric at `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`.

A passing run establishes only these additional facts:

- the source frame is produced by the pinned AXM native Render Fabric renderer and its receipt passes Render Fabric's independent replay verifier before creative processing;
- that exact PPM frame can be adapted into `axm.precision-raster/v1` caller-owned working state;
- the pinned Universal Creation public Creative Flow can execute real `creative.adjust.tint` and `creative.adjust.contrast` Hands over that rendered frame;
- Universal Creation emits PASS receipts for both explicit post-render operations;
- running the same input and post-render Creative Flow twice produces the same flow digest, output-raster digest and PPM bytes in the exercised environment;
- the styled PPM differs from the original renderer PPM while retaining the same width and height;
- `AXM_CREATIVE_POST_RENDER_RECEIPT 1` binds the exact upstream render-request bytes, upstream render-receipt bytes, source PPM and styled PPM with SHA-256.

The workflow proves **an explicit after-render creative path**, not a renderer-internal pass. PPM has no alpha channel, so the adapter introduces opaque alpha 255 on intake and discards alpha on export. That boundary is part of the evidence rather than hidden.

## Verified only when the v0.5 VFX frame workflow is green

The dedicated `vfx-frame-composite` workflow pins Visual Effect Fabric at `6639742ec3b909ae697dadb5b5290b94b41354a3`, Universal Creation at `30d62f80c84732dbeebd1e58984525b3f8ec1d60`, and Render Fabric at `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`.

A passing run establishes only these additional facts:

- the pinned Visual Effect Fabric donor can execute the real `fx.electric-storm` Hand graph through its own runtime;
- the same explicit seed repeats to the same final-state hash and derived SVG bytes in the exercised environment;
- canonical electric paths remain separate from the derived SVG realization;
- the exact canonical electric state can be materialized by the bounded `axm.creative-render.electric-path-raster/v1` adapter into a 320x180 RGB8 PPM, and repeating that materialization produces identical PPM bytes in the exercised runtime;
- the state-raster receipt records which canonical fields are realized (`paths.points`, `paths.energy`, `paths.width`) and which richer layer/motion semantics remain retained but unrealized;
- the source Render Fabric frame is independently receipt-verified before compositing;
- the effect PPM and Render Fabric PPM can be adapted into Universal Creation precision-raster state at matching dimensions;
- Universal Creation Creative Flow executes real `creative.composite.screen` and `creative.adjust.contrast` Hands over those two raster states;
- running that same composite flow twice produces identical flow/output-raster/PPM evidence in the exercised environment;
- the final composited PPM differs from the base Render Fabric frame;
- `AXM_CREATIVE_VFX_COMPOSITE_RECEIPT 1` binds the exact Render Fabric request/receipt/frame, VFX source receipt/SVG, VFX state-raster receipt/effect raster, UC flow evidence and final PPM.

This proves an **explicit VFX canonical state -> bounded raster realization -> post-render composite path**. It does not prove that the VFX graph runs natively inside Render Fabric or that every donor layer semantic was realized.

## Verified only when the v0.6 FrameState video workflow is green

The dedicated `framestate-video-bridge` workflow pins Universal Creation at `724dde638763253ba1d4cf93d13aaa9a4981e4bf`, Render Fabric at `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`, and FrameState at `41c9c6827e64613b523b28536ab864dddf046d93`.

Before the execution gates, the workflow checks out the exact Creative Render PR head, independently reads all four checked-out revisions, fails if any revision differs from the declared source/donor pin, and retains that provenance record as evidence-only state. The proof artifact is uploaded with `if: always()` so a failure after provenance capture can retain partial outputs and diagnostics rather than being rewritten as a weaker success path.

A passing run establishes only these additional facts:

- the pinned current Universal Creation revision can still execute the bounded rig/clip/skin sampling path used by this bridge;
- three sparse Universal Creation animation samples become three independently receipt-verified Render Fabric PPM frames;
- those exact PPM bytes are admitted into a generated `axm.framestate.project/v0.5` with SHA-256-bound source identity and explicit non-overlapping hold intervals;
- FrameState accepts the generated project through its canonical loader;
- FrameState renders the requested 12-frame sequence and its own deterministic `verify-repeat` evidence passes in the exercised Python/runtime environment;
- FrameState successfully assembles a one-second MP4 through its named FFmpeg boundary using the `fast` export profile;
- the exact MP4 bytes match the digest in FrameState's render receipt;
- FrameState's read-only caller-pinned `verify-render` path independently admits the current render bytes and reports `authority: EVIDENCE_ADMISSION_ONLY`;
- `AXM_CREATIVE_FRAMESTATE_VIDEO_EVIDENCE 1` binds the Creative Render bridge receipt/project, FrameState render receipt, repeat evidence, read-only verification evidence and MP4 bytes.

This proves a **sparse verified-frame sequence -> canonical FrameState project -> deterministic FrameState frames -> externally assembled playable MP4** path. It does not prove continuous animation semantics between the three upstream samples.

## Failed-first-run correction retained from v0.5

The first v0.5 PR-head integration run passed all 18 Creative Render tests, all 33 Render Fabric tests, source rendering/receipt replay and the real `fx.electric-storm` graph, then failed at the attempted ImageMagick SVG-rasterization step before a VFX raster was accepted.

The failure did not produce evidence sufficient to name a precise external-tool cause. Rather than weaken the gate, invent a cause, or install a hidden dependency, the path was changed to the bounded canonical-state raster adapter described above. The failed workflow run remains in PR history.

## Not yet claimed

- General compatibility with Universal Creation's full creative-Hand body.
- A shared complete scene, material, UV, rig or animation ontology between Universal Creation and Render Fabric.
- Preservation of Universal Creation material/texture state through the current `AXM_SCENE 1` adapter.
- Continuous-time animation correctness between sampled times.
- Bit-identical MP4 encoding across FFmpeg versions, machines or operating systems.
- Native Visual Effect Fabric injection into AXM Render Fabric.
- A shared versioned renderer-internal render-pass/effect-pass contract.
- GPU/WebGPU post-process shader integration.
- Full realization of Visual Effect Fabric AetherFX layer-module semantics in the bounded path adapter.
- Physical scene-lighting interaction from the composited electric effect.
- Alpha-preserving post-render interchange through the current PPM proof.
- Automatic aesthetic choice or artistic-quality acceptance for post-render/VFX Hands.
- Native transfer of Universal Creation rig/skin/clip semantics into FrameState.
- A shared temporal ontology between Universal Creation and FrameState.
- Professional Body execution or professional/aesthetic acceptance.
- Floorborn/live game-world creation.
- AI visual observation or aesthetic judgment.
- GPU/WebGPU equivalence across repositories.
- Real-device performance improvement from state-native VFX; the donor keeps that claim separate.
- Cross-machine bitwise determinism for the complete pipeline.
- Visual quality, professional quality or semantic understanding.
- Automatic mutation, autonomous creativity or hidden authority.

Each item should move across this boundary only with executable evidence.
