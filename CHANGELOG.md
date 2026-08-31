# Changelog

> Each release keeps at most 8 outcome records of at most 512 characters.

## 0.52.0: Durable Coordinator Delivery

- `Completion Epochs`: Replaces per-Run terminal turns with one immutable owner-fenced completion batch per idle/settled epoch. Batches retain exact Run generations and terminal timestamps, bound durable and model-facing members, preserve silent and synchronous-stop semantics, and remain eligible after urgent steering.
- `Presentation Acknowledgment`: Persists completion delivery through `pending`, `queued`, and `presented`; Pi transport acceptance advances only to `queued`, while exact model-bound `context` presentation authorizes generation-fenced terminal handled markers. Duplicate envelopes collapse and altered or conflicting content fails closed.
- `Recovery-Safe Scheduling`: Stores owner-hashed atomic delivery journals with bounded receipts, attempts, and errors. Restart recovery inspects only the bounded active Pi session chain, retries proven-absent envelopes, preserves uncertain queued evidence, rejects malformed, oversized, duplicate, and symlinked state, and keeps the scheduler directory through stale-temp cleanup.
- `Explicit Urgent Steering`: Adds durable actor-authored Trace `attention: "steer"` envelopes delivered only through Pi's safe steer boundary. Exact presentation writes generation-fenced `delivery.steer_presented` evidence, suppresses historical replay, and never suppresses the later root-terminal completion batch; `command.done` remains Trace-only regardless of legacy attention fields.
- `Settled Packed Parity`: Exercises the compiled package against the Pi 0.84.4 lifecycle contract, proving urgent steer presentation precedes its exact completion epoch, with `agent_settled`, follow-up/steer delivery modes, model-bound context acknowledgment, terminal fencing, and durable steer evidence.

## 0.51.0: Monotonic Run Follow-Ups

- `Root-Owned Follow-Up`: A normal finite Run now produces one automatic agent turn from its root terminal result. Sequence, parallel, repeat, and imported branches remain internal execution topology; each separately launched Run still owns a separate generation and terminal lifecycle.
- `Trace-Only Command Lifecycle`: Consolidates each command completion into one complete bounded `command.done` observation with level, captures, session provenance, artifacts, and execution evidence, but no attention. Legacy `command.done` attention remains non-projectable, and the removed Recipe-level delivery grammar stays removed.
- `Monotonic Reconciliation`: Delivers terminal transitions before explicit semantic attention, preserves silent Runs, synchronous stop behavior, generation fencing, terminal retry evidence, and semantic checkpoints, and removes branch exit-code heuristics that could wake the coordinator from stale process-level events.
- `Settled Pi Baseline`: Requires Pi and Pi TUI 0.84.4 or newer and schedules automatic Recipe review on `agent_settled`, after queued follow-ups, retries, and compaction complete. Source and packed-package regressions pin the lifecycle and minimum peer contract.

## 0.50.0: Hardened Actor Baseline

- `Template Recipe Standard`: Rebuilt the Recipe authoring guide around one current-state contract: formats, identity, uniformly detailed file-level and command-node field tables, resolution precedence, imports, async/singleton lifecycle, Control, artifacts, runtime origins, provenance, authoring workflow, and validation. Removed migration history and legacy-reference narration from the normative document.
- `Documentation Contract Reconciliation`: Audited every human-facing document against package metadata, public schemas, implementation, maintained Skills, and tests. Added the canonical Inspect target/view matrix and exact-owner authorization boundary; completed installation, runtime triage, registered-tool lifecycle/schema, detached-build, and bounded-evidence guidance; corrected lifecycle ownership, command-template shapes, Inspector zero-based navigation/focus behavior, and remaining historical or ambiguous prose.
- `Owner-Safe Public Runs`: Run-specific Inspect and Control now require a live coordinator identity, reject ownerless and cross-owner state, and keep runtime Run inventory exact-owner filtered. Missing-session and mismatch failures provide supported runtime inspection guidance instead of removed session targets.
- `Bounded Evidence Inspection`: Session evidence rejects oversized JSONL before materialization with explicit truncation diagnostics, while artifact manifests compute exact size and SHA-256 through fixed-size chunks instead of loading complete artifacts into memory.
- `Operator Truth`: Runtime status now uses the canonical automatic-review policy for `0`, `false`, and case-insensitive `off`. Maintained guidance documents exact runtime-owned `kill`, `archive`, and artifact-preserving `prune` calls with their running/terminal state constraints.
- `Consistent Inspector Indexing`: Actor Inspector now uses zero-based numbering for Runs, Trace rows, and complex array items. Structured items render as accent keys such as `#0: {` on one line, removing list bullets and redundant opening-brace rows while preserving nested indentation, commas, wrapping, and object-label grammar.
- `Inspector Focus Semantics`: Alternating content stripes retain `customMessageBg`, while focused Run controls, tabs, Trace rows, selector options, and confirmation choices use `selectedBg`. Trace focus gains symmetric trailing padding and composes its selected span beside—rather than around—the independent full-row stripe, avoiding nested ANSI background resets.
- `Layered Inspector Selectors`: Run choices open directly below the focused Run control, and Trace-source choices below the focused tabs. Each menu is ANSI-aware composited over only its bounded rectangle while the underlying tabs, separator, documents, Trace rows, stripes, overlay height, and footer remain rendered and restore unchanged on close. The parent Run control or Trace tab retains `selectedBg` while its child selector is active. Trace-source choices use the compact `Trace: <source>` label, begin twelve cells into the base layer beneath the tab region, and preserve distinct label/value colors under selection. A non-`all` source projects onto the parent tab with the same colon grammar and value color while `Trace:`, including the colon, and its focus brackets retain their established tab accent. Run choices use aligned zero-based sequence, name, and status columns without a redundant `run:` prefix, preserve the same semantic status colors as the parent control, and begin four cells inside the outer frame. Both insets preserve—rather than blank—the underlying base-layer prefix before the composited menu rectangle.

## 0.49.2: Stale-Context Lifecycle Hotfix

