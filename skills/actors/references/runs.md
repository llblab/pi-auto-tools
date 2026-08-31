# Runs

Use a Run when execution may outlive the current turn, needs declared Control, produces retained artifacts/evidence, fans out, or must remain inspectable.

## Launch

```text
spawn recipe=<skill>/<recipe> values={...} as=run:<id>
```

Use the owning capability Skill to choose the Recipe and capability-specific values. Retain the returned Run id. A spawn result reports `launch_kind: "spawn"`; it is never evidence of registered-tool invocation.

A rare Skill Recipe may declare `singleton: true`. Do not pass `as`: the runtime derives `run:<skill>` plus the canonical `<skill>/<recipe>` identity, allows at most one singleton Recipe per Skill, and returns the same compatible healthy active Run instead of launching a duplicate. Contradictory Recipe identity, startup values, Control, or ownership fails closed. Delegation inherits both singleton identities instead of retargeting them. A terminal result is never reused; after its runner exits, restart keeps the logical Run id but creates a new fenced generation. Continuity still depends on actor-owned validated state, not the Run id alone.

## Observe

Normally wait for the settled completion batch. Inspect only when requested, when meaningful attention arrives, or when the Run is overdue or blocked:

```text
inspect target=run:<id> view=recipe
inspect target=run:<id> view=trace
inspect target=run:<id> view=control
```

Trace is bounded retained observation, so read its completeness summary. Prove final outcomes with terminal status, result, declared artifacts, and execution evidence rather than assuming retained Trace is exhaustive.

## Control

Send an actor-local action only when the root Recipe declares and implements it:

```text
message target=run:<id> action=<declared-action> input={...}
```

Inspect Control when readiness, capacity, stale work, or saturation matters. Put large data in an artifact and send only a bounded reference or instruction. Use runtime-owned termination for a stuck Run rather than inventing undeclared service actions.

Control is not actor chat, peer routing, or a task inbox. A Recipe import does not create a peer actor. Several actors/subagents require the `swarm` methodology in addition to these Run mechanics.

## Safety

Operate only on owned Runs and their active generation. Never edit Run state to force an outcome, bypass process identity checks, or signal processes directly from UI/instruction code. Restart creates new generation-local evidence; inspect the exact generation before destructive lifecycle action.
