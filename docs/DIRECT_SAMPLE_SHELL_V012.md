# Direct sample shell bridge v0.12

## Question

v0.11 proved that one exact `AXM_SCENE 1` can remain the source identity while two derived bodies are exercised from it: native Render Fabric pixels and Visual Effect Fabric direct-sample projection state.

v0.12 asks the next narrow question:

> Can that already-admitted direct sample state use Visual Effect Fabric's newer projected-shell machinery without being forced back through the donor's primitive/form sampler?

## Why this is a caller-composed Hand graph

The current VFX donor's stock `fx.holographic-state-shell` graph starts with:

`form-normalize -> form-sample -> creative-field -> visibility-fit -> shell state -> shell renderer`

That is correct when the caller supplies one of the donor's canonical/generic form descriptions.

Creative Render already has an explicit sample field derived from `AXM_SCENE 1`, with the complete scene SHA-256 retained as `sourceDigest`. Sending it back through `form-normalize -> form-sample` would discard the point of the direct-sample contract and would falsely imply that the caller scene had first become a VFX primitive/form model.

v0.12 therefore composes real donor Hands explicitly:

`sample-field-admit -> creative-field -> visibility-fit -> shell-projection-state -> shell-webgl`

The graph itself is owned by Creative Render and is named `axm.creative-render.direct-sample-shell`. The five execution Hands remain owned by Visual Effect Fabric. The receipt records both facts. We do **not** label the caller composition as a stock/canonical VFX graph.

## Pinned proof bodies

- Universal Creation: `c89839485a6d09a3e70dbd633c5f1292348f37b1`
- Visual Effect Fabric: `bed7e20374e27b8a6edc1772c606232b196a5869`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

## Expected bounded proof

The current UC proof scene has 12 triangles. The v0.11 direct-sample policy materializes:

- 3 exact vertices per triangle;
- 24 deterministic barycentric surface samples per triangle;
- total: **324 packed stride-7 points**.

That sample state enters the real VFX donor Hands above. The shell path must retain the exact complete AXM scene SHA-256 as both source identity and canonical source hash, preserve all 324 admitted points, pass repeat state/output verification, and produce the donor's current shell renderer:

`axm.vfx.holographic-state-shell/v0.4`

The current donor visual-language contract is also checked exactly:

- primary: `translucent-shell`
- secondary: `volumetric-glow`
- tertiary: `sparse-signal-noise`
- `brightSweep: false`

These fields describe the **declared realization hierarchy**. They are not evidence that a human observer judges the result beautiful, realistic, cinematic or even visually successful on every display/GPU.

## Shared-source continuity

The dedicated workflow independently sends the exact same `AXM_SCENE 1` file through native Render Fabric and its receipt replay verifier. Creative Render then binds:

- source scene SHA-256;
- shell receipt/state/HTML SHA-256;
- Render Fabric request/receipt/frame SHA-256;
- explicit authority labels.

The source scene remains caller state. The VFX sample state, shell HTML, and Render Fabric pixels remain derived expressions.

## Four-root gate

- **Truth:** the receipt distinguishes a caller-composed graph from donor-owned Hands, and distinguishes declared visual-language state from actual judged visual quality.
- **Agency / non-domination:** caller source state remains authoritative. Neither VFX nor the renderer silently replaces it.
- **Continuity:** exact scene identity must survive sample admission and shell realization while the same scene independently passes Render Fabric receipt replay.
- **Wisdom before speed:** reuse the donor's existing bounded shell Hands around a proven direct-sample boundary before inventing a new universal effect/render-pass contract.

## Truth boundary

A passing v0.12 proof does not establish:

- continuous reconstructed surfaces or physical holography;
- preservation of AXM scene albedo/material/normal/UV semantics in VFX state;
- visual, artistic or cinematic quality;
- identical appearance between shell HTML and native Render Fabric pixels;
- arbitrary whole-world conversion;
- browser/GPU performance or compatibility beyond the generated WebGL2 body;
- cross-machine bitwise determinism.

It proves only that one exact AXM scene identity can remain source truth while its bounded direct-sample projection is successfully consumed by the current VFX shell Hands and the same source remains independently renderable through the owned native renderer.
