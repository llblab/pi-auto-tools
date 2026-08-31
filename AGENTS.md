# Project Context

## Meta-Protocol Principles

- `README.md` and `docs/`: human-facing product entrypoint, concepts, and reference.
- `skills/`: agent-facing operating protocols and Skill-local operational references.
- injected system prompt: routing-only meta-protocol that selects the owning Skill.
- `AGENTS.md`, source, and tests: implementation protocol and executable evidence.
- `BACKLOG.md`: canonical future-only work.
- `CHANGELOG.md`: completed delivery history.

Do not make normal-use Skills depend on README/docs, do not copy Skill operating manuals into the system prompt, and do not present implementation evidence as the agent operating path. Keep these surfaces distinct and reconcile them after meaningful changes. Every release section, historical or new, keeps at most 8 outcome records of at most 512 characters.

## Concept

`pi-actors` is a local Run kernel and persistent capability registry for Pi:

```text
Recipe --spawn--> Run
Run = Recipe + Trace + Control
```

An actor is any runnable local capability, including a script, tool, service, pipeline, or subagent. Recipes define actors' reusable execution. Runs are concrete actor instances and own one generation of execution and evidence. Trace owns observations. Control owns actor-local inputs for services that actually consume them. `register_tool` persists capabilities separately.

Public Run verbs remain `spawn`, `message`, and `inspect`.

## Core Structure

```text
Pi host
  -> index.ts                         composition root
     -> lib/tools*.ts                 public tool adapters
     -> lib/runtime.ts / registry.ts  active user Recipe tools
     -> lib/recipes-*.ts              Recipe resolution/evolution
     -> lib/async-runs.ts             Run lifecycle facade
     -> lib/runs-*.ts                 focused lifecycle/evidence domains
     -> lib/observability.ts          terminal + Trace-attention observation
     -> lib/inspector*.ts             owner-filtered actor-instance inspection
     -> scripts/*.mjs                 process/service entrypoints
     -> skills/*/recipes/*            Skill-owned Recipe components
     -> skills/*                      agent operating protocols
     -> README.md / docs/*            human product guidance
```

`index.ts` wires Pi ports and must not own domain behavior. Keep the local TypeScript import graph acyclic. For architecture-affecting work, load and follow `.agents/skills/domain-dag/SKILL.md`; its validator is local agent tooling, not an npm, CI, or release gate.

## Key Domains

- `extension-runtime.ts`: low-level Pi session lifecycle, tool adaptation, and runtime service composition behind the thin `index.ts` event-registration root.
- `command-templates.ts`: portable synchronous execution graph.
- `recipes-references.ts`, `recipes-discovery.ts`, `recipe-control.ts`: Recipe resolution, imports, shadowing, and Control declarations.
- `async-runs.ts`: lifecycle facade.
- `runs-start.ts`, `runs-status.ts`, `runs-control.ts`, `runs-control-delivery.ts`, `runs-controls.ts`, `runs-trace.ts`, `runs-process.ts`, `runs-retention.ts`, `runs-parent-teardown.ts`: focused Run internals.
- `execution-sessions.ts`, `trace-projection.ts`, `control-projection.ts`, `session-evidence.ts`: bounded/redacted execution and inspection evidence.
- `tools-message.ts`: exact Control facade.
- `tools-inspect.ts`: exact `run:<id>`, `runtime`, `recipes`, and `tool:<name>` inspection.
- `runtime-identity.ts`, `runtime-triage.ts`: immutable package/schema identity and pure pending/stale Control classification.
- `tools-spawn.ts`, `tools-register.ts`, `tools-local.ts`, `tools-response.ts`: Run creation, persistent capabilities, Recipe-backed tools, and compact results.
- `inspector.ts`, `inspector-overlay.ts`, `inspector-command.ts`, `inspector-actions.ts`: actor-instance Recipe/Trace/Control projection, navigation, command wiring, and fenced actions. **Actor Inspector** remains the product and command name, not a separate domain.
- `observability.ts`, `run-ui-runtime.ts`: Trace attention, terminal reconciliation, and Pi follow-up delivery.
- automatic draft/tool review domains: structurally redacted model review, journaled mutation, lineage, recovery, and explicit retry/reset safety.

