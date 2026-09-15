# Foundation

## Research question

Can creative capability become a first-class operator over canonical visual/world state instead of existing only inside a separate human-facing editor?

The intended long-term pattern is:

```text
state -> operator -> state -> render -> evidence
```

and later, where earned:

```text
live state -> operator -> live state -> render/observe -> revise
```

## Separation of concerns

### AXM Creative Render owns

- creative-operator contracts;
- deterministic/bounded state transforms;
- operator receipts and lineage;
- experiments that connect creative tools to render, frame, video, or world state;
- evidence about whether an operator produced the declared change.

### AXM Render Fabric owns

- renderer contracts and renderer bodies;
- scene/request/capability/receipt rendering boundaries;
- pixel production and renderer evidence.

Creative Render must not quietly become a competing renderer.

### Donor systems remain independent

Universal Creation, FrameState, Profession Fabric and Floorborn remain separate repositories. v0.1 imports **ideas/contracts by deliberate reimplementation or later adapters**, not hidden code copies or runtime coupling.

## Operator principle

A creative operator should eventually declare identity/version, accepted and emitted domains, parameters, deterministic/learned/external status, evidence behavior, failure behavior, provenance, any professional body consulted, and whether it mutates canonical state, proposes a candidate, or only observes.

The v0.1 JSON operator contract freezes only what the current executable proof uses.

## Machine-native implication

A human may need buttons, layers, timelines and gizmos to access creative machinery. A machine does not necessarily need to imitate those controls if the underlying operator contract is explicit.

That does **not** mean a machine receives hidden authority. It means the machine may use the same lawful state transition directly when the product/world contract permits it.

## First evidence gate

v0.1 must prove:

1. strict parsing of the current minimal `AXM_SCENE 1` subset;
2. one or more explicit deterministic creative operators;
3. deterministic canonical output bytes;
4. exact SHA-256 lineage for input, operator and output;
5. refusal of unknown scene/operator versions or unsupported operator kinds;
6. no renderer, donor repo, or professional-body claim beyond what is actually invoked.

## Four roots

- **Truth:** receipts bind exact bytes; unsupported semantics fail explicitly.
- **Agency / non-domination:** an operator is selected explicitly; no silent mutation or renderer substitution.
- **Continuity:** input state is never overwritten by default; output is a new inspectable state with lineage.
- **Wisdom before speed:** start with a tiny executable scene transform before attempting live games, video, AI observers or large tool ingestion.
