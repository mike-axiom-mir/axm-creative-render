# Truth Boundary — v0.1

## Verified by the current repository implementation

- A dependency-free Node.js tool can parse the documented minimal `AXM_SCENE 1` triangle/albedo subset.
- The tool can apply an explicit `AXM_CREATIVE_OPERATOR 1` `tint` or `translate` operation.
- The tool writes a new canonical `AXM_SCENE 1` body instead of overwriting the source by default.
- The tool emits `AXM_CREATIVE_RECEIPT 1` with SHA-256 digests for exact input bytes, operator bytes and output bytes.
- Repeating the same input + operator produces identical output bytes and receipt digest fields in the current implementation.
- Unknown scene versions, operator versions and unsupported operator kinds fail explicitly.

## Not yet claimed

- That `axm-render-fabric` has rendered Creative Render output in CI.
- Live renderer injection or render-pass plugins.
- Material, lighting, camera, texture, geometry-generation or post-process operator contracts beyond the two v0.1 examples.
- Pixel/frame operators.
- Video or animation integration with FrameState.
- Universal Creation organ/package compatibility.
- Professional Body execution or acceptance.
- Floorborn/live game-world creation.
- AI visual observation or aesthetic judgment.
- GPU/WebGPU behavior.
- Cross-machine bitwise determinism.
- Visual quality, professional quality, or semantic understanding.
- Automatic mutation, autonomous creativity, or hidden authority.

Each item should move across this boundary only with executable evidence.