The bundled Skill Recipe dependency DAG is `artifacts → actors, swarm` and `project-work → actors, artifacts, swarm`; `actors`, `music-player`, `swarm`, and `recipe-memory` have no cross-Skill Recipe dependencies.

Scripts remain self-contained when no non-script consumer justifies a TypeScript domain. Command-template script leaves infer `.js`/`.mjs` in order through Node, Bun, or `deno run` and `.sh` through Bash without shell evaluation. Helper-backed Skill Recipes self-locate through runtime-owned `{skill_dir}`. Recipes stay optional, composable, policy-light, and caller-configurable.

## Operating Principles

### Recipe

- Skill Recipe identity is `<active Skill name>/<Recipe filename stem>`; Recipe files have no top-level `name`. `SKILL.md` `name` is Pi host metadata matching the Skill directory, not a second pi-actors identity field.
- Recipe files may define args/defaults, imports, artifacts, command-template flags, and `control`.
- Declare actor-local actions only when a long-lived process implements them.
- Actions are lowercase, unique, and cannot use runtime-reserved lifecycle names.
- Removed communication-plane metadata fails explicitly; never translate it.
- User Recipes are discovered only from the persistent user registry; Skill Recipes are exact components outside tool discovery. Explicit entry paths resolve from invocation `cwd`; relative imports resolve from their importing file.
- Files over 1 MiB, import depth over 32, and import cycles fail closed.

### Trace

Canonical event:

```json
{"id":"…","ts":"…","kind":"…","summary":"…","data":{},"level":"info","attention":"notify"}
```

Trace is a bounded retained suffix, not an audit archive. Every first-party writer must call `appendRunTraceEvent`; under the canonical token-owned lock it appends within both fixed bounds or atomically retains the newest suffix plus one cumulative warning-only `runtime.trace_compacted` marker. The marker means older history was discarded; terminal/result/execution/artifact files remain authoritative independently. Reads are newline-safe and order equal timestamps by same-source ordinal, fixed source rank, then stable id without exposing ordering metadata. Never write `trace.jsonl` directly. Generic command lifecycle is Trace-only: `command.done` preserves complete bounded execution evidence but never requests or projects any attention value, and Recipe grammar has no command-completion delivery switch. Semantic attention is explicit: `notify` is visible status, `followup` is an ordinary checkpoint hint, and actor-authored `steer` is durable urgent delivery at Pi's next safe boundary. Never infer attention from status or exit code. Admit steer by exact event and Run generation before `deliverAs: "steer"`; acknowledge only its exact model-bound context envelope, and preserve the later root-terminal completion batch. Sequence, parallel, repeat, and import branches remain internal, while each separately launched Run owns a separate generation.

### Control

Public shape:

```json
{"target":"run:<id>","action":"…","input":{},"verbose":false}
```

Admit only lowercase ASCII actions of at most 64 characters, serialized JSON input of at most 380 bytes, and complete newline-terminated wire records of at most 512 bytes on both FIFO and named pipe. Invalid envelopes remain outside the journal; persist every admitted Control before transport. Put larger data in a declared artifact/path and send only a bounded reference or instruction through Control. Fence every record and endpoint with immutable `run_instance_id`; controlled services capture that generation at startup. Serialize admission and every compacted atomic journal replacement through token-owned dead-process-reclaiming locks. Reject malformed, oversized, stale-generation, or 64-pending journals before admission with bounded backpressure/integrity details; bound persisted errors to 4 KiB inside the string and retain at most 128 terminal records. First-party services must exact-id claim and finalize through `runs-controls.ts`; admitted nonterminal Controls never expire automatically. Keep transitions expected-state-fenced and monotonic when consumers complete before producer delivery evidence. FIFO and named pipe are transport details, not public concepts; reject partial writes and keep FIFO readers gap-free across writers. Revalidate owner, generation, state, and process identity under the lifecycle lock immediately before delivery.

Keep `controls.jsonl` raw and local for execution fidelity. Every model-facing and Actor Inspector Control surface must use the shared bounded `control-projection.ts` redaction before exposure; never attach a second raw copy in tool details.

Runtime lifecycle and review actions remain runtime-owned. Runtime kill is the recovery path for a stuck saturated Run; it never consumes actor-local Control capacity or appends a synthetic Control record. Trace/Control quotas do not constrain user-declared artifacts, repositories, media sources, complete captures, or actor-owned workload state.