- `Stale-Context Lifecycle Hotfix`: Contains Run UI animation, delayed watcher, reconciliation, error-handler, retirement, and Recipe-reload callbacks so invalidated Pi contexts cannot escape into the host event loop. Session owners are captured while live, stale shutdown cannot close a replacement session, and parent teardown plus shutdown notification remain identity-fenced and no-throw (GitHub issue #125).

## 0.49.1: Maintained Telegram View Routing

- `Maintained Telegram View Routing`: Music Player now treats Telegram-originated control intent as a breadcrumb to its ready capability-owned Generative App, preferring bind/invoke over one-shot prompt buttons while preserving Actor playback authority and an explicit model-mediated fallback when the app runtime is unavailable.

## 0.49.0: Skill-Scoped Music Player

- `Skill-Scoped Singletons`: Added one optional async singleton Recipe per active Skill with canonical `run:<skill>` and `<skill>/<recipe>` identities, idempotent compatible reuse, lifecycle/process fencing, terminal-generation replacement, delegation-safe identity inheritance, persistent actor-owned state directories, focused inspection, and fail-closed conflicts across Recipe, owner, startup values, and Control.
- `Terminal Attention Dedupe`: Retains seen Trace-attention identities while terminal Runs remain observable, preventing periodic reconciliation from replaying the same command follow-ups after the terminal transition.
- `Focused Music Player`: Replaces broad Media with one `music-player/playback` singleton for files, directories, URLs, and playlists. It checkpoints queue and paused intent, reports structured status/Trace, rejects Actor/standalone ownership collisions, and recovers malformed checkpoints explicitly. Live Generative App validation confirmed fresh status and exact terminal Controls across the complete action set.
- `Absolute Volume Control`: Adds generation-fenced `volume` with `{ "percent": 0..100 }`, direct helper parity, structured status/checkpoint/Trace evidence, and fail-before-admission invalid-input handling. Linux WirePlumber resolves the exact playback stream by process identity and changes it in place; unsupported environments retain the restart fallback. UIs resolve relative steps to one absolute percentage.
- `Percentage Seeking`: Adds generation-fenced `seek` with `{ "percent": 0..100 }`, bounded duration probing, read-time progress percentage, structured status/checkpoint/Trace evidence, and supported-backend restart at the resolved offset while preserving track and paused/playing intent; unavailable duration or backend support fails explicitly.
- `Portable Playback Protocol`: Adds actor-neutral foreground `serve` and a pure generation-fenced `playback-client.mjs` for structured status and bounded controls. The Recipe remains the sole managed lifecycle owner; standalone foreground ownership is explicit and mutually exclusive, with no hidden daemon start, adoption, or supervisor handoff.
- `Optional Generative App`: Ships a ready `genapps/music-player.mjs` adapter for a co-installed generic Generative App runtime. It reports Actor availability and waits for the exact terminal canonical Actor Control for every mutation, including failed-action propagation; Pi remains the lifecycle composition root. Progress and volume use symmetric seven-button `0..90` scales in steps of 15.

## 0.48.1: Persistent Skill Composition

- `Persistent Skill Composition`: Made `register_tool from=<skill>/<recipe>` use Pi's authoritative active-session Skill snapshot across every admitted Skill location and activate synchronous or asynchronous tools from the resolved effective contract. Compact user Recipes retain logical delegation without copied contracts, absolute helper paths, symlinks, or ambient runtime re-resolution.

## 0.48.0: Host-Coordinated Swarms

- `Coordinator And Swarm Methodology`: Defined gatewayless host coordination with companion transports as presence only; the coordinator accepts declarative outcomes, creates explicit Runs, stays available, and owns integration/final validation. Reasoning is role-allocated: bounded authors default off, independent reviewers/integrators use medium, and the coordinator selects evidence-worthy fanout. Swarm retains overhead admission, disjoint ownership, isolation, mutation freeze, and event/timer observation.

## 0.47.0: Agent-Native Actor UX

- `Skill-First Operation`: Replaced the injected product manual with a compact Skill-routing meta-protocol. `actors` is now the decision-first authority for generic Recipe/tool/Run mechanics, capability Skills own capability choice, and `swarm` owns only multi-actor methodology.
- `Persistent Capability Authoring`: Added explicit, mutually exclusive `register_tool from`, `template`, and `draft` modes; public caller `defaults`; canonical Skill/file resolution; compact direct delegation; inherited descriptions, async contracts, typed args, artifacts, Control, and runtime origins; and removal of public `values`.
- `Registration Truth UX`: Registration now reports logical source, effective required/optional args, persistence, registry/host/active-tool state, callability, activation boundary, and bounded next actions without raw config or executable template payloads. Failed activation retains rollback guarantees.
- `Focused Diagnosis`: Added `inspect target=recipes view=doctor identity=<skill>/<recipe>` with active ownership, exact resolvability, partial-catalog state, portable source, generation, rejection, and next actions. Tool status now includes source, effective args, activation boundary, and separate spawn/tool usage.
- `Capability Protocols`: Rewrote all six Skill descriptions as routing triggers and made Media, Artifacts, Project Work, and Recipe Memory compact agent operating guides. Human installation, product, catalog, development, and release guidance remains independently owned by README/docs.
- `Safe Recovery`: Inactive, missing, duplicate, removed, malformed, rejected, partial-catalog, and inactive-tool failures now preserve logical identity, redact physical Skill paths, and teach bounded public diagnosis/retry actions without copied contracts, helper paths, shell evaluation, backgrounding, or spawn substitution.
- `Journey and Package Evidence`: Added deterministic Journeys A-G, reviewed fresh-agent Journey B evidence, and packed first-session parity for final Skills/prompt/references, `from` registration, source-equivalent schema, same-session activation, focused doctor, actual tool invocation, and unshipped `.agents/` evidence.

## 0.46.1: Registration Truth

- `Live Resolution`: Spawn, registration, registry admission/reload, schema derivation, and Inspect now consume one immutable session Recipe context. Skill-dependent user wrappers reconcile only after Pi supplies active Skills, watcher reloads retain the current generation, and stale session consumers fail closed.
- `Effective Admission`: One user-Recipe admission path resolves direct delegation before persistence, inheriting async behavior, typed arguments/defaults, artifacts, Control, and runtime origins without copying maintained contracts. Malformed or mistyped wrappers fail before mutation, and failed updates roll back prior bytes, registry state, host definitions, and active tools.
- `Schema Ownership`: Caller schemas preserve enum, bool, integer, number, path, and array types while centrally excluding runtime-owned inputs such as `recipe_dir`, `skill_dir`, `state_dir`, Trace/run identity, and runtime state roots. The intentional async `run_id` override remains public.
- `Fail-Soft Catalog`: Active-Skill inventory returns valid components alongside bounded per-component rejections and an explicit partial state. Invalid unrelated Recipes and duplicate namespaces remain diagnosable without poisoning exact resolution of valid components.
- `Activation and Observability`: Registration reports resolved, validated, persisted, registry, host, active-tool, and callable states from Pi host evidence. Recipe inspection adds generation, scan, watcher, portable-root, and partial-catalog state; tool status reports current activation and separate spawn/tool usage.
- `Launch Truth and Dogfood`: Spawn and registered-tool launches expose distinct `launch_kind` evidence. Source and packed-package regressions activate `media/player`, quarantine an unrelated stale component, register and invoke a compact `music_player` in the same session, preserve inherited Control/schema, exercise repair reloads and negative cases, and reject shell/copy workarounds.

## 0.46.0: Skill-Owned Capability Packs

- `Breaking Recipe Grammar`: File-backed identity now comes only from the filename; top-level Recipe `name`, nested Skill identities, JSON/Markdown stem collisions, bare references, and the old `std:` / `skill:` prefixes fail with migration guidance. Composition accepts exact `<active-skill>/<stem>` references or explicit `.json` / `.md` paths, with entry paths based at invocation cwd and relative imports based at their owning Recipe.
- `Skill-Owned Distribution`: All 58 bundled components move from the root Recipe library into six flat Pi Skills—Actors, Artifacts, Media, Project Work, Recipe Memory, and Swarm—with 67 explicit imports and an acyclic cross-Skill graph. Root and `dist` Recipe libraries, package-root discovery, fallback/shadowing, wrapper installation, and obsolete root capability helpers are removed; Skill components never auto-register as tools.
- `Scoped Resolution and Provenance`: Immutable active-Skill contexts are session-scoped and captured per Run. Recipe inspection distinguishes user registry capabilities, active Skill components, and explicit files while recording entry/import roles, filename stems, logical identities, Skill ownership, and alias ancestry without exposing private `source_file`, `{skill_dir}`, or `{recipe_dir}` values to model/Inspector surfaces.
- `Capability Safety`: Automatic review resolves exact package-owned `recipe-memory/*` components so user files cannot redirect reviewers. Helpers self-locate through runtime-owned `{skill_dir}`; Control, Trace, lifecycle fencing, review transactions, and the public `spawn`, `message`, `inspect`, `register_tool` plus Recipe/Trace/Control view contracts remain unchanged.
- `Validation and Architecture`: Recursive Skill QA validates direct identity, parse/import semantics, origins, Control, portable paths, and helper targets in source and installed packages. The custom release-gate and executable-style policy scanners are removed; CI runs product validation plus dependency audit, while a non-packaged project-local Domain DAG Skill supports architecture work without becoming a release gate.
- `Dogfood and Migration`: Source and installed tests execute repository health, release readiness, quorum review, artifact bundle, media player, and package-owned draft review through qualified Skill references, plus relative/absolute file imports and all breaking failures. Migrate `std:foo` to `owning-skill/foo`, `skill:foo/bar` to `foo/bar`, root Recipes to their owning Skill filename, and delete Recipe `name` fields.

## 0.45.1: Entrypoint and Release Policy

- `Architecture`: Keeps `index.ts` as a thin Pi event-registration and composition root while moving session lifecycle, runtime service composition, Skill discovery, and tool adaptation into the acyclic `extension-runtime.ts` domain.
- `Release Policy`: Raises the fixed shipped-source ceiling to 32,000 lines and rejects blank lines inside executable JavaScript/TypeScript blocks across the complete source and test tree while exempting structural declarations.
- `Package Metadata`: Moves the package image to the new raw-content endpoint to restore cross-origin loading.

## 0.45.0: Skill Recipe Standard Library

- `Recipe Values`: Makes inline argument defaults optional, applies caller > values > defaults > inline precedence across tools, Runs, imports, and delegation, and validates final typed/enum values plus duplicate, unknown-default, and conflicting-type declarations.
- `Recipe Origins`: Gives file-backed Recipes immutable `{recipe_dir}` and active-Skill Recipes `{skill_dir}` across templates, defaults, artifacts, tools, and Runs while retaining local provenance and hiding machine-local origins from model-facing launch values.
- `Skill Recipe Library`: Adds exact `std:<name>` and Pi-active `skill:<skill>/<path>` component lookup for imports, delegation, spawn, validation, Inspect diagnostics, captured qualified identity, and installed dist without automatically registering Skill Recipes as tools.
- `Validation`: Covers source, composed async execution, installed dist, namespace collisions/reload, path redaction, and migrated Skill wrappers while resetting the shipped-line ceiling to the validated 29,767-line release tree.

## 0.44.0: Bounded Run Evidence

- `Trace`: Bounds each Run to 2,048 events and 4 MiB, atomically retaining the newest suffix with one cumulative `runtime.trace_compacted` marker so discarded history is explicit while terminal, result, execution, and artifact evidence remains authoritative.
- `Control`: Rejects a 65th pending Control or 1 MiB journal before admission, preserves admitted nonterminal work, atomically fences every transition, retains 128 terminal outcomes, and keeps runtime kill available outside actor-local capacity.
- `Inspection`: Reports Trace completeness and Control capacity, saturation, stale work, bytes, and diagnostics through existing Run views, runtime triage, and Actor Inspector without adding public nouns, tools, targets, views, or fields.
- `Runtime`: Makes attention a compaction-safe bounded wake hint, preserves deterministic newest-first projection order, and keeps restart, archive, prune, terminal reconciliation, owner filtering, generation fencing, process identity, and redaction independent of retained Trace history.
- `Services`: Moves first-party services to canonical exact-id Control claims, bounds shared retention and resource-locker journals, removes the unused wake journal, and explicitly excludes user artifacts, complete captures, repositories, media, and actor workload state from Trace/Control quotas.
- `Validation`: Stress-tests mixed concurrent Trace compaction, attention, Control backpressure/recovery, lifecycle, source and installed-package parity, append-only ownership, documentation examples, and the 29,598-line release ceiling.
- `Release`: Extends OIDC publication convergence retry across npm identity, `gitHead`, Pi metadata, and packable tarball manifests before GitHub Release publication.

## 0.43.1: Run Kernel Contract Closure

- `Actor Inspector`: Keeps newest Trace first with chronological numbering, stable focus, live refresh, plain markers, structured objects, bounded redaction, and generation-fenced kill. Successful kill refreshes the Run header without duplicate copy.
- `Installed Recipes`: Packaged helpers self-locate unless `repo` is overridden. Script leaves infer `.js`/`.mjs` in order via Node, Bun, or `deno run` and `.sh` via Bash. Tarball dogfood covers spawn, Run views, Control, schemas, skills, and identity.
- `Validation`: Normal gates cover one-shot and agent Runs, service Control, replacement fencing, triage, and packed installs. Recipe QA is 58/58 with zero diagnostics or warnings; shipped content remains strictly below the 28,853-line baseline.
- `Trace and Runtime`: Every first-party Trace append uses the canonical cross-process lock. Package-local identity, `run-kernel-v1`, and owner-filtered triage distinguish fresh, stale, terminal, replaced, and malformed evidence. Mutation locks atomically publish owners, leave abandoned staging non-blocking, and reclaim killed zombies without deleting live replacements.
- `Control`: Public requests, Recipe declarations, FIFO, and named pipes share limits of 64 action characters, 380 input bytes, and 512 wire bytes. One bounded projection redacts model and Inspector views while raw local journals stay intact.
- `Release`: Reusable Ubuntu, macOS, Windows, and audit gates precede immutable-tag publication. npm Trusted Publisher/OIDC adds provenance, verifies exact `gitHead` and packed Pi manifests, then converges the GitHub Release without token fallback.
- `Contract`: Kept `Recipe --spawn--> Run` and `Run = Recipe + Trace + Control`. Fixed maintained Inspect and review invocations, compressed internal wording to Control, and retained `message` as the public Control verb.
- `Changelog`: Compacted every historical and current release section to at most eight outcome records of at most 512 Unicode characters, with one cross-platform invariant enforcing the complete changelog.

## 0.43.0

- `Run Kernel`: Replaced rooms, rosters, mailboxes, addressed envelopes, mailbox loops, and communication-specific utilities with `Recipe --spawn--> Run` and `Run = Recipe + Trace + Control`. Runs use `run-kernel-v1`; public verbs remain `spawn`, `message`, and `inspect`, while `register_tool` stays separate. Removed routes fail explicitly.
- `Actor Inspector`: Restored `/actor-inspector` around exactly Recipe, Trace, and Control with focused Run selection, cached navigation, compact documents, terminal-relative layout, contextual key hints, and generation-fenced confirmed kill.
- `Control`: Standardized `message` on `{target, action, input?, verbose?}`. Unique lowercase Recipe actions remain separate from runtime actions; admitted Controls persist before delivery, use token-owned mutation locks, and advance through expected-state-fenced monotonic outcomes.
- `Services`: Migrated music-player and optional `resource-locker` to generation-bound endpoint readiness, canonical Trace, exact transport writes, gap-free FIFO reading, and inspectable handled or failed Control outcomes across supported platforms.
- `Inspect and Trace`: Made `inspect` dispatch only to `run:<id>`, `runtime`, `recipes`, or `tool:<name>`; Runs expose only Recipe, Trace, and Control. Newest-first Trace combines bounded lifecycle, Control, process, artifact, and redacted session evidence, while `execution.json` owns provenance.
- `Run Operations`: Limited injected state to `run_id`, runtime-owned `state_dir`, and `trace_file`; restart clears generation-local evidence. Triage reports failed Runs, stale Controls, and attention Trace, while archive and prune share the lifecycle lock and preserve external retention evidence.
- `Safety`: Preserved owner filtering, immutable generation fencing, process identity, lifecycle locks, shutdown and parent teardown, terminal reconciliation, bounded captures, owned Pi sessions, containment, redaction, and automatic-review transaction safety.
- `Release Safety`: Added removed-surface and shipped-size ratchets, preservation tests, strict Domain DAG and ABCd checks, protocol fixtures, installed-package coverage, and cross-platform validation. Rewrote public guidance around the Run kernel so regrowth or safety regression blocks release.

## 0.42.3: Follow-up Display Hotfix

- `Follow-up Display`: Made actor terminal and outbox follow-up messages invisible as injected LLM context while retaining queued delivery and idle-turn wakeups. Impact: the transcript no longer shows both the coordinator response and a duplicate custom-message card with the same follow-up text.

## 0.42.2: Inspector Key Rail and Terminal Follow-up Context

- `Inspector Key Rail`: Moved every Inspector hotkey hint onto the bottom border, replacing the dedicated two-row footer with a border-connected rail. Blue key labels remain, while descriptions and `─` connectors use the border accent instead of bullet separators; the main viewport cap rises from 16 to 24 rows. Impact: the Inspector gains two content rows without losing keyboard discoverability, and the kill confirmation dialog now shares the same visual grammar.
- `Terminal Follow-up Context`: Kept terminal delivery on Pi's `followUp` queue while limiting LLM content to run id, status, one base path, and relative artifact names. Semantic output, correlation, and transport metadata stay in details and run state. Launchers persist initial progress before spawn; runners persist terminal progress and review evidence before `result.json`, preventing raw-output injection and incomplete terminal reads.

## 0.42.1: Terminal Delivery and Cross-platform Validation

- `Terminal Delivery`: Added one bounded semantic terminal result with durable launch correlation and bounded adapter context. Advertised envelopes win; accepted reviews may synthesize `review.completed`, and failures include terminal errors. Watcher and reconciliation share in-flight dedupe, failed sends retain retry evidence without a handled marker, and status exposes the latest failure.
- `Inspector Kill Dialog`: Replaced inline kill with a responsive confirmation overlay showing the exact Run and status, destructive copy, Cancel-first focus, arrow or Tab selection, Enter, and direct Y/N/Escape behavior. Canonical control still revalidates owner, generation, and running state before signaling.
- `Cross-platform CI`: Added equivalent Ubuntu, macOS, and Windows release-validation jobs with bounded timeouts, pinned Node, npm caching, `npm ci`, and fail-fast disabled. Dependency audit runs once in a separate Ubuntu job, establishing one baseline release path across supported hosts.
- `macOS Ownership`: Accepted only the platform-owned `/var` to `/private/var` temporary-root alias while retaining nested-parent and leaf-symlink rejection, so temporary Runs pass without weakening caller-controlled path checks.
- `Portable Build`: Invoked JavaScript entrypoints through Node, normalized path and file-URL handling, used native path assertions, serialized watcher-sensitive release suites, and cancelled live fixtures before cleanup. Windows remains shell-free and cross-platform cleanup no longer races workers.
- `Windows Fencing`: Added NTFS regressions for bigint root identity, junction alias locking, lifecycle locking, draft-root reparse substitution, and trusted-root replacement. Retained the portable realpath, root-identity, and CAS contract rather than adding an unsupported native handle layer.
- `Validation Evidence`: GitHub Actions run `30322093465` passed Ubuntu, macOS, and Windows after fixing path, command, process-tree, temporary-root, line-ending, and fixture-lifecycle gaps. No residual trusted-state substitution window was reproduced.

## 0.42.0: Automatic Recipe Evolution and Recipe-first Inspector

- `Recipe-first Inspector`: Opens on a bounded, redacted Recipe snapshot for the selected owned Run, then adjacent Messages and Turns tabs. Compact nested rendering, cached Turn evidence, one-level detail, arrows, and PageUp/PageDown keep navigation responsive without following mutable external Recipe paths.
- `Automatic Draft Evolution`: Twelve eligible inline drafts trigger one silent no-tools review after foreground and actor work settles. Reviewers see only value-free structure; deterministic execution derives quota-free promote or discard outcomes from immutable trusted captures and rejects stale, unsafe, secret-bearing, incomplete, duplicate, or colliding decisions.
- `Automatic Tool Evolution`: Thirty-six eligible active revisions trigger a separate structural review for keep, unchanged-source evolve or demote, and identical-source merge. Executable changes remain operator-authored, approved plans activate only at a safe session boundary, and `PI_ACTORS_AUTOMATIC_REVIEW=off` disables scheduling and activation visibly.
- `Transactions and Recovery`: Recipe mutations use exact CAS, authenticated operation graphs, root identity, containment, intent journals, quarantine, complete validation, canonical locks, and idempotent rollback or roll-forward recovery. Bounded retries and hard-crash tests prevent stale or concurrent edits from being overwritten.
- `Lineage and Diagnostics`: Canonical ledgers preserve lifetime usage, revisions, former identities, review epochs, transitions, and bounded snapshots. `inspect target=recipes view=reviews` exposes bounded state and recovery guidance; `review.retry` and safe `review.reset` preserve approved transaction evidence that must roll forward.
- `Generation Safety`: Every asynchronous start has an immutable generation. Kill, teardown, cancellation, and replacement-sensitive actions verify exact owner, generation, status, and process identity under the lifecycle lock. Token-owned mutation locks reclaim dead owners, watcher callbacks are generation-fenced, and signaling revalidates identity.
- `Surface Compression`: Removed transitional review migrations, reduced `index.ts` from 389 to 118 lines by moving behavior into focused domains, and replaced bulk Recipe copying with selected installation or thin wrappers. Internal review selectors remain runtime-owned components.
- `Validation`: Added protocol conformance, high-severity audit, strict Domain DAG, temporary-index hygiene, and ABCd checks. Passed 631 tests, 171 conformance cases, 63 packaged-Recipe QA checks, clean audit, TypeScript, import, build, package dry-run, and supplemental release gates.

## 0.41.1: Actor Inspector and Delivery Hotfix

- `Terminal Delivery`: Added bounded ten-second terminal reconciliation and watcher rearm so owned terminal follow-ups converge without reload when file watching misses or fails. Delivery still uses Pi follow-ups with owner filtering, `triggerTurn`, no historical outbox replay, and the existing at-least-once handled-marker contract; routine run-directory removal stays quiet while real watcher degradation remains diagnostic.
- `Actor Inspector`: Finished the compact meaning-first overlay. `/actors-inspector` opens the latest numbered Run; Run, Message, and Turn lists show newest evidence first; bounded menus fit short terminals; and humanized Turn rows open wrapped Evidence or a metadata-free transcript. Content prioritizes User, Thinking, Assistant, and tools before provenance, strips prompt wrappers, and removes false wraps, clipping, redundant labels, separators, and blank rows.
- `Tool Output`: Normalized successful results and errors to contribute exactly one leading line break, preserving one empty separator row beneath Pi's rendered tool-call header without occasional double gaps.
- `Agent Guidance`: Kept Inspector behavior in user documentation and removed it from the bundled Actors skill, leaving that skill focused on agent-operational `spawn`, `message`, `inspect`, recipes, and lifecycle guidance.

## 0.41.0: Actor Inspector Overlay and Execution Observability

- `Inspector Overlay`: Replaced inspector subcommands and the below-editor widget with `/actors-inspector-toggle`, a centered responsive overlay with owned-Run selection, Messages and Turns tabs, live refresh, compact alternating rows, bounded detail, distinct empty states, contextual key hints, and Escape close.
- `Navigation`: Added explicit Run, Tabs, Menu, List, and Detail focus zones. Enter or → opens, Escape or ← returns, tab switching stays scoped to tab focus, and availability-aware boundaries preserve selection. Brackets mark selected top-level values while `▶` marks focused rows or menus.
- `Menus and Visuals`: Anchored two-level filter menus to tabs, showed current and non-default values, aligned borders and labels, preserved underlying striped cells outside menu bounds, colored lifecycle status semantically, and kept absolute row striping stable while scrolling.
- `Messages`: Renamed Communications to Messages and added compact route, type, body, and attention previews with unread, channel, and roster-derived sender filters plus bounded detail. Multiline content is normalized before composition so it cannot escape its row.
- `Turns`: Added scrollable subagent Turn browsing and bounded detail for provenance, prompts, user and assistant text, visible thinking, model, usage, errors, correlated tools, truncation, and diagnostics. A resilient reader follows the latest session branch and groups related calls and results.
- `Provenance`: Gave child `pi -p` commands isolated owned-Run session directories unless explicit session policy wins, recorded resulting JSONL paths, and migrated coordinator-managed participants from `--no-session` so the Inspector can attribute direct and coordinated work.
- `Security`: Reset Inspector state at session start, revalidated selected-Run ownership, rejected absolute, traversing, symlinked, or out-of-Run session evidence, and expanded structured and textual credential redaction. Missing reasoning remains explicitly unavailable.
- `Tool Output`: Added exactly one blank separator between every pi-actors result or error and its rendered tool-call header, covering `spawn`, `message`, `inspect`, `register_tool`, and Recipe-backed tools.

## 0.40.1: Follow-up Delivery Hotfix

- `Coordinator Delivery`: Queue terminal and coordinator-bound actor notifications through Pi's `followUp` delivery mode instead of `steer`, while retaining `triggerTurn: true` for idle sessions. Impact: active coordinators finish their current work before actor results arrive, and Pi can apply its configured follow-up batching policy to concurrently completed runs instead of injecting each result between tool calls.
- `Agent Autonomy`: Clarified that command-template strings execute directly without shell evaluation, so `&&`, pipes, redirects, and `cd` are not composition. Strengthened skill routing so multi-actor fanout, independent artifacts, implementation, or review activates Swarm guidance, with a compact coordinator preflight for disjoint scopes, stable Run ids, artifacts, launch correctness, integration, and final validation.
- `CI Stability`: Wait for the detached runner process to exit before removing the large-review-evidence fixture directory, and wait for the terminal evidence manifest instead of racing its final write. Impact: Linux CI cleanup no longer intermittently fails with `ENOTEMPTY` after the assertions pass.

## 0.40.0: Durable Review and Runtime Hardening

- `Review Transport`: Moved each child `pi -p` prompt into one inspectable file, preserved intentional options and attachments, and required exact first-line `ACTOR_REVIEW_RESULT` evidence for reviewer stages. Fragmented prompts, acknowledgements, malformed markers, and rejected branches fail closed while retaining diagnostic stdout.
- `Run Safety`: Removed public `state_dir` overrides and required runtime-owned Run roots with canonical ownership markers. Cross-platform process proofs, realpath-normalized cwd, live owner-mismatch rejection, process-owned start locks, and lifecycle revalidation protect reuse, delivery, cancellation, kill, archive, and prune.
- `Execution`: Bounded model-facing stdout and stderr while persisting byte-exact attempt captures with UTF-8-safe tails, byte counts, and truncation metadata. Sequential and parallel pipelines consume complete spill files and fail closed when complete stdin is unavailable, including outputs above 1 MiB.
- `Registry`: Added filesystem-identity mutation locks, authoritative same-name collision checks, locked usage sidecars, active-definition routing, and parent-watcher rearming for absent or recreated Recipe roots. Dead lock owners may be reclaimed; external deletion revokes stale tools immediately.
- `Evidence`: Added terminal `review-evidence.json` manifests linking stable stages and branches to prompts, captures, exit state, semantic acceptance, Recipe context, model policy, and required prior-stage references. Interrupted commands finalize as cancelled or killed, and owned manifests remain bounded through existing Inspect views.
- `Review Validation`: Expanded deterministic dogfood across retries, parallelism, partial quorum, UTF-8, spills, semantic rejection, interruption, and terminal paths. Auditable six-lens reviews retained every stage and drove fixes for alias locks, identity, state roots, pipeline stdin, marker acceptance, notifications, registry collisions, start locks, and inspection races.
- `Terminal and Retention`: Made artifact preservation collision-safe and abort-before-delete. Terminal follow-ups retry until a handled marker is durable, avoid historical replay, and remain honestly at-least-once; authoritative terminal state short-circuits cancel before identity probing, and disappearing Runs are skipped safely during triage.
- `Release`: Added the named `dist/pi-actors/index.js` entrypoint, async-patience guidance, focused hardening backlog evidence, and final package, skill, asset, conformance, package-dry-run, diff, and context validation.

## 0.39.0: Actor Kernel Welcome Refresh

- `Docs`: Reworked the root README as a product/onboarding entrypoint for the local actor kernel, with clearer positioning, first-run path, feature showcase, recipe-memory model, address/message examples, and practical surface-selection guidance. Impact: new operators can understand when to use `spawn`, `message`, `inspect`, recipes, rooms, and artifacts without reading deep implementation docs first.
- `Context`: Added a durable README standard to `AGENTS.md` so future edits preserve the RhythmE/product entrypoint shape while keeping the practical capability catalogue visible.
- `Release`: Bumped package metadata to `0.39.0` for the onboarding refresh minor release.

## 0.38.1: Windows Recipe ACL Hotfix

- `Registry`: Replaced POSIX mode-bit recipe-root writability checks on Windows with ACL-aware diagnostics, avoiding false `world-writable` and `group-writable` startup warnings from Node's NTFS mode emulation while still flagging broad Windows write grants.
- `Tests`: Added portable coverage for broad Windows ACL parsing and skipped the POSIX chmod diagnostic regression on Windows.

## 0.38.0: Review Swarm Pipeline Hardening

- `Model Policy`: Added `{current_model}` and `{current_thinking}` inheritance to packaged review and lens swarms. Runtime injects current values, explicit args override them, and unresolved current placeholders fail before asynchronous fanout.
- `Provenance`: Persisted inherited, explicit, mixed, or unresolved `model_policy` in Run status, progress, terminal results, compact output, and follow-ups.
- `Prompt Transport`: Materialized child `pi -p` prompts as Run-local `prompts/command-NNN.md` files and invoked them through `@file`, preserving long prompts and Recipe context without fragile inline argv.
- `Diagnostics`: Expanded parallel evidence with byte counts, tail previews, failure reasons, prompt paths, quorum usability, and failed-Run details; all-empty or all-failed fanouts now fail.
- `Preflight`: Added `subagent-preflight` stage checks for model, thinking, and tools. Failures emit `ACTOR_PREFLIGHT_FAILED` with stage, policy, provider class, prompt file, and suggested overrides before reviewer fanout begins.
- `Quorum`: Added TTL, concurrency, minimum-success, and merge-policy controls. Partial evidence is retained, downstream stages require the threshold, and normalized reports identify complete, degraded, or insufficient-data outcomes.
- `Dogfood`: Added deterministic fake-`pi` review-readiness conformance for preflight, degraded fanout, prompt artifacts, branch failures, merge gating, and terminal state without external models.
- `Guidance`: Updated README, skills, Recipe and Run docs, onboarding, and backlog around maintained review Recipes, inherited policy, prompt files, preflight, quorum controls, inspectable diagnostics, and remaining hardening work.

## 0.37.1: Subagent Recipe Prompt Injection Hotfix

- `Recipes`: Fixed actor recipe context injection for child `pi -p` launches with options after the print flag, so packaged subagent recipes such as `subagent-review` and `pipeline-review-readiness` append context to the actual prompt instead of corrupting `--model` or other option values.
- `Guidance`: Tightened onboarding, actor-skill, and recipe-library guidance so agents prefer maintained packaged review recipes via `spawn file=<recipe>` before rebuilding script commands or creating unnecessary wrappers.

## 0.37.0: Direct Recipe Delegation And Quiet Overrides

- `Recipes`: Added direct recipe delegation from `template` strings so thin wrappers can point at ready recipe names/paths while preserving priority resolution, inherited metadata, and import-based composition for richer graphs.
- `Command Templates`: Fixed inherited/default placeholder resolution for arrays and repeat-indexed values, unblocking lens-swarm recipes that pass `lenses` through wrapper defaults into `{lenses.length}` and `{lenses[index]}`.
- `Registry`: Stopped treating same-name recipe/tool registration as a startup warning: higher-priority user recipes now quietly override lower-priority recipe/tool definitions as normal composition behavior, while reserved core tool names remain protected.

## 0.36.0: Recipe Diagnostics And Runtime Triage

- `Recipe Doctor`: Added deterministic advisory risk labels for discovered recipes, including shell, eval, filesystem mutation, network, external side effect, long-running, platform-specific, and secret-touching signals in verbose recipe inspection plus compact doctor risk counts.
- `Runtime`: Added `inspect target=tool:pi-actors view=triage` as a compact read-only operator attention surface covering runtime mode, active and other-session runs, invalid or blocking recipes, exposed tool recipes with non-lifecycle risk labels, drafts, stale claims, failed runs, attention messages, and next inspect actions.
- `Recipes`: Added packaged recipe QA through `validate-recipe.mjs --qa` and `npm run recipes:qa`, with exact diagnostics for async mailbox contracts, termination vocabulary, artifact paths, platform scope, installed-package-safe helper paths, and missing helper scripts.
- `Runtime`: Hardened wake/watch chaos behavior with deterministic coverage for watcher restarts, partial wake records before file catch-up, corrupt wake JSONL with later valid records, missing wake records with durable inbox work, and killed runs with stale progress state.
- `Docs`: Documented recipe-doctor risk labels, runtime triage, packaged recipe QA, and import-first ready-recipe registration as operator review aids and source-of-truth preservation, not sandbox, repair, or security-boundary claims.

## 0.35.0: Draft Recipe Promotion UX

- `Recipes`: Added draft recipe promotion UX: `inspect target=recipes view=summary verbose=true` now exposes draft timestamps, fingerprints, validation state, source run when known, and template previews, while `register_tool name=<tool> draft=<path>` promotes a validated draft into active recipe memory without deleting the draft and rejects collisions unless `update=true` is explicit.

## 0.34.1: Message Delivery Outcome Hotfix

- `Dogfood`: Added a deterministic actor-worker stale-claim smoke covering an intentionally claimed branch inbox record; the worker now reports stale claim counts in both `worker-status.json` and its awaiting-assignment room event without adding auto-recovery or scheduler policy.
- `Messages`: Normalized public message results with `delivered`, `persisted`, `queued`, `forwarded`, `consumer`, and `reason` fields across run, branch, room, coordinator, session, and tool destinations; room multicast now also exposes per-recipient branch delivery outcomes.
- `Backlog`: Closed the worker stale-claim dogfood and message delivery outcome work after adding delivery-result coverage for run, branch, room, coordinator, session, tool, and ownership-denied paths.

## 0.34.0: Actor Kernel Domain Compression

- `Domains`: Compressed the actor kernel into explicit domain families: `tools.ts` remains the public tool-family owner while `tools-*` owns message, inspect, spawn, register, local execution, response, access, and mailbox-contract behavior; `async-runs.ts` remains the lifecycle facade while `runs-*` owns artifacts, mailbox, process control, delivery, outbox, index, retention, status, start guards, and identity internals.
- `Domains`: Removed redundant internal `actor-` prefixes and renamed the recipe family to plural `recipes-*`, leaving public actor-named recipe/script/docs surfaces intact while making core library ownership match the `tools-*` and `runs-*` convention.
- `Scripts`: Collapsed script-only runner, worker, validator, recipe-utils, locker, and coordinator library shims back into their owning `scripts/*.mjs` entrypoints; reusable lifecycle, room, mailbox-loop, command-template, and recipe-reference primitives remain in `lib/`.
- `Context`: Reversed the thin-script default, polished ownership headers, and kept completed script-autonomy/domain-compression work in the changelog instead of the backlog.
- `Tests`: Mirrored renamed domains in test filenames and extended installed-package contract coverage to ensure stale renamed lib domains are absent from `dist/lib` while packaged JS-only script execution still works.

## 0.33.0: Signal-First Compatibility Pruning

- `Breaking`: Removed pre-1.x compatibility shims for draft recipe terminology: draft captures now live under `~/.pi/agent/recipes/drafts`, recipe inspection no longer emits `candidates`, spawn details no longer emit `candidate_recipe`, and shadow diagnostics use `blocked_fallback` instead of `blocked_candidate`.
- `Context`: Documented the pre-stable policy that context compression wins over compatibility aliases until after a stable release greater than `1.x.x`; rename slices should remove legacy actor-facing names, fields, env vars, paths, and docs instead of carrying shims.
- `Breaking`: Renamed retained registry storage from `legacy-tool-registry.json` to `tool-registry.json`, removing the stale compatibility noun from runtime path helpers and tests.
- `Types`: Added a narrow actor tool-definition type and removed the remaining `Map<string, any>` from the composition root without expanding SDK type exposure.
- `Scripts`: Collapsed the conformance runner back into a standalone script and removed its one-off lib domain, documenting that script-only glue should stay self-contained unless reuse or packaged runtime constraints justify a domain.

## 0.32.0: Actor Surface Minimization

- `Context`: Added durable signal/noise guidance for actor-facing surfaces: keep the model-facing concept ladder minimal, make feedback hints state-backed and action-shaped, and avoid speculative advisory prose.
- `Backlog`: Added critical concept-surface compression and actor feedback-loop strengthening tracks to guide the next minimization-focused development cycle.
- `Concepts`: Compressed model-facing language by presenting captured inline-spawn recipes as drafts, treating `room:<run>` as advanced group messaging plus roster, demoting coordinator/session/debug views from golden-path guidance, and keeping compatibility names/paths as storage details rather than core onboarding nouns.
- `Feedback`: Added bounded next-action hints to recipe registry/doctor inspection, artifact inspection, delivery-fallback message results, and terminal run follow-ups so state-backed surfaces point back to `inspect`, `message`, `spawn`, or draft promotion without polling or auto-repair.
- `Sessions`: Normalized session-directed message ownership failures onto the same structured `reason=session_mismatch`, owner/current session, and inspect-session hint shape used by run, branch, room, and coordinator ownership denials.

## 0.31.0: Agent Adoption Ergonomics

- `Adoption`: Added a compact actor-mode trigger rule to the injected prompt, actors skill, README, and async-run docs so models prefer `spawn → message → inspect` for long-lived, stateful, follow-up, artifact, service, fanout, and resumable work while keeping short foreground checks as ordinary tools.
- `Skills`: Reframed the bundled actors skill as required practical guidance for non-trivial actor use or pi-actors changes, and made the injected prompt route agents to it before improvising actor workflows.
- `Tools`: Strengthened `spawn`, `message`, and `inspect` descriptions with adoption cues that steer models away from ad hoc shell backgrounding, actor restarts, and polling loops.
- `Spawn`: Added explicit next-action feedback to spawn results so newly created actors immediately suggest inspect/message chains instead of leaving agents to infer the next step.
- `Docs`: Added a task-first “when to use actors” golden path to the README without adding public verbs or scheduler/service-manager concepts.

## 0.30.2: Music Player Kill Hotfix

- `Music Player`: Kept backend player processes inside the async run process group so `control.kill` can terminate an active music-player run without leaving detached `cvlc`/player children alive.
- `Docs`: Updated durable project guidance, actor skill guidance, async-run ownership docs, and recipe-library music-player notes to preserve the run-owned process-tree invariant while still allowing true daemon recipes through explicit termination bridges.

## 0.30.1: Backlog Curation Hotfix

- `Backlog`: Added curation rules clarifying that completed work belongs only in the changelog, that cohesive ~1000-line domain files are acceptable, and that file splitting should follow real ownership boundaries rather than line count alone.
- `Backlog`: Added small cleanup candidates for typed tool-boundary tightening and retained registry-path naming clarity without expanding the public actor surface.

## 0.30.0: Composition Root Compression

- `Entrypoint`: Added a narrow Pi SDK adapter domain, moved recipe live-reload mechanics into the runtime domain, moved run-state watcher, run UI observation state, and run notification formatting into observability, moved runtime path constants and co-located skill path discovery to the paths domain, grouped core actor tool definitions in the tools domain, and shifted actor-inspector command state/parsing/render selection into the actor-inspector domain so `index.ts` keeps only live Pi wiring.
- `Backlog`: Added focused next-minor candidates for message delivery outcomes, candidate recipe promotion, recipe risk labels, runtime triage, packaged recipe QA, and wake/watcher chaos fixtures while deferring broader golden-flow documentation until the core diagnostic surfaces settle.

## 0.29.3: Actor Skill Context Hotfix

- `Skills`: Reconciled knowledge-surface layering across project and actor guidance, added a project topology map, moved multi-agent methodology from the actors runtime skill into the swarm skill, and split actor quick-start guidance from a deeper recipe/operating-pattern reference.

## 0.29.2: Legacy Migration Removal Hotfix

- `Registry`: Removed the old legacy tool-registry migration path now that recipe-file storage is the only maintained persistence surface.

## 0.29.1: Subagent TTL Kill Hotfix

- `Coordinator`: Added `subagent_ttl_ms` / `--subagent-ttl-ms` to the room-swarm adapter so timed-out subagent `pi -p` processes are terminated instead of only awaited.

## 0.29.0: Candidate Recipe Memory

- `Spawn`: Capture inline spawn templates as non-registered candidate recipes under `~/.pi/agent/recipes/candidates`, making successful ad hoc actor patterns easy to replay by explicit path and promote manually.
- `Inspect`: Add candidate recipe counts and verbose candidate metadata to recipe registry inspection without registering candidates as tools.
- `Skills`: Documented the two-layer executable memory model: candidate recipes as a proving ground and root recipes as active tool memory.

## 0.28.1: Portable Agent Protocol Hotfix

- `Docs`: Removed a machine-local private validation skill reference from the repository agent protocol so extension guidance stays portable.

## 0.28.0: Shadowed Recipe Launch Diagnostics

- `Spawn`: Added minimal shadowed-recipe diagnostics when a bare recipe launch already fails because an invalid or disabled higher-priority recipe blocks a lower-priority fallback; healthy recipe overrides remain silent.
- `Async Runs`: Treat disabled template recipes as non-launchable so disabled shadowing fails consistently instead of silently executing.
- `Docs`: Clarified the quiet shadowing contract, disabled recipe launch behavior, and recipe-doctor hint path.
- `Backlog`: Reframed shadowed recipe launch diagnostics as diagnostic-on-failure only, preserving shadowing as an intentional user override mechanism without startup warnings or automatic remediation.

## 0.27.1: Changelog and Backlog Hotfix

- `Changelog`: Moved the 0.27.0 runtime/session observability notes out of `Unreleased` into a proper release section so published package history matches the npm/tag release.
- `Backlog`: Marked runtime/session observability complete and added the next evidence-backed candidates for shadowed recipe launch UX, session mismatch follow-through, and worker stale-claim dogfood.

## 0.27.0: Runtime and Session Observability UX

- `Inspect`: Added `inspect target=tool:pi-actors view=status` as a runtime verification surface with loaded version, package root, source/dist mode, entrypoint path, recipe roots, and git commit when available.
- `Sessions`: Started structured session mismatch diagnostics with `reason=session_mismatch`, owner/current session fields, and compact inspect-session hints while preserving current ownership gates.
- `Sessions`: Added other-session run counts to coordinator/session status summaries so reload/resume states do not misleadingly report only `runs=0` without nearby context.

## 0.26.3: Branch Message Delivery UX Hotfix

- `Actor Messages`: Treat branch mailbox persistence as a successful queued outcome even when the parent run control endpoint is unavailable, returning compact `queued=true` delivery diagnostics instead of throwing an unframed tool error.
- `UX`: Preserve the compact action-output contract for branch `message` calls by keeping delivery diagnostics in the normal result formatter, including the leading blank-line separation used by other tool actions.

## 0.26.2: Terminal Progress Hotfix

- `Async Runs`: Keep `progress.json` aligned with terminal kill/cancel handling by writing `phase=killed` or `phase=cancelled` and clearing active subagent counts when a run is stopped by runtime control.
- `Inspector`: Prevent killed runs from showing contradictory `status=killed` with `progress.phase=running`, preserving compact operator status trust after `control.kill`.

## 0.26.1: Coordinator Empty-Synthesis Hotfix

- `Coordinator`: Treat all-failed participant rounds and empty synthesis as a failed coordinator run instead of a clean success, preserving operator trust when swarm branches all exit non-zero.
- `Artifacts`: Write compact diagnostics into empty synthesis artifacts, including participant attempt/success/failure counts and transcript size, so failed swarms leave actionable evidence instead of only `No synthesis output`.

## 0.26.0: Actor Worker v2 and Package Contract Hardening

- `Actor Worker`: Promoted the packaged `actor-worker` into a v2 reference pattern with compact `worker-status.json`, optional per-task result artifacts under `worker-artifacts/`, stale-claim surfacing through status, and artifact metadata on `task.result` room messages.
- `Recipes`: Audited packaged async recipe mailbox contracts so `control.stop` and `control.cancel` remain declared only for actor-domain handlers such as locker/coordinator/music control, while generic async recipes expose `control.kill` for runtime termination.
- `Packaging`: Hardened dist package regressions with mirrored asset checks for `dist/scripts`, `dist/recipes`, `dist/fixtures`, and `dist/skills`, plus negative checks for stale dist files and source-only runtime imports in built script shims.
- `Skills`: Updated the actors skill recipe navigator to document the v2 worker pattern and its `control.kill` termination contract.

## 0.25.0: Recipe Doctor Remediation UX

- `Recipe Doctor`: Added prioritized advisory remediations to recipe doctor output, including a compact top action, structured verbose remediation entries, blocked lower-priority candidates for invalid/disabled overrides, and ordered coverage for invalid, disabled, shadowed, and risky shell-boundary recipes.
- `Docs`: Documented the recipe doctor remediation surface in the tool registry guide.

## 0.24.8: Mailbox Loop Kill Contract Hotfix

- `Mailbox Loop`: Aligned generic mailbox-loop termination with the actor-message kill contract: only `control.kill` stops generic loop drains; `control.stop` and `control.cancel` remain actor-domain messages unless a recipe handles them explicitly.
- `Docs`: Updated worker and recipe guidance so backlog implementer shutdown examples use `control.kill` for runtime termination and describe `control.stop` as domain-local vocabulary.

## 0.24.7: Actor Message Kill Contract Hotfix

- `Actor Messages`: Narrowed runtime termination by actor message to `control.kill` only; `control.stop` and `control.cancel` now remain recipe-local mailbox vocabulary instead of aliases for killing/cancelling a run.
- `Docs`: Updated actor-message, async-run, and actor-skill guidance so only `control.kill` is documented as the action that kills an actor run.

## 0.24.6: Async Run Restart Status Hotfix

- `Async Runs`: Treat freshly spawned runner PIDs as running during a short Linux `/proc` identity grace window, preventing restart status checks and immediate run messages from misclassifying a new run as `exited` before its command line is observable.

## 0.24.5: Auto-Discovered Skills Hotfix

- `Skills`: Auto-discovered source checkouts now contribute their co-located `skills/` directory through Pi resource discovery, so extension-local actors/swarm skills load even when `pi-actors` is used directly from `~/.pi/agent/extensions` instead of installed as a package.
- `Packaging`: Kept package skill metadata directory-based for both `dist/skills` and source `skills`, preserving bundled skill discovery through package installs while the extension also contributes co-located skills at runtime.

## 0.24.4: Music Player Message Control Hotfix

- `Music Player`: Preserve typed actor-message envelopes for run-mailbox delivery so `player.<action>` messages dispatch by message type instead of relying on body payload text.
- `Music Player`: Emit `player.stopped` when playback stops so actor inspector and run messages show an explicit domain stop event before terminal completion.

## 0.24.3: Actor Inspector Body Field Hotfix

- `Inspector`: Removed the selected-item key-label shim by projecting actor-message detail rows with a real `body` field instead of rendering `body_preview` under an alias.

## 0.24.2: Actor Inspector Item View Hotfix

- `Inspector`: Removed the roster panel from selected actor-message item inspection, kept the compact route header styling, added the same left/right gutter used by inspector rows, and renamed the selected-item `body_preview` label to `body`.

## 0.24.1: Build Script Package Hygiene Hotfix

- `Backlog`: Added the next focused backlog set for recipe doctor remediation UX, actor worker v2, and dist package contract hardening.
- `Skills`: Clarified agent-governed promotion of successful transient actor patterns into durable local tools via `register_tool`, without UI buttons or automatic registration.

## 0.24.0: Reliability, Mailbox Workers, and Dist-First Packaging

- `State and Observability`: Added resilient JSON and JSONL readers across rooms, Inspector, wake, inbox, and outbox state. Malformed records degrade with diagnostics, while stable event ids prevent line-counter resets from replaying follow-ups and stale dedupe state is pruned.
- `Mailbox Loop`: Added bounded Run and branch claim, handle, fail, stop, and duplicate-claim mechanics plus a packaged `actor-worker` demonstration of the canonical mailbox worker loop.
- `Dist-first Build`: Moved actor-worker, async-runner, validation, conformance, Recipe utilities, locker, and coordinator behavior behind compiled TypeScript domains while preserving stable script shims. Build cleans stale output, mirrors scripts, Recipes, fixtures, and skills, then syntax-checks entrypoints.
- `Packaging`: Pointed installed extension and skill metadata at compiled `dist` while preserving optional source metadata, and moved the build pipeline into `scripts/build-dist.mjs`. Installed-package tests ensure helpers never import TypeScript from `node_modules`.
- `Recipes`: Fixed quorum-review expansion and accepted compact Markdown frontmatter forms for comma-separated args and list-style defaults, normalizing both to canonical Recipe shape.
- `Protocol`: Defined dotted `channel.action` types as the minimal action surface and added fixtures for messages, mailboxes, inbox and outbox records, rooms, Run state, Recipe summaries, and artifact manifests.
- `Portability`: Documented mailbox-only, FIFO, named-pipe, and process-control support across Linux, macOS, WSL, and native Windows, with regressions preserving Windows FIFO limitations and mailbox-only worker behavior.
- `Context`: Made registry warnings actionable, clarified actor and swarm skill ownership, framed capability evolution around explicit inspectable state, and closed the reliability, mailbox, protocol, portability, and compiled-entrypoint backlog milestones.

## 0.23.0: Actor Manifests, Inspection, and Runtime Hygiene

- `Routing and Mailbox`: Unified direct-branch and selected room multicast routing through the same branch-local inbox shape, added typed mailbox contracts with normalized inspection, and warned on undeclared Run message types.
- `Attention and Inspector`: Added response-required follow-ups, notification-level progress defaults, stable event ids, needs-response markers, and session-local read markers to Inspector previews and details.
- `Recipe Health`: Added `inspect target=recipes view=doctor|imports` for compact health, mitigation, import aliases, and source references. Trusted wrapper warnings stay out of startup noise but remain available in diagnostics.
- `Artifacts and Retention`: Resolved declared artifact existence, size, hash, and required-missing state, and added fail-closed terminal archive and prune controls with optional collision-safe preservation.
- `Run Index`: Added a rebuildable, nested-Run-safe state index for listing and observability, with recursive-scan fallback when the index is corrupt.
- `Conformance`: Added `npm run conformance` across Recipes, registry, spawn lifecycle, messaging, rooms, branch inboxes, ownership, artifacts, and attention semantics.
- `Bounded State`: Centralized Inspect, preview, and tool-output limits; exposed room compaction counts and retained timestamps; and added Recipe launch-kind telemetry with fingerprint-reset reasons.
- `Script Guidance`: Added helper-script descriptions and explicit mitigation guidance for shell, eval, and broad-filesystem trust boundaries.

## 0.22.5: CI Stability Hotfix

- `Tests`: Stabilized the Windows named-pipe control endpoint regression by keeping its synthetic run alive longer under slower full-suite CI scheduling.
- `Tests`: Stabilized the coordinator-locker queue/lock smoke by waiting for assignment, renewal, and denial actor messages before stopping the helper, removing a FIFO processing race from main-branch validation.

## 0.22.4: Actor Isolation and Registry Diagnostics Hotfix

- `Recipe Exposure`: Added regressions proving ad hoc Recipes outside the user root remain components, while invalid JSON, missing templates, and malformed Markdown retain actionable severity and repair diagnostics.
- `Observability`: Keyed Run transitions by state directory rather than display id so nested or reused names cannot collide in follow-ups or pruning state.
- `Delivery`: Preserved durable queued state, inbox id, and delivery errors after endpoint failure; successful FIFO, named-pipe, and mailbox-only sends also expose the inbox id.
- `Isolation`: Added fail-closed cross-session kill, branch, room, sender, and multicast-recipient checks. Invalid routing writes no inbox or room record and session-owned Runs remain scoped to their actor tree.
- `Resilience`: Made malformed branch JSONL degradable and visible, and preserved cancelled or killed terminal inference plus event-only tail behavior when result files are absent.
- `Registry`: Allowed `register_tool` object templates with composition flags and precise errors, while live reload keeps invalid high-priority updates blocking fallback and refreshes recovered schemas without restart.
- `Tool Errors`: Preserved routed tool name, message type, bounded params, and original error when `message to=tool:<name>` fails.
- `Protocol Tests`: Executed public message, room join and leave, mailbox, spawn, and Inspect examples in CI so documentation drift fails.

## 0.22.3: Idempotent GitHub Release Workflow Hotfix

- `Release`: Made the tag-triggered GitHub Release workflow idempotent: existing releases are edited with the generated title and notes instead of failing when an operator already created the release for the tag.
- `Context`: Added a changelog signal rule to project context and removed release-bookkeeping-only bullets from changelog history so future entries describe meaningful behavior rather than package-version metadata.

## 0.22.2: Portable Recipe Tool Exposure Hotfix

- `Registry`: Stopped writing redundant exposure metadata during registration and aligned docs/tests around location-based tool exposure so recipes remain portable between user, ad hoc, and packaged roots.
- `Skills`: Generalized the actors-skill tool-registration lenses and added existing recipe surfaces, including skill-local recipes, as first candidates for promotion into durable tools.

## 0.22.1: Tool Registration Lens Hotfix

- `Skills`: Added tool-registration lenses to the packaged actors skill so agents prefer persistent tools for error-prone workflows, safe preflights around dangerous operations, and context-affordance shortcuts that should be visible in future sessions.

## 0.22.0: Cross-Platform Runtime Notification Layer

- `Runtime`: Added file-backed advisory wake records with initial, wake, and poll reconciliation plus periodic fallback for Run, room, and branch activity. Messages persist canonical inbox state before optional endpoint delivery, support mailbox-only endpoints, expose recent entries through Inspect, and use locked claim, handle, or fail transitions. Files remain authoritative for inspection and crash recovery.
- `Docs/Tests`: Documented the "wake, not queue" runtime model, added cross-platform music-player smoke guidance, and added coverage for persisted wake events, missed `fs.watch` recovery through polling, and Windows named-pipe message wakes.
- `Packaging`: Removed the root JavaScript entrypoint wrapper from packaged files and pointed extension metadata directly at the compiled `dist/index.js` output. Source checkouts keep `index.ts` as the only root entrypoint while installed packages load compiled JavaScript from `dist`.
- `Docs/Prompts`: Removed stale FIFO-queue wording from branch-direct message docs and coordinator prompt injection so queued mailbox work is described consistently with the notification/runtime model. Clarified that worker-backed direct branch messages are runner-owned prompt steering, not coordinator follow-ups, while one-shot prompt children do not consume branch inbox records automatically.
- `Recipes`: Migrated the packaged music-player control path from Unix FIFO commands to queued mailbox commands, preserving addressed `message` control while making the script align with mailbox-only runtime endpoints.
- `Recipes`: Added a native Windows `wmp` music-player backend that drives legacy Windows Media Player through `powershell.exe`/COM, verifies `wmplayer.exe` in the standard Program Files locations, and includes mailbox-backed play, pause, next, previous, and stop controls.
- `Recipes`: Reduced music-player mailbox overhead by using advisory wake records, `fs.watch` where available, and inbox file signatures so the loop avoids repeatedly locking and rereading an unchanged mailbox.
- `Recipes`: Improved Unix-like playback by adding the macOS-native `afplay` backend, scanning additional common audio extensions, and running child players in their own process group so controls can signal the playback subtree directly.

## 0.21.0: Native Windows Actor Control and Literate Recipes

- `Cross-platform Control`: Preserved Unix FIFO control and added native Windows named-pipe endpoints in Run state, with one message receipt path updating events and inbox state.
- `Process Control`: Added Windows process-tree termination through `taskkill` while retaining Unix process-group signals, and migrated locker and coordinator scripts to the shared platform-adapted endpoint metadata.
- `Branch Retention`: Bounded terminal branch inbox history while preserving queued and claimed work for long-lived runners.
- `Recipe Safety`: Surfaced combined shell or eval flags and nested command templates in trust diagnostics, including known packaged wrapper boundaries.
- `Markdown Recipes`: Loaded `.md` Recipes from frontmatter plus fenced executable blocks, with same-layer JSON shadowing Markdown by id.
- `Rooms and Coordinator`: Retained file-backed rooms pending real subscription needs, centralized locked branch claim and finalize mutation, and made room-swarm mode dispatch explicit and fail-closed.
- `Retirement`: Discovered nested child Runs, blocked retirement while children run, reported child counts, and retired ready supervisors through graceful stop then owned cancellation fallback without stopping non-opt-in services.
- `Validation`: Documented and tested Windows endpoints, named pipes, process planning, Unix FIFO parity, locker metadata, branch compaction, mixed room routing, Markdown Recipes, nested retirement, Inspector navigation, persistence, and trust diagnostics.

## 0.20.2: Installed Extension Entrypoint Hotfix

- `Packaging`: Added a JavaScript extension entrypoint wrapper and changed package metadata to load `./index.js`, so npm-installed packages import compiled `dist/index.js` instead of asking Node to strip `index.ts` under `node_modules`. Source checkouts still fall back to `index.ts` before a local build exists.
- `Build`: Extended the compiled runtime build to emit `dist/index.js` alongside `dist/lib/*.js`, keeping extension entrypoint imports and script runtime imports on the same installed-package path model.
- `Rooms`: Fixed immediate room append results to report the true persisted room message count after long timelines instead of the default 40-message preview length; `appendRoomMessage`, existing-member room joins, and `getRoomStatus()` now share the same line-count helper.
- `Tests`: Added installed-package coverage that imports the extension entrypoint from package metadata without TypeScript stripping, plus room-count regression coverage beyond the default preview limit.

## 0.20.1: Installed Packaged Recipe Root Hotfix

- `Recipe Imports`: Fixed installed compiled runtime path resolution so bare user recipe imports can fall back to the packaged standard-library `recipes/` directory instead of looking for a non-existent `dist/recipes` directory.
- `Tests`: Added installed-package validation coverage for a user recipe that imports a packaged recipe by bare name, preserving the documented priority order for user, adjacent, and packaged recipes.

## 0.20.0: Compiled Runtime Entrypoints

- `Packaging`: Added a build step that emits compiled `dist/lib/*.js` and declaration files from the TypeScript runtime modules, with relative `.ts` imports rewritten to `.js` for installed package execution.
- `Async Runs`: Replaced the emergency installed-package copy workaround in `scripts/async-runner.mjs` with dist-first imports. Installed npm packages now execute the async runner against compiled JS without relying on Node native type stripping for `.ts` files under `node_modules`; source checkouts still fall back to TypeScript imports for local development.
- `Scripts`: Updated `scripts/validate-recipe.mjs` to use the same dist-first import path, so packaged recipe validation also runs from compiled JS when installed from npm.
- `Tests`: Updated installed-package smoke coverage to simulate `node_modules/@llblab/pi-actors` with `dist`, execute scripts without `--experimental-strip-types`, and assert the old `.type-strip-lib` workaround is not used.
- `Package`: Changed the package description to `Local Actor Kernel for Pi`, added `tsconfig.build.json`, and included `dist` in the published package.

## 0.19.11: Installed Async Runner Hotfix

- `Async Runs`: Fixed installed npm package async recipe launches on Node 22 by avoiding direct runtime imports of raw `.ts` files from under `node_modules` in `scripts/async-runner.mjs`. Installed runners now copy the package `lib` sources into the run state before importing them, keeping Node native type stripping outside the blocked `node_modules` path.
- `Scripts`: Applied the same installed-package import guard to `scripts/validate-recipe.mjs`, so the packaged recipe validator works when invoked from an installed `@llblab/pi-actors` package.
- `Tests`: Added installed-package script smoke coverage that copies `lib`/`scripts` under a temporary `node_modules/@llblab/pi-actors` path and verifies both async runner execution and recipe validation avoid `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

## 0.19.10: Legacy Branch Message Claim IDs

- `Branch Messages`: Coordinator claim handling now assigns IDs to older/manual queued branch inbox entries that lack `id`, so injected direct messages can still transition to `handled` or `failed` and do not repeat forever.
- `Tests`: Extended direct branch inbox coordinator coverage to include a legacy no-ID message and assert both claimed/handled timestamps are recorded.
- `Docs/Context`: Updated actor-message docs and durable project context for legacy branch message claim IDs.

## 0.19.9: Locked Branch Inbox Mutations

- `Branch Messages`: Added lock-guarded append and status rewrites for branch-local direct-message inbox files so concurrent direct delivery and coordinator claim/handle transitions do not overwrite each other.
- `Coordinator`: Made room-swarm branch prompt execution atomically claim queued direct messages before injection, then mark claimed messages as `handled` or `failed` after the child prompt exits.
- `Tests`: Added concurrent branch inbox append coverage and asserted coordinator direct-message handling records both `claimed_at` and `handled_at`.
- `Docs/Context`: Updated actor-message docs, project context, and backlog safeguards for locked branch inbox mutations.

## 0.19.8: Efficient Room Status Reads

- `Rooms`: Changed room status inspection to count JSONL entries and read only the last timeline record instead of parsing the full room timeline into actor-envelope objects.
- `Inspector`: Preserved the existing `inspect room:<run> view=status` shape while reducing storage/read amplification for large room transcripts.
- `Docs/Context`: Updated actor-message docs, backlog safeguards, and project context for efficient room status reads.
- `Tests`: Added regression coverage that room status preserves message count and last-message metadata across longer timelines.

## 0.19.7: Burst-Safe Roster Writes

- `Rooms`: Debounced room roster rewrites when a burst only changes a member's `last_seen`, while still writing semantic roster changes such as role, status, display, caps, claim, or parent immediately.
- `Runtime IO`: Added `PI_ACTORS_ROOM_ROSTER_MIN_MS` as the roster-only debounce interval, mirroring the existing communication snapshot debounce approach without changing public `room:<run>` message or inspect semantics.
- `Docs/Context`: Updated actor-message docs, project context, and the remaining rooms backlog scope to preserve the new burst-safe roster invariant during future storage/backend changes.
- `Tests`: Added regression coverage for roster rewrite debounce and immediate semantic roster updates.

## 0.19.6: Conservative Retirement Candidates

- `Observability`: Added per-run descendant `pi -p` worker counting and exposes `descendantSubagents` on run observations. Ambient run status still counts active descendant workers, but now retains the per-run attribution needed for supervisor lifecycle decisions.
- `Retirement`: Tightened opt-in `retire_when: "children_terminal"` candidate detection so supervisors are not considered retirement-ready while command-template progress or descendant `pi -p` workers are still active.
- `Docs/Context`: Updated async-run docs, project context, and the remaining retirement backlog scope to reflect the conservative candidate baseline and the remaining child async-run/output-flush work.
- `Tests`: Added regression coverage that blocks retirement candidates with descendant subagents.

## 0.19.5: Branch Inbox Inspector Filters

- `Actor Inspector`: Added branch-local inbox previews to the compact actor communication table, so queued direct `branch:<run>/<branch>` work is visible alongside room, run inbox, and outbox messages.
- `Actor Inspector`: Added `/actors-inspector-filter unread`, `/actors-inspector-filter branch <name>`, and `/actors-inspector-filter current-branch <name>` to focus queued branch inbox work and one branch's room/direct/inbox traffic without exposing full payloads by default.
- `Docs/Skills`: Updated README and the packaged actors skill with the new inspector filters and branch-inbox preview behavior.
- `Backlog`: Closed the high-priority actor communication TUI preview item now that unread/current-branch navigation is implemented with branch read-state semantics.

## 0.19.4: User Recipe Collection Suggestions

- `Observability`: Broadened recipe persistence suggestions from direct inline spawns to the normal user workflow: any successful actor run backed by a recipe outside `~/.pi/agent/recipes` now asks the launching agent to offer copying/registering it into the user recipe root when it fits this machine's recurring workflow.
- `Runtime`: Preserved the ask-first boundary and suppression for recipes already in the user recipe root, so pi-actors grows operator muscle memory without silently writing user recipe files.
- `Docs/Prompt`: Updated README, async-run docs, actors skill, onboarding prompt, and project context to frame `~/.pi/agent/recipes` as the everyday per-machine collection of reusable actor recipes/tools.
- `Tests`: Added coverage for successful external recipe suggestions, while keeping user-owned recipe suppression covered.

## 0.19.3: Spawn Recipe Persistence Suggestions

- `Observability`: Added semi-active recipe persistence suggestions for successful direct `spawn` runs. Inline/ad hoc spawned actors now record `launch_source: "spawn"`, and their successful terminal follow-up asks the agent to offer saving the reusable pattern as a durable recipe/tool under `~/.pi/agent/recipes` without auto-saving.
- `Runtime`: Recorded `launch_source` metadata for actor starts so observability can distinguish direct spawns from registered recipe-tool runs and avoid prompting for actors already backed by user-owned recipes.
- `Docs/Prompt`: Updated onboarding prompt guidance, README, async-run docs, and project context around ask-first recipe persistence after successful transient actors.
- `Tests`: Added regression coverage for successful transient spawn suggestions and suppression when the run already came from a saved user recipe.

## 0.19.2: Actor Recipe Context Bundle

- `Actor Context`: Added a recipe context bundle for file-backed async recipes. The runtime now collects the raw authored entry recipe and resolved imports into deterministic JSONL records with filename-derived `name`, import alias/path metadata, role/depth, and raw recipe JSON so spawned LLM actors can understand the workflow composition behind their prompt.
- `Actor Context`: Annotated command-template leaves with actor recipe context and appends the JSONL bundle to child `pi -p` prompts. The recipe record that launched the current child receives `"you_are_here": true` plus path metadata, enabling actors to give advisory feedback on their own recipe/composition fit; recipes can opt out with `"actor_context": false` / `"off"` when a minimal prompt is required.
- `Tests`: Added coverage for raw recipe context record generation, import identity, `you_are_here` JSONL marking, prompt injection for `pi -p`, execution-time context propagation, async-run persistence, and recipe opt-out behavior.

## 0.19.1: Actor Inspector Hotfix

- `Actor Inspector`: Fixed the live communications roster and row numbering controls after real swarm usage. `/actors-inspector-toggle <rows>` now keeps the room preview cap aligned with the requested row count, current-run sequence numbers are assigned before row limiting so the visible tail keeps its full-log positions, and roster role labels use concise `name/role` text instead of slugifying full role descriptions.
- `Coordinator`: Preserved explicit `--thinking off` forwarding in `scripts/coordinator.mjs` so packaged room-swarm launches keep caller-selected thinking policy instead of silently relying on CLI defaults.

## 0.19.0: Modular Coordination And Active Mailboxes

- `Coordination`: Split `coordinator-locker.mjs` into an independent stateful locker for resource leases and task queues plus a modular coordinator for execution lifecycles and process pools. Coordinator modes cover consensus chat, sequential pipelines, parallel fanout, and locker-backed worker pools.
- `Actor Messages`: Implemented active direct actor inbox queue semantics. The modular coordinator now automatically inspects, claims (`claimed`), injects into prompt context, and finalizes (`handled` or `failed`) any queued direct branch messages (`branches/<branch>/inbox.jsonl`) during subagent executions, making direct messages active initiating work items. Backed by complete regression test coverage.

## 0.18.0: Actor Runtime Hardening And Recipe Guardrails

- `Async Runs`: Serialized concurrent starts, rejected duplicate active Run ids or state directories before clearing, cleaned stale terminal state, and used collision-resistant atomic JSON writes so restarts cannot overwrite live evidence.
- `Command Templates`: Added a default configurable cap of 64 parallel branches, rejecting accidental unbounded repeat or fanout expansion.
- `Rooms and Messages`: Serialized room state, persisted branch inbox transitions, debounced snapshots, bounded reads and retained timelines, and supported selected-recipient same-Run multicast with one room transcript entry.
- `Actor Inspector`: Added compact channel and mention filters, bounded previews and row counts, wrapped role/name rosters, muted departed members, stable narrow layouts, and wide-character-safe rendering.
- `Observability`: Pruned stale observation state, cached active-subagent scans, and counted descendant coordinator-launched `pi -p` workers in ambient status.
- `Recipes`: Enforced file size, import depth, trust and permission diagnostics, integrity manifests, watcher warnings, filename identity, priority imports, and location-derived exposure: user-root Recipes are tools; packaged or ad hoc Recipes are components.
- `Guidance`: Updated README, docs, skills, prompts, project context, and future-only backlog around hardened Runs, rooms, Inspector controls, Recipe identity and exposure, shell boundaries, and reusable packaged multi-agent pipelines.

## 0.17.1: Inspector Hotfix And Room Swarm Hardening

- `TUI`: Made Inspector width calculations wide-character-safe, replaced verbose previews with a hidden-by-default numbered table, defaulted the toggle to 12 rows, allowed live row-count changes, and added aligned full-property detail through `/actors-inspect <number>`.
- `Recipe Library`: Added `pipeline-room-swarm`: participants join one Run room, coordinate for multiple rounds, leave, and synthesize a Markdown transcript. Roles may come from a path; optional locker composition protects artifacts and journals decisions. Direct branch delivery remains available but is not required for peer coordination.
- `Docs`: Returned `BACKLOG.md` to future-only work and refreshed README and project context around room-swarm, coordinator-locker, and Actor Inspector ownership.

## 0.17.0: Actor Rooms And Inspector

- `Actor Messages`: Added same-Run task rooms with append-only timelines, rosters, join and leave, provenance checks, communication snapshots, room status and message views, and Run communication inspection through the existing spawn, message, and Inspect model.
- `TUI`: Added a hidden-by-default Actor Inspector with compact or verbose layouts, current-Run scope, chronological numbering, owner filtering, malformed-JSONL tolerance, mobile and wide-character truncation, and striped rows.
- `Registry`: Added usage and operator-gated cleanup guidance and made exposure location-derived: every `~/.pi/agent/recipes/*.json` file is a tool created by `register_tool`; packaged and ad hoc Recipes remain components. Removed obsolete config and exposure-marker guidance.
- `Docs`: Updated README, messaging, Run, Recipe-library, skill, backlog, and project context for rooms, rosters, Inspector ownership, release hygiene, and future reusable coordinator composition.

## 0.16.4: Recipe Usage Fingerprints

- `Recipe Usage`: Added content fingerprints to user recipe usage metadata. Impact: when a recipe file is edited and its authored meaning changes, the next launch resets `usage.calls`, records `usage.reset_at`, and starts counting usage for the current recipe content.
- `Docs`: Documented fingerprint-backed usage reset semantics in the template recipe and tool registry docs.

## 0.16.3: Recipe Import Path Placeholders

- `Template Recipes`: Added static `{repo}` and `{agent}` expansion for recipe paths, including `imports` and `from` bindings. Impact: recipes can import sibling packaged/user recipes without hard-coded absolute paths while keeping imports load-time deterministic.
- `Docs`: Documented `{repo}` and `{agent}` import path placeholders in the template recipe standard.

## 0.16.2: Recipe Registry Diagnostics Hotfix

- `Schema`: Derived recipe tool arguments without expanding runtime-dependent repeat nodes. Impact: valid recipes using repeat expressions such as `{lenses.length}` can be exposed as tools instead of being skipped during startup schema generation.
- `Runtime`: Replaced the dense semicolon warning with grouped recipe registry diagnostics and explicit spacing. Impact: startup diagnostics are easier to scan and do not visually run into adjacent text.
- `Recipes`: Added a packaged `lens-swarm` recipe that composes the review coordinator without concrete model-version defaults. Impact: the standard library includes the general multi-lens review launcher instead of relying only on operator-local copies.

## 0.16.1: Recipe Registry Hotfix

- `Runtime`: Prevented invalid user recipe files from aborting extension startup when tool-schema generation fails, surfacing a warning and skipping the offending tool instead. Impact: one bad recipe in `~/.pi/agent/recipes` no longer takes down the pi-actors extension.
- `Recipe Discovery`: Excluded the legacy migration report file from recipe discovery. Impact: legacy migration reports no longer appear as broken recipe/tool candidates after migration.

## 0.16.0: File-Discovered Recipe Registry Migration

- `Registry Migration`: Replaced the legacy live registry with validated Recipe files, filename identity, location-based exposure, priority overrides, disable semantics, migration reporting, inspection, and usage-informed cleanup.
- `Discovery`: Added flat root scanning with filename ids, invalid high-priority blocking, disabled overrides, and precedence from packaged standard library to ad hoc selections to `~/.pi/agent/recipes`. Only the user root exposes tools by default.
- `Legacy Import`: Converted legacy entries to user Recipe files while preserving descriptions, args, defaults, and templates; existing files are never overwritten, reports capture conflicts, and the source archives only after a clean migration.
- `Runtime`: Session start now migrates, discovers, and registers active exposed Recipes. `register_tool` writes, updates, or deletes user Recipe files and activates the resulting tool in the current session.
- `Live Reload`: Added debounced Recipe-root watching and tool fingerprints so valid changes refresh without restart, unchanged definitions avoid churn, deleted Recipes deactivate, and first-time or recreated roots reconnect.
- `Usage and Inspect`: Tracked user Recipe calls and last-use time while keeping packaged Recipes immutable, and added `inspect target=recipes view=status|summary` for active, shadowed, invalid, disabled, and diagnostic entries.
- `Guidance`: Reworked README, registry and Recipe docs, prompts, and the Actors skill around Recipe files as persistent capability memory, same-name priority, sticky-tool trade-offs, and explicit operator cleanup rather than automatic deletion.
- `Context`: Standardized snake_case examples and package imagery, closed the 0.16 release backlog, and moved non-blocking curation, host-unregistration, discovery, telemetry, and library ideas to future work.

## 0.15.0: Packaged Actors Skill And Actor Vocabulary Cleanup

- `Skills`: Reworked the packaged Actors skill into a dense operational reference, bundled the portable Swarm methodology skill, registered and packaged both, linked them from README, and kept formatter-safe metadata plus a clear Recipe-to-Run versus Recipe-to-tool flow.
- `Knowledge Surfaces`: Shortened the injected bootstrap and defined separate roles for prompts, skill metadata and bodies, README, docs, and `AGENTS.md`, keeping session context compact while preserving lookup paths.
- `Actor Vocabulary`: Changed compact message and Inspect output plus public examples toward actor, spawn, message, Inspect, and Run wording while leaving low-level lifecycle details in implementation diagnostics.
- `Recipe Evidence`: Added skill summary evidence to release readiness and an evidence-only `pipeline-release-summary` that creates summaries, risk checklists, and PR drafts without commits, tags, publication, or external release actions.
- `Coordinator Cell`: Added `coordinator-locker` with FIFO work queue, renewable resource leases, journal, coordinator messages, and snapshot inspection; packaged asynchronous Recipes now advertise stop, cancel, and kill consistently.
- `Recipe Policy`: Replaced public message-file inputs with Run ids and removed concrete model defaults and stale aliases, requiring callers to select current model policy while helpers resolve internal storage.
- `Navigation and Boundaries`: Added an Actors Recipe Navigator for every bundled Recipe and removed pi-actors-specific adapters from Swarm, with regressions for skill registration, portable Swarm text, valid links, and complete Recipe coverage.
- `Context`: Returned backlog ownership to current and future work, closed the 0.15 release scope, and retained only future opportunities and the blocked branch-runner experiment.

## 0.14.3: Pipeline Termination Mailbox Consistency

- `Recipe Library`: Added `control.cancel` and `control.kill` mailbox accepts to packaged async pipeline recipes that previously advertised only `control.stop`. Impact: `inspect view=mailbox` now exposes the full actor-native termination set consistently across high-level pipeline actors.
- `Tests`: Expanded packaged recipe coverage so all async `pipeline-*` recipes must expose `control.stop`, `control.cancel`, and `control.kill`. Impact: future pipeline recipes cannot silently regress to partial termination mailbox contracts.

## 0.14.2: Release Readiness Package Evidence

- `Recipe Library`: Added `utility-package-summary` evidence to `pipeline-release-readiness` between changelog extraction and validation. Impact: release readiness reports can consider package metadata and package contents summary without adding publish automation.
- `Docs`: Updated task-first and recipe-library docs to describe the enriched release-readiness pipeline. Impact: the documented task-first candidate map now matches the implemented recipe composition.

## 0.14.1: Backlog Vocabulary Reconciliation

- `Docs`: Reconciled backlog status text after the message-only inspection release. Impact: project context no longer claims `inspect view=events` is retained and describes operations snapshots as actor-message tails instead of event tails.

## 0.14.0: Message-Only Run Inspection

- `Actor Tools`: Removed `inspect view=events` as a public compatibility alias. Impact: run actor message streams are inspected only with `inspect view=messages`, keeping the public observation vocabulary aligned with actor messages.
- `Docs`: Updated README and async-run/actor-message docs to remove the events inspection view and point operators to `inspect view=messages`. Impact: examples and tool descriptions no longer teach the transitional events alias.

## 0.13.5: Actor Message Snapshot Wording

- `Docs`: Replaced remaining task-first and recipe-library event-tail wording for async-run operations with actor-message tail terminology. Impact: operations guidance now matches the `message_file` recipe surface and `inspect view=messages` actor vocabulary.
- `Utilities`: Updated the `recipe-utils.mjs run-ops-snapshot` usage text from `<event-file>` to `<message-file>`. Impact: helper diagnostics no longer teach the old public noun.

## 0.13.4: Interactive Recipe Termination Contracts

- `Recipe Library`: Added actor-native `control.stop`, `control.cancel`, and `control.kill` mailbox accepts to interactive artifact/message/fanout recipes and the music player recipe. Impact: `inspect view=mailbox` now advertises the run termination messages that the actor runtime supports for these long-lived recipe actors.

## 0.13.3: Actor Vocabulary Cleanup

- `Docs`: Removed remaining public FIFO/outbox phrasing from actor-message/template-recipe docs and runtime prompt guidance. Impact: agent and operator guidance now consistently describes `spawn`, `message`, and `inspect` without transport-specific vocabulary.
- `Recipe Library`: Removed the legacy `event_file` default from async-run operations recipes. Impact: the recipe surface now uses only `message_file` for run actor-message inputs.

## 0.13.2: Async Run Actor Vocabulary Docs

- `Docs`: Reframed `docs/async-runs.md` around actor messages and run-local control channels, keeping file names and transport details in implementation sections. Impact: the async-run standard now separates public `spawn`/`message`/`inspect` behavior from storage/transport mechanics more clearly.

## 0.13.1: Public Actor Vocabulary Docs

- `Docs`: Replaced remaining public README and recipe-library wording that described run coordination as events, FIFO, or outbox paths with actor-message and run-local control-channel terminology. Impact: operator-facing docs now teach the actor vocabulary first while keeping transport details in the async-run implementation reference.

## 0.13.0: Actor-Native Control Surface

- `Actor Messages`: Removed `runtime.cancel` and `runtime.kill` termination aliases from `message to=run:<id>`. Impact: run termination now uses only actor-native `control.stop`, `control.cancel`, and `control.kill`; runtime-prefixed control names are no longer treated as public API.

## 0.12.15: Run Operations Message File Vocabulary

- `Recipe Library`: Renamed async-run operations recipe inputs from `event_file` to `message_file`, with legacy `event_file` retained only as an internal default fallback. Impact: public recipe args align with the actor-message vocabulary while existing value-based launches can still supply the old key.
- `Recipe Utilities`: Renamed `run-ops-snapshot` output from `events` to `messages`. Impact: operations reports now describe run outbox records as actor messages instead of runtime events.

## 0.12.14: Actor Message Inspection Alias

- `Actor Messages`: Added `inspect view=messages` for run actors, with `events` retained as a compatibility alias for the same outbox-backed actor messages. Impact: the public inspection vocabulary now matches the actor/message model while preserving existing event-oriented diagnostics.

## 0.12.13: Structured Run Operations Recommendations

- `Recipe Utilities`: Changed `utility-run-ops-snapshot` recommendations from shell-like suggestion strings to structured `message` and `inspect` call objects. Impact: async-run operations reports now preserve the actor API shape directly and avoid reintroducing command-string parsing into coordinator handoffs.

## 0.12.12: Async Command Summary Hygiene

- `Observability`: Kept async `command.done` summaries bounded while preserving full argv-shaped command details in event payloads. Impact: long prompted fanouts keep diagnostic fidelity without flooding coordinator follow-ups with huge command lines.

## 0.12.11: Recipe Import Diagnostics Hotfix

- `Template Recipes`: Added regression coverage proving imported recipe nodes execute correctly under a repeated parallel parent (`imports` + `repeat` + object `template`). Impact: the suspected composition blocker is now guarded as supported behavior instead of relying on manual smoke interpretation.
- `Observability`: Expanded command details in foreground execution results and async `command.start`/`command.done` events from executable-only labels to full argv-shaped launch strings. Impact: failed fanout branches no longer appear as misleading `pi && pi && ...` summaries when the real command was `pi -p --model ...` with a long prompt.
- `Spawn`: Allowed the public `spawn` schema to accept inline object command-template configs, not only strings and arrays. Impact: agents can launch object-form templates with `parallel`, `repeat`, `failure`, and nested `template` directly through `spawn` as documented.

## 0.12.10: Actor Ownership and Recipe Operations

- `Run Control`: Added actor-native `control.stop`, `control.cancel`, and `control.kill` termination while retaining runtime cancel and kill aliases.
- `Tool Inspect`: Added `inspect target=tool:<name>` for registered tool status and schema contracts alongside `message to=tool:<name>` invocation.
- `Artifact Bundle`: Added a task-first pipeline for optional validation, deterministic artifact and manifest writes, machine-readable metadata, and actor-message handoff.
- `Subagent Policy`: Aligned prompt and tool subagent Recipes on common model, thinking, tools, and output-format controls.
- `Run Operations`: Added one structured snapshot of Run summaries, event tails, and stale or terminal recommendations for operations reports without executing suggested Inspect or stop actions.
- `Coordinator Inspect`: Added current-session coordinator inventory and required an explicit current coordinator context rather than falling back to all Runs.
- `Session Messages`: Added Run-owned `message to=session:<id>` follow-ups and rejected unowned or cross-session senders.
- `Ownership`: Applied coordinator-session ownership checks to addressed Run, branch, coordinator, and direct Run Inspect routes so cross-session state fails closed.

## 0.12.9: Actor Runtime Hotfix

- `Async Runs`: Protected the `runs` state root from session-start temp pruning, tightened live-run status around owned runner processes, and kept non-Linux FIFO control usable without `/proc`-only checks. Impact: long-lived actors are less likely to disappear or be misclassified during startup and stale PID reuse is reduced on Linux.
- `Actor Messages`: Preserved coordinator-bound actor message `body` and `metadata` through outbox parsing and follow-up formatting, with bounded body previews. Impact: checkpoint and decision messages reach the coordinator with the useful payload instead of only the summary line.
- `Observability`: Reduced generic `command.done` follow-up noise by keeping successful final leaf completions diagnostic while still bubbling failures and in-flight parallel branch completions. Impact: long sequential pipelines no longer flood the launching coordinator with low-value leaf-completion messages.
- `Output`: Moved truncated full-output files under `~/.pi/agent/tmp/pi-actors/outputs`. Impact: oversized tool output now follows the extension temp-directory contract instead of using system temp.

## 0.12.8: Usage Hint Documentation

- `Docs`: Documented runtime actor-tool argument usage hints in README and tool-registry docs, and covered missing template-value hints separately from typed value errors. Impact: users and agents can discover the self-correction behavior without reading tests.

## 0.12.7: Tool Argument Usage Hints

- `Tools`: Added compact usage hints to runtime actor-tool argument errors when typed normalization or placeholder resolution fails. Impact: if an agent supplies a wrong enum/type value or misses a required template value after schema validation, the error now shows the expected call shape with required and optional fields.

## 0.12.6: Documentation Example Alignment

- `Docs`: Replaced remaining shader-ring recipe examples in registry and template-recipe docs with the concrete docs-review actor recipe example, aligned test fixtures, and changed async-run outbox docs to show actor message envelopes without public delivery knobs. Impact: public docs now consistently demonstrate useful actor wrapping and keep coordinator attention policy out of recipe-authored message examples.

## 0.12.5: README Actor Recipe Example

- `Docs`: Replaced the placeholder shader-ring onboarding recipe with a concrete async docs-review actor recipe that includes typed args, mailbox metadata, and a real launch template. Impact: README onboarding now demonstrates actor wrapping instead of an abstract placeholder.

## 0.12.4: Actor Runtime Positioning

- `Docs`: Reframed README and package metadata around `pi-actors` as an actor runtime and orchestrator for agent-managed local processes, while preserving the persistent actor-tool registry as one capability. Impact: new readers see how templates, recipes, mailboxes, messages, artifacts, and run state turn any trusted local process into an agent-controllable actor.

## 0.12.3: Package Metadata Hygiene

- `Package`: Normalized npm repository metadata to the canonical `git+https://` URL form. Impact: npm publish no longer needs to auto-correct package metadata.

## 0.12.2: Registry Migration Notes

## 0.12.1: Actor Tool Registry Name

## 0.12.0: Rename to pi-actors

- `Rename`: Renamed the package and current public surface from `@llblab/pi-auto-tools` / `pi-auto-tools` to `@llblab/pi-actors` / `pi-actors`, moved the persistent registry filename from `auto-tools.json` to `tools.json`, and moved runtime state defaults from `~/.pi/agent/tmp/pi-auto-tools` to `~/.pi/agent/tmp/pi-actors`. Impact: the package name now matches the actor API model introduced in 0.10-0.11, while the durable registry becomes the generic pi agent tools config.

## 0.11.0: Actor API Compression

- `Tool Messages`: Added `tool:<name>` routing so executable Pi tools use the same addressed actor envelope as Runs, branches, and coordinators.
- `Deterministic Envelopes`: Added validated `utility-actor-message`, aligned `subagent-message` public fields, and migrated artifact pipelines from prompted JSON to deterministic envelope construction with correlation and reply metadata.
- `Vocabulary`: Updated README, Run, component, command-template, prompt, and music-player guidance to prefer actor `message`, `spawn`, and `inspect` coordination.
- `Surface Compression`: Removed Recipe-level event delivery policy and knobs, public envelope delivery, duplicate event aliases, the public `async_run` registration, and music-player event delivery so mailbox remains the single Recipe message contract and runtime owns attention.
- `Domain Ownership`: Split generic atomic JSON persistence from registry configuration so Run state no longer depends on the registry-config domain.
- `Recipe Library`: Added required mailbox metadata to every asynchronous packaged Recipe, exposing control, completion, artifact, and domain-result contracts through mailbox inspection.

## 0.10.0: Actor Orchestration and Artifact Pipelines

- `Actor Protocol`: Introduced pure address and envelope normalization plus Recipe mailbox metadata for one actor-message model.
- `Public Tools`: Added `spawn`, `message`, and `inspect` adapters for `run:<id>` actors over asynchronous start, send, status, tail, events, artifacts, and files.
- `Routing`: Routed coordinator messages through Run outboxes and branch messages through parent Run mailboxes, with route-aware defaults and actor fields on command and music-player events.
- `Mailbox Inspect`: Persisted mailbox declarations in Run metadata, validated and summarized them, added `inspect view=mailbox`, and covered mailbox preservation across checkpoint, follow-up, event, and artifact Recipes.
- `Artifact Flow`: Clarified prepared versus written reports, added deterministic `utility-artifact-write`, and shipped an opt-in write pipeline proven by `artifact-write-smoke-010`.
- `Inspection and Metadata`: Added session Run-status inspection and spawn state or artifact metadata while centering docs and prompts on spawn, message, and Inspect rather than transport details.

## 0.9.0: Async Observability Polish

- `Async Observability`: Ambient triangles now reflect active parallel branches inside a running async recipe, while still showing at least one triangle per active run. Impact: multi-agent fanout such as one run with three parallel subagents is visible as three active triangles instead of one.
- `Async Observability`: Terminal done and failed states send compact Markdown follow-ups with compressed artifact and Run paths to the launching coordinator, while intentional cancel, kill, and control-stop remain synchronous. Guidance pairs upward outbox or follow-up events with explicit downward send commands, avoiding path noise, duplicate stop notices, and sleep-poll loops.
- `Async Observability`: The generic async runner now emits `command.done` outbox events for leaf commands, with explicit recipe-level `events.command.done.delivery` controlling whether branch completions are stored, notified, or sent as follow-up context; packaged multi-agent fanout recipes default branch completion to `followup`. Impact: parallel subtask completion bubbles through the run outbox for multi-agent recipes without hardcoding transport calls or relying on hidden reserved args.
- `Template Recipes`: Added recipe-level named `artifacts` for ordered artifact manifests, distinct from command-template `output` and default stdout. Impact: async completion and bubbled subtask events can report stable paths such as `report` and `summary`, including placeholder-derived artifact paths.

## 0.8.0: Semantic Recipe API

- `Semantic API`: Reframed Recipes around `async`, `parallel`, `when`, typed args, and imports rather than CLI fragments or historical node shapes.
- `Parallel`: Replaced `mode: "parallel"` with `parallel: true`; true multi-value policy modes remain enums, and the unused JSONL-tail mode was removed.
- `Placeholders`: Added nullish `{name??fallback}` and ternary `{name?truthy:falsy}` selection, enabling semantic booleans and optional CLI expansion without exposing raw flag fragments.
- `Node Policy`: Allowed timeout, delay, and retry fields to resolve placeholders so public inputs can configure execution bounds without sharing internal field names.
- `Conditional Execution`: Added node-level `when` guards; skipped sequence nodes preserve stdin flow.
- `Component Recipes`: Replaced raw tool CLI fragments with semantic `tools` policy mapped through ternary placeholders.
- `Failure and Timeout`: Removed the `critical` alias in favor of `failure: "root"` and changed validation wrapper input from generic timeout to typed `timeout_ms`.
- `Docs`: Documented command templates, saved Recipes, and asynchronous Runs as separate ownership layers with explicit non-goals.

## 0.7.1: Recipe Library Hotfix

- `Component Recipes`: Defined a weak compositional contract and added review, verification, merge, quorum, critic, judge, planning, evidence, contradiction, task, conflict, checkpoint, follow-up, normalization, artifact, and event atoms without introducing a swarm DSL.
- `Pipelines`: Composed review, architecture, research, checkpoint, development, artifact, release-readiness, repository-health, Run-operations, docs-maintenance, and media-library workflows from reusable cells with policy knobs.
- `Recipe Standard Library`: Promoted packaged Recipes to root `recipes`, kept one Node music-player helper, and removed the parallel shell variant so maintained components are a first-class library rather than experiments.
- `Utilities`: Added index, event-tail, validation, Run-file, changelog, playlist, git, artifact-manifest, Run-summary, and package-summary utilities backed by a small shared helper instead of opaque command strings.
- `Task-first Design`: Documented deriving high-level Recipes from operator tasks before filling missing atoms, balancing top-down workflows with reusable component growth.
- `Composition`: Allowed Recipe-envelope sequences and nested object templates to execute imported Recipe nodes, including repeated parallel fanout through verifier, merger, judge, and normalizer stages.
- `Validation`: Added a script and utility to validate one saved Recipe or a directory through the same Recipe and Run layer used by other workflows.
- `Async Observability`: Replaced fast notification polling with Run-state watcher events, suppressed handled terminal duplicates, and counted unfinished Runs rather than internal branches in ambient status.

## 0.7.0: Command Template Checkpoints

- `Checkpoints`: Added continue, branch, or root failure propagation; retries for leaf, sequence, and parallel nodes; fail-closed recovery between attempts; and Recipe-envelope checkpoint flags. Default timeout became unbounded unless explicitly positive.
- `Typed Fanout`: Added array args, indexed placeholders, repeat from array length, and recursive default resolution so one Recipe can derive bounded parallel subagent branches from caller values.
- `Recipe and Run API`: Separated saved Recipes from detached execution with name and `async: true`, renamed job concepts to Recipe and Run, moved user Recipes and runtime state to dedicated roots, and rejected stale launcher fields instead of silently adapting them.
- `Lifecycle`: Added compact default Run management output, verbose diagnostics, source metadata, status filtering, ambient activity counts, process-group cancel or kill with PID fallback, explicit cancelled or killed states, and quiet successful or intentional terminal behavior.
- `Control and Events`: Added newline-delimited FIFO control plus script-authored outbox events with inspection and optional coordinator notification or follow-up, without introducing a scheduler or second execution language.
- `Imports`: Added cycle-checked Recipe imports, alias nodes, default and value references, fallbacks, ternaries, and typed imported templates while keeping command-template core independent of registry and lifecycle state.
- `Examples`: Added controllable shell and Node music players with typed source and command inputs, direct controls, track events, and playlist expansion, plus no-tools, tool-allowlisted, and repeated parallel subagent Recipes.
- `Safety and Guidance`: Added high-risk template warnings, split docs by command, Recipe, Run, registry, and experiments, documented branch-adapter and degraded-success boundaries, removed stale internal research, and taught the local-first Recipe and Run model in onboarding.

## 0.6.1: Pi SDK Scope Hotfix

- `Packaging`: Migrated the pi SDK peer dependency and extension type imports from the legacy `@mariozechner/pi-coding-agent` scope to `@earendil-works/pi-coding-agent`. Impact: package metadata matches the current Endrilla/Earendil pi package namespace.

## 0.6.0

- `Typed Args`: Added progressive typed command-template argument declarations for `string`, `path`, `int`, `number`, `bool`, and `enum(...)` compact forms in both `args` and inline template placeholders. Impact: registered tools can expose narrower generated schemas and validate/normalize runtime values without requiring JSON Schema authoring or separate `args` metadata for simple templates.
- `Compatibility`: Kept existing untyped `args` and shorthand defaults fully compatible while normalizing typed shorthand such as `timeout:int=60000` into canonical stored declarations plus `defaults`. Impact: existing `auto-tools.json` entries continue to load unchanged.
- `Docs`: Documented typed args in the command-template standard, tool registry guide, README, and backlog state, including metadata-first and inline-first authoring styles. Impact: operators can adopt typed declarations incrementally while choosing the most readable shape for each tool.

## 0.5.6: Coordinator-Scoped Job Notifications Hotfix

- `Job Observability`: Scoped async job ambient status and terminal follow-up context to the agent session that started the job. Impact: multiple pi agents sharing the same job state root can run independent async jobs without receiving each other's completion messages or sub-agent indicators, while explicit `status`/`tail` inspection by job id remains available.
- `Template Jobs`: Added `template_job action=kill` as a forceful `SIGKILL` escape hatch for stuck owned job runners, with the same cwd/runner ownership checks as graceful `cancel`. Impact: operators can recover from unresponsive detached jobs without unsafe broad process killing.
- `Release`: Added a tag-triggered GitHub Actions release workflow that verifies the `vX.Y.Z` tag matches `package.json`, extracts the matching `CHANGELOG.md` section, and publishes a GitHub Release automatically.
- `Backlog`: Clarified that typed command-template argument declarations must be progressive: current untyped `args` declarations continue to work unchanged while typed forms are added.

## 0.5.5

- `Template Job Shape`: Allowed job recipe files to place command-template node flags such as `mode`, `timeout`, `retry`, `critical`, `args`, and `defaults` at the job top level beside `job`. Impact: parallel jobs can use the compact shape `{ "job": "name", "mode": "parallel", "template": [...] }` without an unnecessary nested template wrapper.
- `Template Job Defaults`: Clarified that `state_dir` is optional and defaults to the extension job-state directory derived from the job id. Impact: recipe files only need `job` and `template` unless they intentionally override state placement.
- `Command Template Repeat`: Added `repeat` expansion with zero-based `{index}`, wrapped zero-based `{prev}`/`{next}`, `{repeat}`, underscore-padded forms such as `{_index}`, and limited arithmetic expressions such as `{_(index+1)}`. Impact: repeated parallel or sequence templates can be written once instead of copy-pasting near-identical branches while keeping human numbering explicit.

## 0.5.4

- `Co-located Job Recipes`: Allowed registered tool entries to include job envelope fields directly when they also define `template`. Impact: operators can keep small or local job recipes in `auto-tools.json` without introducing `job.tool` cycles or a separate recipe file.
- `Job Recipe Args`: Derived tool args from available file-backed and co-located job recipe templates when `args` is omitted. Impact: job recipes keep the same optional `args`/`defaults` behavior as command templates while explicit `args` remains an override.
- `Docs`: Split the synchronous Command Template Standard from the async Template Job Standard. Impact: command templates remain portable and backwards-compatible across extensions, while jobs are documented as an optional async extension.

## 0.5.3

- `Job Recipe References`: Replaced registered-tool `job` bindings with `template` job recipe references. Impact: the registry has one executable binding field, job files must own a `template`, and job recipes can no longer point back to tools.
- `Runtime Boundary`: Enforced the `tool → template → job → template` graph across runtime, docs, and tests. Impact: jobs stay lightweight async envelopes, cyclic shortcuts such as `tool.job` and `job.tool` are rejected, and job recipe tools keep their public args explicit.

## 0.5.2

- `Job Launch Tools`: Added job-backed registered tools. A tool may now define `job` instead of `template`; calling it starts the named template-job recipe asynchronously and returns job metadata. Impact: heavyweight agent fanout can keep `template(mode: "parallel")` inside `~/.pi/agent/jobs/*.json` while exposing a compact callable tool.
- `Docs`: Documented the `tool → job recipe → template(mode: "parallel")` model across README and adapter docs. Added compact operator onboarding and the `task` vs `template` vs `job` distinction. Impact: job recipes can become the source of truth for async agent scenarios instead of duplicating large templates in tool definitions, and new operators get the job mental model without reading every subsystem note.

## 0.5.1

- `Job Observability`: Made detached job status triangles use runner-reported active command counts across all running jobs instead of only process-tree probing. Impact: async parallel jobs keep stable per-sub-agent indicators while work is active, with the animation wave moving across the current aggregate set.
- `Docs`: Clarified that template jobs own async lifecycle and ambient sub-agent visibility, while command templates still own sequence and parallel execution shape. Impact: agentic fanout should use `job(template(mode: "parallel"))` instead of blocking foreground orchestration.

## 0.5.0

- `Command Templates`: Added sequential or parallel object nodes, stable flag-first serialization, soft-quorum branch labels and coverage, and per-node launch delay without a scheduler or second workflow language.
- `Template Jobs`: Added one detached lifecycle tool for start, status, tail, list, and cancel from a job file, inline template, or registered tool, using durable state, logs, a thin runner, stale-state guards, and session-start pruning.
- `Observability`: Added compact completion events and ambient active-subagent status while removing persistent prompt widgets and historical counters.
- `Standard`: Folded job and temporary-directory primitives into the self-contained command-template standard, leaving job-primitives documentation as the local adapter note.
- `Job Library`: Added reusable user job files while leaving model and tool choices as local policy rather than shipping operator-specific Recipes.
- `Registry`: Made no-argument `register_tool` list registered tools and made every successful list, create, update, or delete refresh current-session activation.
- `Validation`: Added `npm run validate` for TypeScript, extension import, tests, and package dry-run.
- `Docs`: Reworked README and job guidance around command, command template, registered tool, and template job without implying scheduler semantics.

## 0.4.0

- `Command Templates`: Prepared the 0.4.0 runtime profile for the current portable command-template contract: default 30s command timeout, per-step retry propagation, fail-open composition for non-critical failures, and `critical: true` abort semantics. Impact: registered auto-tools now follow the portable command-template runtime profile.
- `Docs`: Cleaned the backlog and synchronized README plus command-template docs with the strengthened 0.4.0 contract. Impact: release notes, open work, and user-facing runtime semantics now describe the same behavior.

## 0.3.0

- `Architecture`: Renamed the command-template domain from `lib/templates.ts` to `lib/command-templates.ts` and moved auto-tools-specific arg/schema helpers into `lib/schema.ts`. Impact: the portable standard stays copyable while registry-specific schema derivation remains local.
- `Command Templates`: Adopted the shared standard for string shorthand, inline defaults, derived args, missing-value errors, relative executables, sequences, direct stdin, and timeout escalation. Runtime now follows the portable regression surface, accepts compact persisted entries without redundant metadata, and runs multi-step template-backed tools.
- `Registry`: Canonical persisted object entries now omit redundant `name` and `label`; object keys supply tool names, and runtime labels derive from tool names. Impact: `auto-tools.json` follows the command-template standard more closely while legacy `name`/`label` fields are accepted and normalized away.
- `Docs`: Harmonized the portable command-template standard wording, using `template`/`args`/`defaults`, command-arg terminology, and `{file}` as the canonical local file path arg. Impact: the docs describe the integration contract without `argv`, `command`, or `{filename}` ambiguity.

## 0.2.1

- `Docs`: Split command-template documentation into a portable standard core (`docs/command-templates.md`) and local registry adaptation (`docs/tool-registry.md`). Impact: the shared command-template contract can be copied across extensions without coupling their internals, while `pi-auto-tools` keeps its registry storage shape documented separately.

## 0.2.0

- `Breaking Registry`: Replaced script-backed persistent tools with template-backed command registration. Tools now store `template`, named `args`, and optional `defaults`; legacy stored `script` entries are rejected with explicit migration guidance.
- `Command Templates`: Standardized split-first invocation: templates are split into shell-like argv tokens before placeholder substitution, then executed through `pi.exec` without shell evaluation. Placeholder values containing spaces remain single argv values.
- `Register Tool`: Updated `register_tool` to create, update, and delete template-backed tools, preserve existing templates on metadata/default updates, block reserved/external conflicts, persist atomically, and register tools immediately for the active session.
- `Runtime Output`: Preserved bounded context output for registered tools: stdout is formatted for the agent, large outputs are tail-truncated, full output is saved to temp files, and command failures include useful stderr/stdout sections.
- `Architecture`: Refactored the extension into a flat `/lib` Domain DAG with `index.ts` as a small namespace-domain composition root. Core domains now cover templates, args/identity, config, registry mutations, runtime coordination, tool definitions, output, prompts, paths, and execution.
- `Packaging & Validation`: Removed the runtime `typebox` dependency from schema assembly, made `npm run check` import the extension entrypoint, added focused domain and architecture-guard tests, and verified package contents with dry-run packing plus live post-reload smoke.
- `Docs`: Added command-template documentation as a portable standard, condensed README into a feature/usage format, documented skill-script and sub-agent registration examples alongside their resulting `auto-tools.json` state, documented `{file}` as the canonical local file path placeholder, and reset `BACKLOG.md` after all open work reached validated stop conditions.

## 0.1.1

- `Registry`: Shipped the script-backed persistent tool registry. Impact: pi can register, update, delete, persist, and auto-load trusted local script tools from `~/.pi/agent/auto-tools.json`.
