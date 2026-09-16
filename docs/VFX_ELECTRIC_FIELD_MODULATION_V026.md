# VFX Electric Field Modulation — v0.26

## Executable question

Can Creative Render consume the current Visual Effect Fabric composed-field electric modulation graph, preserve the retained editable electric path state as the source body, and make only the donor's separately derived path-energy modulation observable through native Render Fabric pixels?

The exact donor pinned by the dedicated proof is:

- `mike-axiom-mir/axm-visual-effect-fabric@bfbc9ebeaed41fb6464be26ebbca35e4bdf18acb`
- `mike-axiom-mir/axm-render-fabric@6fd39ffa5566ce2f6f9e6452c4ec1fdc9603313b`

## Executable chain

```text
current VFX electric source + target + seed
  -> retained editable trunk/branch paths
  -> retained renderer-neutral energy profile
  -> canonical scalar field A + B
  -> canonical neutral field composition
  -> canonical neutral path-energy modulation source
  -> separate derived/rebuildable modulated path set
       |                         |
       |                         +-> explicit energy-to-albedo adapter
       +-> explicit base adapter
                    |
               AXM_SCENE 1 x 2
                    |
             native Render Fabric
                    |
       independent receipt replay x 2
                    |
                pixel evidence
```

Creative Render executes the donor Hand graph through the donor runtime twice and refuses the proof if the complete donor final-state hash changes.

## Preserved source authority

The donor's retained `paths` array remains the base electric state. Creative Render checks the donor's own `electricBasePathsHash` against the live retained array after the graph completes.

The modulated path body must remain:

- `axm.electric-modulated-path-set/v0.1`;
- explicitly `derived: true`;
- explicitly `rebuildable: true`;
- bound to the exact retained base-path hash;
- bound to the exact scalar-field sources, composition source, and modulation source.

The native visualization adapter requires identical path count, segment count, points, width, role/parent structure, and other non-energy retained path state. Energy and scalar-modulation annotations are allowed to differ. Phase is retained as donor state but is not realized by the current static native adapter.

## Explicit visualization boundary

The adapter turns each retained path segment into a bounded XY quad. Donor path width affects the quad width. Donor path energy affects only RGB albedo.

That means a passing proof may establish that the derived energy difference reached different native pixels while the renderer geometry remained identical. It must not be upgraded into a claim about physical electricity, lighting, bloom, atmosphere, pulse motion, gameplay, or aesthetics.

The current adapter intentionally does not realize the wider electric effect layers from `fx.electric-storm`; the modulation graph itself also does not claim those renderer layers.

## Failure policy

The bridge fails closed on unsupported graph/schema identity, donor repeat drift, base-path hash drift, scalar/composition/modulation lineage drift, topology drift, non-energy path-state drift, promoted derived authority, invalid normalized points, budget overflow, or a modulation that was expected to change energy but did not.

The CI artifact upload uses `if: always()` so failed evidence remains available without weakening the acceptance gate.

## Proven only when the dedicated workflow is green

A green `vfx-electric-field-modulation-native` workflow establishes only the bounded chain above for the pinned revisions and exercised request. In particular it requires both derived scenes to pass Render Fabric's independent receipt replay and requires their native frame bytes to differ.

## Not proven

- physical electricity or force simulation;
- light transport or scene-light interaction;
- bloom, atmosphere, or pulse realization;
- better visual quality or readability;
- gameplay hit logic, weather, notification, or world semantics;
- browser/GPU equivalence;
- target-device performance or real-time suitability;
- cross-machine bitwise determinism;
- authority for the derived modulated body to replace the retained electric source state.