### Inspect

Run views are exactly `recipe`, `trace`, and `control`. Trace reports retained-history completeness; Control reports capacity, saturation, stale pending work, journal bytes, and bounded diagnostics. Runtime triage aggregates backpressured Runs and incomplete Trace. Non-Run management targets remain `runtime`, `recipes`, and `tool:<name>`. Apply owner filtering and redaction before projecting evidence.

## Retained Safety Invariants

Never weaken:

- owner filtering;
- immutable generation fencing;
- cross-platform process identity checks;
- canonical lifecycle locks and same-directory restart serialization;
- shutdown and parent-teardown kill;
- terminal notification reconciliation and handled/failure evidence;
- bounded logs, complete captures, and tool output;
- owned Pi session provenance;
- path containment, canonical ownership markers, and symlink rejection;
- redaction of secrets and machine-local paths;
- automatic review admission, CAS, journaling, quarantine, lineage, retry, and reset safety.

Lifecycle operations fail closed when identity, ownership, or generation cannot be proven. Do not directly signal processes from UI code or edit active Run state to force outcomes.

## Registry and Evolution

`~/.pi/agent/recipes/*.json` is executable capability memory. Preserve filename identity, atomic writes, canonical per-path locks with atomic owner publication and non-blocking abandoned staging, explicit operator-gated changes, and transportability.

Automatic review receives value-free structural projections, not executable content, paths, prose, canonical names, or secrets. Deterministic executors derive unchanged Recipes from trusted captures. Approved mutation must journal intent before mutation and roll forward safely after crashes.

`PI_ACTORS_AUTOMATIC_REVIEW=off` disables scheduling and safe-boundary activation while remaining visible in runtime status.

## Output and Observability

Tool result/error text contributes exactly one leading line break. Keep model-facing responses compact and state-backed. Preserve complete byte-exact command streams in bounded spill files while returning bounded tails; never feed truncated tails into pipeline stdin.

File watchers accelerate reconciliation; a bounded interval recovers missed terminal and retained-attention events. Canonical attention observation uses stable retained ids and bounds seen memory to the current suffix across compaction; only allowlisted legacy outbox fallback uses line offsets. Ordinary `notify` and `followup` hints prime at startup without replay and require durable state or artifacts for recovery. Explicit `steer` instead re-enters through the owner journal until exact presentation records its newer generation-fenced Trace marker.

Ordinary root terminals remain authoritative in Run state until the owner-scoped completion scheduler snapshots an immutable batch at a settled or idle boundary. Batch delivery is generation-fenced and bounded at 256 durable members, 64 model-facing rows, 16 KiB of context, and a 1 MiB journal. `sendMessage()` acceptance advances only to queued; only the exact batch id and content appearing in model-bound `context` advances to presented and authorizes exact-generation handled markers. Restart recovery walks the bounded active Pi session parent chain: exact queued evidence waits without resend, proven absence returns the envelope to pending, and incomplete or conflicting evidence remains queued with diagnostics. Retry duplicates collapse before presentation, malformed envelopes fail closed, and automatic review waits behind an active completion batch.

When deferred Run results gate the next step, wait for their completion batch. Inspect early only for operator request, meaningful attention, or diagnosis of an overdue Run.

## Documentation and Release Discipline

- Keep published text portable: use `~`, `<repo>`, or relative paths.
- Update `skills/actors/SKILL.md` when durable operating mechanics change.
- Keep `skills/swarm/SKILL.md` focused on multi-agent methodology rather than kernel internals.
- Recipe `description` is optional. Skill Recipe QA recursively validates direct filesystem-owned components and capability semantics with zero diagnostics or warnings; it does not enforce aesthetics or architecture policy.
- Before release run the normal product validation and dependency audit. Use the project-local Domain DAG Skill during architecture-affecting development, not as publication automation.
- `.github/workflows/release.yml` owns the immutable sequence reusable validation → npm Trusted Publisher publication/verification → GitHub Release convergence; follow [docs/releasing.md](docs/releasing.md).
- Keep npm publication tokenless: use the exact npm Trusted Publisher binding and job-scoped OIDC permission, never a long-lived npm token or token fallback.
- Until a stable version beyond `1.x`, prefer clean breaking simplification over compatibility aliases or renamed legacy abstractions.
