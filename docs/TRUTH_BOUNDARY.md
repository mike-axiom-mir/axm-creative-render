# Truth Boundary — v0.2

## Verified by the repository-local implementation

- A dependency-free Node.js tool can parse the documented minimal `AXM_SCENE 1` triangle/albedo subset.
- The tool can apply explicit `AXM_CREATIVE_OPERATOR 1` `tint` and `translate` operations.
- Local creative operations write a new scene instead of overwriting source state and emit SHA-256-bound `AXM_CREATIVE_RECEIPT 1` evidence.
- Repeating the same local input + operator produces identical output bytes and receipt digest fields in the current implementation.
- Unknown scene versions, operator versions and unsupported operator kinds fail explicitly.
- A bounded adapter can convert a finite indexed precision triangle mesh into the current minimal `AXM_SCENE 1` subset while making its scale/albedo mapping explicit.
- Explicit local donor bridges can inspect a Universal Creation `creativeHands` service and execute a Visual Effect Fabric Hand graph without copying those donor implementations into this repository.
- Donor snapshot outputs are forbidden inside the supplied donor repository roots.

## Verified only when the live integration workflow is green

The dedicated `live-donor-render-bridge` workflow pins exact revisions of Universal Creation, Visual Effect Fabric and Render Fabric. A passing run establishes only the following bounded cross-repository facts:

- the pinned Universal Creation public `creativeHands` surface can be loaded;
- its audit and recipe registry can be observed;
- `creative.mesh-primitive.cube` can execute and return a valid indexed precision mesh for the adapter;
- the adapted scene can be consumed by the pinned AXM native Render Fabric renderer;
- Render Fabric can emit and independently replay-verify its render receipt for that output;
- the pinned Visual Effect Fabric can execute `fx.holographic-ai-entity-state-native` through its own Hand runtime;
- the resulting effect realization retains the checked canonical-state / rebuildable-derived-working-set declarations and produces derived HTML evidence.

These are exact pinned-donor integration facts. They are not automatically inherited by later donor revisions.

## Not yet claimed

- General compatibility with Universal Creation's full creative-Hand body.
- A shared complete scene, material, rig or animation ontology between Universal Creation and Render Fabric.
- That the current precision-mesh -> `AXM_SCENE 1` adapter preserves UVs, materials, rigs, clips or all donor semantics; it does not.
- Direct Visual Effect Fabric injection into AXM Render Fabric.
- A shared versioned render-pass/effect-pass contract.
- Live renderer injection or arbitrary render plugins.
- Frame/pixel post-processing operators over Render Fabric output.
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
