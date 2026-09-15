# AXM Creative Render

AXM Creative Render is an experimental bridge between **creative capability** and **render/world state**.

The first question is deliberately small:

> Can a creative tool operate directly on renderer-consumable scene state, produce a new inspectable state, and leave exact evidence of what changed?

The long-term direction is larger: the same operator model may later act on still renders, live game worlds, animation/video timelines, websites, and other machine-visible creative surfaces without forcing a machine to imitate a human clicking through a GUI.

## v0.1 executable foothold

This repository currently contains a dependency-free Node.js prototype that reads the frozen minimal `AXM_SCENE 1` triangle/albedo subset used by `axm-render-fabric`, applies one explicit creative operator, and writes a new `AXM_SCENE 1` file plus an `AXM_CREATIVE_RECEIPT 1` evidence record.

Implemented operators:

- `tint` — deterministic RGB channel scaling
- `translate` — deterministic XYZ translation of every triangle vertex

Example:

```bash
node src/cli.mjs apply \
  --scene examples/reference.axmscene \
  --operator examples/tint.operator.json \
  --out build/tinted.axmscene \
  --receipt build/tinted.receipt.json
```

Run verification:

```bash
npm test
```

This proves **creative state mutation before rendering**. It does not yet prove live renderer injection, frame/post-processing operators, game-world mutation, video integration, AI visual judgment, or direct integration with the donor repositories below.

## Research shape

```text
creative intent / tool / profession
              |
              v
      CREATIVE OPERATOR
              |
       canonical state
              |
              v
       AXM Render Fabric
              |
           pixels
              |
        evidence/observer
```

Future operator domains may include scene, material, lighting, camera, procedural/effect, frame/pixel, temporal/video, and live world/game state.

The renderer remains a renderer. This repository studies the creative machinery that can act around or through it.

## Donor / neighboring systems

The starting donor map is intentionally explicit rather than silently merging repositories:

- `mike-axiom-mir/axm-render-fabric` — active interoperability target and rendering/evidence substrate.
- `mike-axiom-mir/axm-universal-creation` — active donor for creation machinery, organs, capability gaps, asset/creation structures and machine-native creation.
- `mike-axiom-mir/axm-framestate` — active donor for canonical state through time, effect organs, frame evidence, compositing and future video/animation paths.
- `mike-axiom-mir/axm-profession-fabric` — active donor for professional bodies such as 3D/technical art, art direction, cinematography and video editing; professional knowledge does not become automatic authority.
- `mike-axiom-mir/axm-floor-born` — exploratory donor for a later question: can a machine occupy an ordinary world/player seat and create from *inside* a live world through equal legal interfaces? It is not required for v0.1.

See `DONORS.md`.

## Four roots

Internal adoption is gated by:

1. **Truth**
2. **Agency / non-domination**
3. **Continuity**
4. **Wisdom before speed**

No founder, model, profession body, renderer, or Git permission is by itself the constitutional merge gate.

## Current truth boundary

v0.1 is a **state-operation experiment**, not a creative studio and not a new renderer.

It currently proves that one deterministic tool can:

`AXM_SCENE 1 -> explicit operator -> AXM_SCENE 1 + receipt`

It does not claim visual quality, semantic understanding, renderer equivalence, GPU behavior, live game editing, video editing, professional competence, or autonomous creativity.

See `FOUNDATION.md` and `docs/TRUTH_BOUNDARY.md`.
