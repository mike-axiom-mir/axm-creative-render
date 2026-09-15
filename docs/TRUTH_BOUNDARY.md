# Truth Boundary — v0.4

## Verified by the repository-local implementation

- A dependency-free Node.js tool can parse the documented minimal `AXM_SCENE 1` triangle/albedo subset.
- The tool can apply explicit `AXM_CREATIVE_OPERATOR 1` `tint` and `translate` operations.
- Local creative operations write a new scene instead of overwriting source state and emit SHA-256-bound `AXM_CREATIVE_RECEIPT 1` evidence.
- Repeating the same local input + operator produces identical output bytes and receipt digest fields in the current implementation.
- Unknown scene versions, operator versions and unsupported operator kinds fail explicitly.
- A bounded adapter can convert a finite indexed precision triangle mesh into the current minimal `AXM_SCENE 1` subset while making its scale/albedo mapping explicit.
- Explicit local donor bridges can inspect Universal Creation `creativeHands` / `creativeFlow` surfaces and execute a Visual Effect Fabric Hand graph without copying those donor implementations into this repository.
- Donor snapshot outputs are forbidden inside the supplied donor repository roots.
- The temporal bridge has an explicit caller-owned skeleton/clip request, bounded increasing sample times, repeat verification, and a declared lossy adapter boundary.
- The temporal CLI emits renderer-neutral `AXM_RENDER_REQUEST 1` files next to each sampled `AXM_SCENE 1` body instead of silently invoking a renderer inside the state sampler.
- The post-render bridge can parse bounded P6 RGB8 PPM, construct explicit `axm.precision-raster/v1` state with opaque alpha, and export precision-raster state back to PPM.
- The post-render bridge repeat-checks the same Creative Flow result before accepting output and refuses to overwrite the renderer source frame.

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

## Not yet claimed

- General compatibility with Universal Creation's full creative-Hand body.
- A shared complete scene, material, UV, rig or animation ontology between Universal Creation and Render Fabric.
- Preservation of Universal Creation material/texture state through the current `AXM_SCENE 1` adapter.
- Continuous-time animation correctness between sampled times.
- Video encoding or a video container.
- Direct Visual Effect Fabric injection into AXM Render Fabric.
- A shared versioned renderer-internal render-pass/effect-pass contract.
- GPU/WebGPU post-process shader integration.
- Alpha-preserving post-render interchange through the current PPM proof.
- Automatic aesthetic choice or artistic-quality acceptance for the post-render Hands.
- Video/animation integration with FrameState.
- Professional Body execution or professional/aesthetic acceptance.
- Floorborn/live game-world creation.
- AI visual observation or aesthetic judgment.
- GPU/WebGPU equivalence across repositories.
- Real-device performance improvement from state-native VFX; the donor keeps that claim separate.
- Cross-machine bitwise determinism.
- Visual quality, professional quality or semantic understanding.
- Automatic mutation, autonomous creativity or hidden authority.

Each item should move across this boundary only with executable evidence.
