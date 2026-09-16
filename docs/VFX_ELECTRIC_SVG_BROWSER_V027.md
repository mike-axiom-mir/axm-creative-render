# VFX electric SVG browser observation — v0.27

## Purpose

Close the current Visual Effect Fabric donor's explicit observation gap without promoting a render body into source truth.

The pinned donor is `mike-axiom-mir/axm-visual-effect-fabric@0ddf38f2c3aa3f5dc3b68bb82944508fe04fb7a4`, which adds `fx.electric-storm.modulated-svg`. That donor keeps retained electric paths authoritative, stores composed-field modulation as a separately derived/rebuildable path set, and selects that derived set only through a disposable view into the existing SVG preview renderer.

Creative Render v0.27 executes that real graph, checks that its base/modulated path identities match the donor's pre-render modulation graph, retains exact SVG bytes, and builds a local fixed-size browser probe. CI then uses an installed Chromium-family browser to decode and rasterize the exact hash-bound ordinary and modulated SVGs at 1000x600 RGBA8. Raw Canvas2D pixel evidence is compared inside the browser and retained alongside two browser screenshots.

## Authority boundary

- retained VFX base paths remain source state;
- scalar-field, composition, and modulation sources remain canonical donor sources;
- the modulated electric path set remains derived and rebuildable;
- ordinary/modulated SVGs remain derived and replaceable VFX realizations;
- the probe HTML is a replaceable observer body;
- RGBA samples and screenshots are derived browser evidence only.

A zero-strength fixture must keep the derived lineage separate while producing SVG bytes identical to the ordinary SVG donor. Non-zero modulation must preserve the pre-render modulation identities and produce a measurable raw browser-pixel difference.

## Proven by this lane

The exact current donor graph can select its separately derived modulated path set for the existing SVG donor without rewriting retained base paths; the ordinary and modulated SVG bytes are hash-bound to their respective source identities; and a real headless Chromium-family browser can decode/rasterize those exact artifacts into observably different RGBA pixels for the non-zero fixture.

## Not proven

This lane does not claim that modulation is aesthetically better, more readable, physically electric, lighting-correct, accessible, performant in real time, suitable for gameplay/world semantics, GPU-equivalent, target-device-equivalent, or bitwise deterministic across browser versions or machines. The retained screenshots are visual artifacts, not independent aesthetic judgments.

Failures remain evidence: the workflow uploads its proof directory with `if: always()` and does not weaken pixel, lineage, or source-authority gates to obtain green CI.
