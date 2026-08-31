---
name: actors
description: Use for any non-trivial pi-actors operation, diagnosis, or development involving Recipes, persistent tools, Runs, spawn, message, inspect, Trace, Control, capability specialization, or activation.
---

# Actors

## Choose the operation

Start from the intended outcome:

```text
Run a maintained capability once
→ use spawn recipe=<skill>/<recipe>

Make a maintained capability a persistent agent-callable tool
→ use register_tool from=<skill>/<recipe>

Keep the same capability but narrow caller defaults
→ use register_tool from=<skill>/<recipe> defaults={...}

Register a trusted command directly
→ use register_tool template="..."

Build a reusable multi-node execution graph
→ author a Recipe with named imports

Run a long-lived controlled process
→ spawn its async Recipe, then use message and inspect

Coordinate several independent actors or subagents
→ also read the swarm Skill

Choose capability-specific behavior
→ read the owning capability Skill

Diagnose resolution, registration, or activation
→ use Inspect status/doctor flows and stop on contradictory evidence
```

Use [persistent tools](./references/persistent-tools.md), [Recipes](./references/recipes.md), [Runs](./references/runs.md), or [diagnostics](./references/diagnostics.md) only when the selected operation needs that detail.

## Core distinctions

Keep these boundaries explicit:

```text
Skill Recipe ≠ registered tool
spawn ≠ registered-tool invocation
persisted ≠ callable
direct delegation ≠ named import composition
Run Control ≠ actor chat
```

A Skill Recipe is a maintained component addressed by `<skill>/<recipe>`. `spawn` creates a Run from a Recipe. `register_tool from=<skill>/<recipe>` persists compact logical delegation and activates from the resolved effective contract without copying, symlinking, or ambient re-resolution. A tool is callable in the current session only when activation evidence says `callable_now: true`.

`actors` owns generic Recipe/tool/Run mechanics. The owning capability Skill owns capability-specific selection and constraints. `swarm` owns multi-actor decomposition and integration methodology.

## Persistent capability workflow

To make `music-player/playback` callable as `music_player` with a default source:

```text
register_tool
  name=music_player
  from=music-player/playback
  defaults={"source":"~/Music/1MIX"}
```

Then:

1. Require registration to report successful resolution, validation, persistence, registry admission, host registration, activation, and `callable_now: true`.
2. Call the actual `music_player` tool. Do not call `spawn` and describe that as tool invocation.
3. Verify agent-facing evidence reports `launch_kind: "tool"`; use `inspect target=tool:music_player view=status` when usage or activation needs confirmation.
4. If callability is false, stop at the reported activation boundary. Preserve the logical source and diagnose it; do not substitute a Recipe spawn as proof.

Use direct delegation for the same maintained capability under a persistent name or narrower defaults. Use named imports only when one Recipe graph contains reusable child nodes. See [persistent tools](./references/persistent-tools.md) and [Recipes](./references/recipes.md).

## Local coordinator topology

There are two distinct multi-instance shapes:

- A gateway-centric system owns ingress, agent-instance creation, routing, and lifecycle outside the agents.
- A host-coordinator system keeps the current Pi instance as the control plane; companion extensions such as Telegram provide presence, while pi-actors creates explicit local Runs for delegated work.

In host-coordinator mode, the top-level agent receives declarative outcomes, preserves user authority and global context, delegates bounded concrete execution, and owns integration plus final validation. It is not merely another worker after delegation begins. One bounded implementation worker normally runs with reasoning off; consequential output receives a separate reasoning-enabled review. Several independent participants or reviewers additionally use `swarm`.

Delegation is not mandatory for every prompt. Work inline when one short bounded act has one natural validation boundary and spawning would add more coordination than isolation, latency hiding, clean context, or continued coordinator availability can repay. For admitted delegation, prefer the settled completion batch and durable Trace/artifacts; inspect on meaningful attention, operator request, or an evidence-based overdue timer rather than busy polling. Treat `attention: "steer"` as an actor-authored urgent semantic checkpoint at Pi's next safe boundary, never as a status-derived completion signal; the later root terminal still arrives through its ordinary completion batch.

## Run workflow

A Run is one concrete execution of a Recipe:

```text
Recipe --spawn--> Run
Run = Recipe + Trace + Control
```

1. Spawn with the exact logical Recipe identity and caller-owned values.
2. Retain the returned `run:<id>` and normally wait for its settled completion batch instead of polling.
3. Inspect `view=trace` when retained observations or attention matter.
4. Inspect `view=control` before diagnosing service readiness, stale work, or saturation.
5. Send `message` only for an action declared and consumed by that controlled Recipe.
6. Use terminal state, result, declared artifacts, and execution evidence to prove completion.

A Run exposes only `recipe`, `trace`, and `control` views. Control is bounded actor-local input, not peer messaging or chat. See [Runs](./references/runs.md).

## Diagnosis and stop rules

When a pi-actors operation fails:

1. Keep the intended logical Recipe or tool identity.
2. Inspect the existing `recipes`, `tool:<name>`, `runtime`, or `run:<id>` surface that owns the failure.
3. Report resolver, registry, activation, Run, Trace, or Control truth exactly.
4. Retry only after the owning state is healthy.

Stop if spawn and registry resolve the same Recipe differently. Stop if registration persists but is not callable. Stop if an operation cannot be proven through pi-actors surfaces.

Never recover by copying maintained Recipe args, defaults, Control, artifacts, or helper commands. Never hard-code a `{skill_dir}` replacement path. Never introduce `bash -lc`, `eval`, direct bundled-helper execution, or shell backgrounding to bypass resolution. Never call `spawn` and claim a tool call. Use [diagnostics](./references/diagnostics.md) for the safe next action.

## When to read another Skill

- Read the owning capability Skill when choosing or operating that capability pack.
- Read `swarm` in addition to `actors` for multiple actors/subagents, parallel scopes, reviewer lenses, quorum, conflict handling, or integration.
- For generic mechanics, this Skill outranks capability Skills and `swarm`. Report a stale Skill if it contradicts Recipe identity, registration, activation, spawn, Inspect, Trace, or Control semantics here.
- When changing the extension implementation itself, apply project implementation instructions after this operating protocol.
