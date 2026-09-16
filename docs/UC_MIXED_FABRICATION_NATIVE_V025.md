# UC mixed fabrication native proof — v0.25

## Question

Can Creative Render consume the **current real Universal Creation v0.7 mixed same-axis fabrication route**, preserve the caller-selected root asset as authority, retain exact hash-linked continuation evidence, and prove that a hole-plus-notch candidate and its resumed successor reach native Render Fabric pixels?

## Pinned bodies

- Creative Render base: `a2c4bf7a7198b69b58ebebbe1937e99271cf6d68`
- Universal Creation: `dde8d952161788f8bf21118f91edd3163e51277d`
- Render Fabric: `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

Universal Creation v0.7 is exercised through its public `mesh-mixed-fabrication-chain` route and `axm.mesh-mixed-fabrication-chain/v0.7` contract. Creative Render does not copy the cutter implementation.

## Executable chain

```text
caller-selected read-only rectangular stock GLB
    -> current UC v0.7 mixed route
       round-through-hole + boundary-open box-notch
    -> derived stage-one GLB + lineage receipt
    -> exact parent GLB / lineage resume
       append second box-notch
    -> derived stage-two GLB + lineage receipt
    -> explicit UC surface -> AXM_SCENE 1 adapter
    -> native Render Fabric
    -> receipt replay + pixel evidence
```

The proof chooses the fabrication axis so the bounded cut cross-section appears in the fixed reference renderer's X/Y proof view. That is an evidence-view choice, not a general camera or visibility claim.

## Required evidence

The lane fails closed unless all of the following remain true:

- the root GLB is byte-identical after both derived stages;
- the first candidate contains exactly one round hole and one box notch;
- the resumed candidate contains the retained hole/notch plus one appended notch;
- stage two points to the exact stage-one lineage digest;
- retained operations and hash-linked steps are unchanged across resume;
- current UC reports exact v0.7 reconstruction before continuation;
- non-overlap/non-touch and one closed oriented component gates remain true;
- removed-volume evidence increases after the appended cut;
- donor publication bytes match deterministic direct-build bytes;
- root, stage one and stage two become three same-albedo renderer-neutral scenes;
- each scene independently passes native Render Fabric receipt replay;
- the three proof frames are distinct in the declared fixed proof view.

The workflow uploads its proof directory with `if: always()` so a failed experiment keeps whatever evidence was produced before the failure instead of being made invisible by weakening a gate.

## Authority

- root GLB: **caller-selected read-only source**;
- mixed GLBs / UC surfaces: **derived fabrication candidates**;
- lineage receipts: **derived UC evidence**;
- AXM scenes: **derived renderer-adapter state**;
- requests / receipts / pixels: **derived Render Fabric bodies**.

No downstream candidate silently replaces the source.

## Four-root gate

- **Truth:** exact GLB, lineage, operation, scene, receipt and frame identities remain separate evidence planes; unsupported expansion fails closed.
- **Agency / non-domination:** the caller chooses the source, axis and ordered cuts; neither UC nor Creative Render silently promotes a candidate to canonical source.
- **Continuity:** continuation requires exact prior output and lineage, retains prior operation/step history, and writes a new receipt rather than rewriting the parent.
- **Wisdom before speed:** this gate exercises only the bounded current v0.7 capability before claiming general CSG, manufacturing behavior, or live-world editing.

## Not proven

This lane does not prove cross-axis fabrication, overlapping/touching cuts, arbitrary imported-mesh surgery, general 3D boolean CSG, rich material/UV/skin/rig/animation preservation through the tiny scene adapter, cryptographic authorship, self-intersection freedom beyond the donor's explicit gates, structural strength, real manufacturing correctness, host-engine import, visual quality, arbitrary-camera observability, real-time performance, or cross-machine bitwise determinism.
