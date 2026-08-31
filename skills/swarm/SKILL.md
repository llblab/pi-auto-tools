---
name: swarm
description: Use when work needs multiple actors or subagents for independent implementation, artifact generation, review, delegated audit, research, or coordinated decomposition and integration.
---

# Swarm

Use multi-actor execution only when at least two scopes or evidence lenses are meaningfully independent and parallelism, clean-context judgement, or quorum confidence is worth the coordination overhead. Do not swarm a task that one bounded agent can complete safely, a task whose architecture is still unsettled, or concurrent mutations of one shared contract.

Read `actors` first for generic Recipe, spawn, Run, Trace, Control, artifact, and lifecycle operation. This Skill owns only multi-actor methodology: decomposition, scope ownership, independence, synthesis, integration, and completion proof.

## Coordinator topology

A swarm can be coordinated without an external gateway. In this model the current host agent is the declarative control plane, the actor kernel creates explicit participant Runs, and companion transports provide ingress or presence without owning hidden agent creation. The coordinator retains user authority, global context, decomposition, shared-surface ownership, integration, and final validation; participants own bounded concrete tasks and report evidence.

This resembles gateway orchestration in dependency direction but not in ownership: the coordinator is itself an agent instance with inspectable Runs, not an infrastructure service that implicitly creates sessions. Preserve that distinction in prompts, docs, recovery, and target routing.

Once work is delegated, keep the coordinator available for decisions and integration instead of duplicating participant implementation. Wait for the settled completion batch by default; use meaningful attention or evidence-based timers for overdue work rather than a tight inspection loop.

## Reasoning allocation

Allocate reasoning by role instead of making one long thread implement and judge itself:

- Bounded implementation/authorship participants default to reasoning off when the task card fixes scope, invariants, checks, and escalation. Enable reasoning only when unresolved diagnosis or local design judgement is part of their assignment.
- Reviewers default to independent medium reasoning and clean context. For consequential work, several reviewers with distinct lenses or repeated independent judgement usually provide better error discovery than increasing one author's reasoning and relying on self-review.
- Synthesizers and integrators use medium reasoning because they reconcile evidence, conflicts, shared contracts, and retained state.
- The coordinator decides whether review fanout is worth its cost, preserves dissent, and never treats reviewer count as evidence quality by itself.

Do not change a running participant's profile merely because policy changed. Replace or add a later independent review only when fresh evidence is still needed.

## Choose the shape

| Need | Shape | Primary Recipe |
| --- | --- | --- |
| Different risk lenses on one target | Lens swarm | `swarm/lens-review` |
| Independent judges for one exact claim | Quorum | `swarm/quorum-review` |
| Evidence map plus contradiction-preserving synthesis | Research swarm | `swarm/research-synthesis` |
| Competing architecture directions and one smallest next slice | Architecture swarm | `swarm/architect` |
| Bounded implementation assignment with scope critique | Development tasking | `swarm/development-tasking` |
| Multi-lens ship/readiness verdict | Readiness review | `swarm/review-readiness` |

Use different lenses for breadth and repeated independent judges for confidence. Combine both only for high-stakes work where the added cost is justified. `swarm/subagent-*` Recipes are maintained composition components; start from a primary Recipe unless building an intentional custom composition.

## Coordinator protocol

The coordinator owns the whole result even when participants choose local implementation details.

1. State the goal, non-goals, evidence standard, integration owner, and stop condition.
2. Partition work into disjoint read or write scopes. Give shared contracts one owner.
3. Give each participant a bounded task card with allowed scope, avoided scope, expected artifact, checks, and escalation rule.
4. Assign each participant an explicit execution profile and isolation mode under the reasoning-allocation contract.
5. Preflight required model/tool access before expensive fanout.
6. Launch independent work without cross-contaminating lenses. Do not let participants silently expand scope.
7. Preserve every terminal result, including failures, disagreements, and partial evidence; avoid doing participant work in the coordinator while a valid owner remains active.
8. Merge through one named synthesizer or integrator. Resolve conflicts from explicit intent and invariants, not textual convenience.
9. Run fresh integrated validation and, for consequential outputs, an independent post-merge review.
10. Report complete, degraded, or insufficient-data status honestly; name residual owners and next actions.

## Scope and coordination rules

- One writable scope has one owner. Parallel readers may share a stable target.
- Public contracts, schemas, central configuration, and integration surfaces require exclusive ownership.
- Concurrent writers use disjoint paths, isolated worktrees, or declared patch/artifact outputs.
- Shared ledgers, lockfiles, generated contracts, metadata, schemas, release surfaces, and cross-domain configuration belong to one named integrator unless a task card transfers one surface to another exclusive owner.
- Participants record shared-surface and other out-of-scope needs in handoff instead of editing them opportunistically.
- Reasoning and model profiles are task-card inputs, not implicit properties of the whole swarm.
- Coordinator checkpoints are bounded decision requests, not free-form actor chat.
- Locks support scope ownership but do not replace coordinator judgement. Every lock must be bounded and releasable.
- One integrator owns merge order, conflict resolution, and final validation.
- A zero-conflict merge is not proof of semantic compatibility.

## Evidence and quorum rules

- Every material finding traces to inspected evidence or explicit uncertainty.
- Preserve minority high-impact findings and contradictions; consensus does not erase them.
- Keep reviewer evidence separate from merger findings.
- If successful evidence is below the requested threshold, return degraded or insufficient data instead of inventing quorum.
- Use a clean-context merger for serious quorum work. Use a fresh post-merge reviewer when the result drives code, security, architecture, money, governance, migrations, or release decisions.

See [review swarms](./references/review-swarms.md) for lens, quorum, synthesis, and conflict-evidence detail. See [development swarms](./references/development-swarm.md) for task cards, write ownership, handoffs, conflict reports, and integration.

## Stop rules

Stop or replan when scopes overlap, a participant needs an undeclared shared contract, evidence cannot meet the threshold, provider/tool preflight fails, conflict changes the architecture, no integrator owns the result, or integrated validation is unavailable. Do not compensate with extra agents, repeated blind retries, shared mutable work, or coordinator-written consensus unsupported by participant evidence.
