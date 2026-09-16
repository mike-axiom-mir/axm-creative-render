# VFX -> Universal Creation live edit v0.15

## Question

Can geometry created as a **derived VFX render body** be handed directly to Universal Creation's real Creative Flow, creatively changed there, and then returned to the owned native renderer without any system silently claiming that derived geometry became the original world truth?

v0.14 proved:

`source AXM scene -> direct samples -> VFX voxel density -> VFX triangle shell -> AXM scene -> native Render Fabric`

v0.15 adds the missing creative-machine loop:

`source AXM scene -> direct samples -> VFX voxel density -> VFX feature-preserved triangle shell -> caller precision-mesh adapter -> real UC Creative Flow -> edited precision mesh -> AXM scene -> native Render Fabric`

## Current pinned bodies

- Universal Creation: `49ef11ca42b2079dffbd595daa8ea8626b99d2ab`
- Visual Effect Fabric: `f26cb987d31df8a153675f805b6b8579a9f21f96`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

The Universal Creation pin includes the newly merged physics-core growth, but this v0.15 proof exercises the public Creative Hands / Creative Flow surface only. It makes **no physics claim**.

The Visual Effect Fabric pin is newer than v0.14. It adds bounded normal-aware feature-preserving refinement after marching-tetrahedra extraction. Creative Render therefore exercises a caller-composed direct-sample path ending in the current `axm.vfx.holographic-voxel-surface/v0.7` realization.

## Explicit creative edit

The refined VFX triangle shell is admitted as caller-owned `axm.precision-mesh/v1` state. The adapter:

- carries derived VFX positions and normals;
- makes each triangle's three vertices explicit with sequential indices;
- writes zero UV placeholders because the VFX shell has no authored UV semantics;
- records that semantic topology and UV preservation are **not** proven.

Universal Creation then receives that mesh in the **initial Creative Flow state**. It is not recreated through a primitive Hand and it is not silently copied into donor authority.

The current bounded edit is:

1. `creative.mesh-deform.twist` — 22 degrees;
2. `creative.mesh-transform.translate` — +0.18 on X;
3. `creative.mesh-analysis.bounds` — evidence-only inspection.

Creative Flow must report `source_state_mutated: false`, all receipts must pass, and a repeated execution must return the same flow and edited-mesh identity in the exercised pinned environment.

## Native render gate

The dedicated workflow independently renders and receipt-verifies three bodies through the owned native Render Fabric:

1. untouched source `AXM_SCENE 1`;
2. refined VFX-derived surface before the UC edit;
3. UC-edited derived surface.

The surface and edited render inputs use the same declared constant albedo. Their scene-byte and frame-byte differences therefore cannot be explained merely by choosing different colors in the adapter.

This still is **not** a visual-quality test. Distinct verified pixels prove that the exercised geometry edit reached rendering, not that a human would prefer the result.

## Authority

- Original AXM scene: caller/source state.
- Direct samples: derived projection state.
- VFX voxel density: derived/rebuildable VFX state.
- VFX raw/refined triangle shell: derived/rebuildable VFX state.
- Precision-mesh adapter: derived caller adapter state.
- Universal Creation edited mesh: derived creative candidate with UC-owned operation receipts.
- Surface/edited AXM scenes: derived renderer inputs.
- Render Fabric pixels: derived renderer outputs.

No derived body silently replaces the source scene.

## Four-root gate

- **Truth:** every transition keeps separate digests/receipts; VFX refinement, UC operation receipts and renderer receipts are distinct evidence planes.
- **Agency / non-domination:** source state is not overwritten, caller supplies the mesh, UC executes explicit named Hands, and neither VFX nor UC is granted canonical-world authority.
- **Continuity:** source SHA-256 survives into VFX admission; refined mesh lineage survives into the precision adapter; UC edit identity survives into the edited renderer input; before/after bodies are independently receipt-verified.
- **Wisdom before speed:** one small bounded creative deformation loop is proven before attempting open-ended machine creativity inside a game world.

## Truth boundary

A passing v0.15 proof does **not** establish:

- semantic object/part correspondence;
- source-authored topology recovery;
- UV/material/skin/skeleton/animation/collision preservation;
- physically correct holographic reconstruction;
- physics correctness despite the current UC donor containing a larger physics body;
- autonomous artistic judgment or purposeful aesthetic improvement;
- direct mutation of a live game world;
- useful real-time performance;
- cross-machine bitwise determinism.

The narrow claim is stronger and simpler: **derived geometry produced by one AXM creative/render body can be consumed directly by another AXM creative body through its real public machine-facing state interface, changed there, and returned to the native renderer with inspectable lineage and without stealing source authority.**
