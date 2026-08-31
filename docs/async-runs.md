# Runs

A Run is one detached execution instance:

```text
Recipe --spawn--> Run
Run = Recipe + Trace + Control
```

## Creation

`spawn` accepts a Recipe/file or inline command template and optional values, Run id, transport context, and artifact declarations. The runtime resolves the Recipe, validates typed values and current policy placeholders, claims the state directory, creates a new immutable `run_instance_id`, captures process identity, starts the runner, and appends `run.start` Trace.

A reused state directory fails while its prior generation remains active. Restart cleanup removes stale terminal state before the new generation starts.

## Identity and Ownership

Each Run persists:

- safe Run id and state path;
- current Pi owner id;
- immutable `run_instance_id`;
- process id plus captured process identity;
- launch source and tool-call provenance;
- captured Recipe/template/values;
- model and thinking policy provenance.

Inspection, Control, cancellation, kill, retirement, and teardown filter by owner. Public Run-specific `inspect` and `message` also require a current coordinator session whose id exactly matches the persisted non-empty owner; possession of `run:<id>` alone grants no access. Missing coordinator identity, ownerless state, and cross-owner state fail closed. `inspect target=runtime view=runs` returns only the current session's exact-owner inventory and is the supported diagnostic when a remembered Run is inaccessible. Lifecycle mutations additionally revalidate generation, state, and process identity under the canonical lock.

## State Files

```text
run.json
trace.jsonl
controls.jsonl
control-endpoint.json       controlled services only
execution.json
progress.json
result.json
stdout.log
stderr.log
terminal.json               terminal lifecycle evidence
terminal-notification.json  reconciliation evidence
diagnostics.jsonl
<declared artifacts>
```

`run.json` carries `state_schema: "run-kernel-v1"`. New Runs do not create communication-plane state.

## Trace

Trace records strict bounded events:

```json
{"id":"…","ts":"…","kind":"command.done","summary":"Command completed","data":{"code":0},"level":"info"}
{"id":"…","ts":"…","kind":"checkpoint.ready","summary":"Review needs a decision","level":"info","attention":"followup"}
{"id":"…","ts":"…","kind":"checkpoint.blocked","summary":"Approval required before migration","level":"warning","attention":"steer"}
```

Required fields: `id`, `ts`, `kind`. Optional fields: `summary`, `data`, `level`, `attention`. Trace rejects addressed-envelope fields and malformed or oversized data. It retains a recent suffix within 2,048 events and 4 MiB. When either bound would be exceeded, the canonical lock atomically keeps a newest suffix near the lower targets, the new event, and one cumulative warning-only `runtime.trace_compacted` marker. The marker means older history was discarded; it reports cumulative drop evidence and never requests attention.

Runtime lifecycle, runner progress, command completion, cancellation, kill, parent teardown, and controlled-service observations use Trace. Generic command lifecycle is Trace-only: runner-owned `command.done` records preserve level, captures, session provenance, and execution evidence but never request or project attention, even if malformed legacy evidence carries `steer`. No Recipe field configures command-completion delivery. Semantic checkpoints opt in explicitly: `attention: "notify"` is visible status, `attention: "followup"` supplies ordinary checkpoint context, and `attention: "steer"` requests urgent delivery at Pi's next safe assistant/tool boundary. Steer is never inferred from exit status; its exact Run generation and event id enter the bounded owner journal before Pi delivery, recover through owned session evidence, and require exact model-bound context acknowledgment. Presentation appends a generation-fenced non-attention `delivery.steer_presented` Trace marker so historical retained steer events cannot replay after bounded owner receipts rotate. The eventual root terminal remains independently eligible for its completion batch. Bounded reads preserve complete UTF-8 lines and disclose omitted legacy prefixes. `inspect view=trace` reports retained-history completeness and projects events with Controls, owned Pi turns, logs, results, artifacts, and diagnostics newest-first. Equal timestamps use same-source physical order, then fixed source rank and stable id without claiming cross-source causality. Terminal state, `result.json`, `execution.json`, and artifacts remain authoritative even when old Trace has compacted.

## Control

A Recipe declares actor-local actions only when its process consumes them:

```json
{"control":["pause","resume","stop"]}
```

Public request:

```json
{"target":"run:player","action":"pause","input":{"reason":"operator"},"verbose":false}
```

The runtime:

1. acquires the lifecycle lock;
2. revalidates owner, `run_instance_id`, running state, and process identity;
3. appends a queued generation-bound record to `controls.jsonl`;
4. resolves a matching ready endpoint from `control-endpoint.json`;
5. writes the exact `{id, action, input?}` wire document to FIFO or named pipe;
6. records delivered or failed outcome.

Unix services may publish a FIFO; native Windows services publish a Windows named pipe. Native Windows FIFO delivery fails before transport rather than degrading to another protocol. Both transports admit the same portable envelope: action is at most 64 lowercase ASCII characters, serialized JSON input is at most 380 bytes, and the newline-terminated wire record is at most 512 bytes. Invalid envelopes fail before journal admission or transport. Put larger data in a declared artifact/path and send only a bounded reference or instruction through Control.

