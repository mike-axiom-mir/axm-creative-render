# VFX surface -> native render roundtrip v0.14

## Question

Can Creative Render take one exact caller-owned `AXM_SCENE 1`, derive a bounded VFX sample field, let the current Visual Effect Fabric reconstruct a **real 3D triangle shell**, and then feed that derived geometry back through the owned native Render Fabric without silently turning the derived shell into canonical world truth?

This is the first roundtrip gate where a creative/VFX body produces new triangle geometry that becomes renderer-consumable state again.

## Executable chain

```text
Universal Creation Creative Flow
        |
        v
exact AXM_SCENE 1 source
        |
        v
bounded direct-sample adapter
        |
        v
VFX sample-field admission
        |
        v
real VFX voxel-density Hand
        |
        v
real VFX marching-tetrahedra surface Hand
        |
        +-----------------------> VFX WebGL triangle-surface realization
        |
        v
explicit lossy surface -> AXM_SCENE 1 adapter
        |
        v
Render Fabric native CPU renderer
        |
        v
pixels + independent render-receipt replay
```

## Why this uses a caller-composed graph

Visual Effect Fabric `158f78214e5f98214837978ac5dd29852cc64d89` added `fx.holographic-voxel-surface`, whose stock graph begins from a VFX form and performs its own form sampling.

Creative Render already has a direct sample field whose `sourceDigest` is the exact AXM scene SHA-256. Routing that field back through the stock form sampler would misdescribe the lineage.

v0.14 therefore composes these real donor Hands explicitly:

- `fx.hologram.sample-field-admit`
- `fx.hologram.creative-field`
- `fx.hologram.voxel-density`
- `fx.hologram.voxel-surface-mesh`
- `fx.hologram.voxel-surface-webgl`

The composition is named `axm.creative-render.direct-sample-voxel-surface`. The graph is caller-owned; the Hands remain donor-owned. Receipts record that distinction.

## Bounded policy

The proof uses:

- direct-sample ceiling: 24,000 points;
- voxel resolution: 18^3;
- voxel kernel: 1.9;
- iso threshold: 0.16;
- VFX surface ceiling for this roundtrip: 12,000 triangles;
- native render: 320x180 `ppm-rgb8`.

These are proof bounds, not performance recommendations.

## Surface -> renderer adapter

`axm.holographic-triangle-surface/v0.1` contains positions and normals. `AXM_SCENE 1` currently carries only triangle positions plus one RGB albedo per triangle.

The v0.14 adapter therefore performs a deliberately lossy conversion:

- one VFX surface triangle -> one `AXM_SCENE 1` triangle;
- positions are retained through the existing six-decimal scene serializer;
- VFX normals are **not** carried because `AXM_SCENE 1` has no normal field;
- one explicit constant albedo `[54,210,240]` is assigned to the derived scene;
- material, UV, skin, collision, topology semantics and VFX shading semantics are not promoted into the renderer contract.

The adapter receipt names these losses instead of implying equivalence.

## Pinned bodies

- Universal Creation: `f7dd18a7ee88d9e623c7ee20b2ca97613c37506c`
- Visual Effect Fabric: `158f78214e5f98214837978ac5dd29852cc64d89`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

The Universal Creation pin is intentionally current at the time of this gate. It includes the newly merged static-GLB resource-budget evidence work, while the exercised Creative Flow path remains the existing deterministic mesh creation path.

## Authority

The authority order stays explicit:

1. original `AXM_SCENE 1` bytes are caller/source truth;
2. direct sample field is derived/rebuildable VFX input state;
3. voxel density and extracted triangle shell are derived/rebuildable VFX render state;
4. the second `AXM_SCENE 1` is derived adapter state for Render Fabric;
5. both native pixel frames are derived renderer outputs.

The VFX-produced scene does not overwrite or become the original scene.

## Evidence gate

The dedicated workflow must prove all of the following on one exact PR head:

- Creative Render unit tests pass;
- current pinned Universal Creation Creative Flow passes;
- direct-sample source SHA-256 equals the original scene SHA-256;
- VFX source digest equals that same scene SHA-256;
- voxel state is explicitly derived/rebuildable;
- triangle surface is explicitly derived/rebuildable and points back to the voxel digest;
- surface adapter input mesh digest equals the VFX surface digest;
- generated `AXM_SCENE 1` triangle count equals the VFX surface triangle count;
- original and derived scenes are byte-distinct;
- all retained Render Fabric tests pass;
- original source scene renders and independently passes receipt replay;
- VFX-derived surface scene renders and independently passes receipt replay;
- source and derived frame bytes are distinct in the exercised proof;
- final evidence binds source scene, VFX state, mesh, derived scene, both requests, both render receipts and both frames.

## Four roots

- **Truth:** source geometry, sampled state, voxel state, extracted surface, lossy adapter and renderer pixels remain separate evidence planes.
- **Agency / non-domination:** the source scene is never silently replaced by the VFX-derived scene; donor graph ownership and adapter losses are explicit.
- **Continuity:** source SHA-256 -> sample identity -> VFX voxel/mesh digests -> derived scene SHA-256 -> render receipts remains inspectable end to end.
- **Wisdom before speed:** prove one bounded triangle-surface roundtrip before inventing a universal geometry interchange or claiming whole-world VFX mutation.

## Truth boundary

A passing v0.14 proof does **not** establish semantic topology recovery, source-mesh equivalence, normal/material/UV/skin/animation/collision preservation, physically correct holography, native VFX lighting integration, visual or cinematic quality, whole-world conversion, game-world correctness, useful performance, browser/GPU parity, or cross-machine bitwise determinism.

It proves only that a real donor VFX reconstruction Hand can produce bounded derived triangle geometry that crosses an explicit lossy adapter and becomes independently verified pixels in the owned native renderer while the original caller state remains separately bound.
