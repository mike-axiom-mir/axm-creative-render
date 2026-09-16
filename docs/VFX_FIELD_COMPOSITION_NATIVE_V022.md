# VFX field composition -> native pixels — v0.22

This gate consumes the current Visual Effect Fabric `fx.field.compose2d` body instead of copying its scalar-field algebra into Creative Render.

## Executed chain

```text
canonical VFX scalar-field source A
                    +
canonical VFX scalar-field source B
                    |
          neutral composition source
          /                     \
   multiply                   add-clamp
      |                           |
derived rebuildable grid    derived rebuildable grid
      |                           |
explicit scalar->albedo AXM_SCENE adapters
      |                           |
receipt-verified Render Fabric native pixels
```

Both branches use the exact same two canonical input-field source hashes. The challenge changes only the neutral composition operation. The composition source therefore changes, followed by the rebuildable sampled grid, derived visualization scene, and derived native pixels.

## Authority boundary

- input field A/B: canonical VFX scalar-field sources;
- composition request/source: canonical neutral VFX composition truth for those inputs;
- retained scalar grid: derived and rebuildable working set;
- AXM scene: derived replaceable visualization adapter body;
- PPM frame: derived Render Fabric output.

The adapter deliberately uses fixed XY tiles. Scalar samples change only a declared RGB albedo mapping. This avoids pretending that scalar values are geometry, height, material semantics, physics, visibility, smoke, fire, weather, gameplay, or anything else.

## Exact pinned donors

The dedicated workflow pins:

- Visual Effect Fabric `33c444bc2569cba63123ee1ef4d074f80654c225` — reusable two-field composition v0.1;
- Render Fabric `6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b` — native reference renderer and receipt verifier.

A later donor revision inherits none of this evidence automatically.

## What green CI may prove

A green exact-head lane may establish that the pinned VFX donor executes the real two-field graph repeatably for `multiply` and `add-clamp`; both operations retain identical input source hashes; their canonical composition hashes and derived grid hashes differ; both derived grids cross the same bounded explicit visualization adapter; and both resulting AXM scenes become independently receipt-verified native pixels whose bytes differ.

## What it does not prove

This gate does not prove aesthetic quality, semantic masking, visibility truth, material behavior, physical simulation, smoke/fire/weather meaning, gameplay meaning, continuous-field equivalence beyond the sampled grid, real-time performance, GPU/browser parity, or cross-machine bitwise determinism.

The visual body remains replaceable. Green pixels do not acquire authority over the field sources or composition source.