A service exact-id claims queued or transport-delivered Controls and records handled/failed outcomes through the canonical Control journal authority. Admission performs one locked read, integrity/generation check, terminal-tail compaction, capacity decision, and atomic write. The 65th pending Control and a rewrite exceeding 1 MiB fail as bounded `control_backpressure` before admission; malformed, unreadable, oversized, or stale-generation journals fail with an integrity reason and no rejected record. `inspect view=control` reports pending capacity, saturation, stale work, journal bytes, and diagnostics. Every transition uses the same lock, expected-state fence, 128-terminal compaction, and atomic bounded rewrite; persisted errors truncate inside the string at 4 KiB. Admitted nonterminal Controls never expire automatically. Delivery failure evidence cannot regress a Control already claimed or completed by a fast consumer. Services capture their startup generation, so stale-generation Controls never execute.

Runtime lifecycle `kill`, retention actions, and review retry/reset remain runtime-owned rather than Recipe-declared. Invoke Run actions through the public tool exactly as follows:

```text
message target=run:<id> action=kill
message target=run:<id> action=archive
message target=run:<id> action=prune input={"preserve_artifacts":true}
```

Kill accepts only a running owned generation and is the recovery path for a stuck saturated Run: it bypasses actor-local Control capacity and creates no synthetic Control. Archive and prune accept only terminal owned Runs. Archive moves the entire Run state directory and leaves a tombstone at the original path. Prune removes kernel state and preserves declared existing artifacts only when `preserve_artifacts` is explicitly true, copying them to retained artifact storage first. Same-directory restart clears all generation-local evidence before the new `run_instance_id`.

## Execution Evidence

`execution.json` stores general command/session provenance. The async runner keeps bounded stdout/stderr logs plus complete capture artifacts when semantic validation requires untruncated evidence. Pi command execution also records owned session provenance for later Trace projection and review checks. Session evidence files larger than 4 MiB are rejected before JSONL materialization and surface explicit truncation diagnostics instead of being loaded unboundedly. Artifact manifests compute size and SHA-256 incrementally in 64 KiB chunks. Trace and Control quotas do not constrain declared user artifacts, repositories or media sources, complete execution captures, or actor-owned queue/workload state; each remains governed by its own lifecycle and policy.

Review acceptance remains a command-stage concern. General execution evidence does not imply review approval.

## Status and Terminal Reconciliation

Statuses include `running`, `done`, `failed`, `exited`, `cancelled`, and `killed`. Status resolution combines persisted metadata, result/terminal evidence, and verified process state.

Ambient observation detects root terminal transitions and explicit retained Trace attention. Terminal transitions reconcile before semantic attention. Canonical attention is an in-memory wake hint, not a durable queue: observers prime retained ids at startup, deliver each later retained unseen id once, and bound memory to the current retained set across compaction. Persist durable recovery state or an artifact before emitting attention; compaction may discard older hints and its marker makes that history loss explicit. Terminal follow-up delivery persists handled/failure evidence so reloads retry unhandled transitions without duplicating completed notifications.

Ordinary finite Runs project root terminal results through one completion scheduler. Eligible terminals remain authoritative in Run state while Pi is active; after `agent_settled`, session recovery, or an idle debounce, the scheduler snapshots at most 256 exact generations into one owner-fenced immutable batch. One batch causes one automatic agent turn, exposes at most 64 bounded model-facing rows, and marks member terminals handled only after the exact batch id and content appear in model-bound Pi context. Pending send failures retain bounded retry evidence. On restart, queued recovery inspects only a bounded active Pi session parent chain: exact message evidence waits for presentation without resend, proven absence returns the same batch to pending, and incomplete or conflicting evidence stays queued with a diagnostic. Duplicate exact context envelopes collapse before presentation.

Sequence, parallel, repeat, and imported branches are internal execution topology and never own branch-level turns. Each separately launched Run owns its own generation and terminal lifecycle; compatible singleton reuse is not a new launch. Explicit semantic attention may intentionally add a checkpoint turn; Runs marked silent and synchronously acknowledged stop outcomes suppress automatic projection. Large semantic results stay outside compact completion rows and remain available in structured details, execution captures, or artifacts.

## Cancellation and Kill

Cancellation and kill use canonical lifecycle control:

- acquire the state lock;
- validate owner and optional generation fence;
- verify process identity;
- signal the owned process or process group/tree;
- persist lifecycle evidence and Trace;
- finalize in-flight execution and progress.

Shutdown and parent teardown kill only exact owned generations. A stale pid or replacement generation fails closed.

## Retention

Archive and prune apply only to terminal Runs and enforce path containment. Retention never removes active or foreign-owned state. The state index can rebuild from trustworthy Run directories after corruption.

## Service Recipes

Packaged controlled services demonstrate the endpoint protocol:

- `music-player/playback` consumes playback Controls and emits playback Trace;
- `actors/resource-locker` consumes queue/lease actions, emits lock Trace, and atomically retains at most 512 valid journal records within 1 MiB.

Shared archive/prune evidence similarly retains at most 256 valid records within 1 MiB under its canonical lock. Filesystem watchers and bounded reconciliation observe authoritative state directly.

One-shot pipelines omit Control and terminate through their command graph.

## Inspection

```text
inspect target=run:<id> view=recipe
inspect target=run:<id> view=trace source=lifecycle lines=40
inspect target=run:<id> view=control
inspect target=runtime view=runs
inspect target=runtime view=triage
```

Runtime `runs` is the exact-owner inventory; `triage` aggregates failed Runs, Control pressure, incomplete Trace evidence, and attention for that inventory. See [Management Inspection](./inspection.md) for every target/view combination and applicable inputs.

Use `/actor-inspector` to inspect Runs as concrete actor instances in the live TUI. Runtime, Recipe registry, and tool definitions remain separate management targets. No public noun, tool, target, or view is added by bounded retention.
