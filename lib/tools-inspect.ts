/**
 * Public inspect tool behavior.
 * Zones: Run Recipe/Trace/Control views and runtime/recipe/tool diagnostics
 * Owns exact inspect target/view dispatch; source projection stays in domain modules.
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import * as AsyncRuns from "./async-runs.ts";
import * as ControlProjection from "./control-projection.ts";
import * as Inspector from "./inspector.ts";
import * as Limits from "./limits.ts";
import { computeRunControlCapacity } from "./run-evidence-policy.ts";
import * as Paths from "./paths.ts";
import type * as RecipeResolution from "./recipes-context.ts";
import * as RecipesDiscovery from "./recipes-discovery.ts";
import * as RecipesReferences from "./recipes-references.ts";
import * as ReviewDiagnostics from "./review-diagnostics.ts";
import * as RunsControls from "./runs-controls.ts";
import * as RunControlDelivery from "./runs-control-delivery.ts";
import * as RunsTrace from "./runs-trace.ts";
import * as Runtime from "./runtime.ts";
import * as RuntimeIdentity from "./runtime-identity.ts";
import * as RuntimeTriage from "./runtime-triage.ts";
import * as Schema from "./schema.ts";
import * as ToolsAccess from "./tools-access.ts";
import * as ToolsResponse from "./tools-response.ts";
import * as TraceProjection from "./trace-projection.ts";

const asRecord = ToolsResponse.asRecord;
const maybeJsonText = ToolsResponse.maybeJsonText;

export interface InspectToolDeps<TContext = unknown> {
  getRunStatus?: (runOrDir: string) => Record<string, any>;
  getTool?: (name: string) => any | undefined;
  getToolStatus?: (name: string) => Record<string, unknown> | undefined;
  listRuns?: () => Array<Record<string, any>>;
  recipeRoot?: string;
  registryStatus?: () => Runtime.RecipeRegistryStatus;
}

function runtimeStatus(): Record<string, unknown> {
  return {
    automatic_review: Paths.isAutomaticRecipeReviewEnabled(),
    run_root: Paths.getRunStateRoot(),
    state_schema: RuntimeIdentity.RUN_STATE_SCHEMA,
    version: RuntimeIdentity.getPackageVersion(),
  };
}

function runtimeRuns(
  ctx: unknown,
  deps: InspectToolDeps,
  status: string | undefined,
): Record<string, unknown> {
  const session = ToolsAccess.requireContextSessionId(ctx, "runtime Run inventory");
  const listed = deps.listRuns
    ? deps.listRuns()
    : AsyncRuns.listRuns(undefined, status);
  const runs = listed
    .map((run) => {
      try {
        return deps.getRunStatus
          ? deps.getRunStatus(String(run.state_dir ?? run.run))
          : AsyncRuns.getRunStatus(String(run.state_dir ?? run.run));
      } catch {
        return run;
      }
    })
    .filter((run) => run.ownerId === session);
  return { owner_session: session, runs };
}

function runtimeTriage(
  ctx: unknown,
  deps: InspectToolDeps,
): Record<string, unknown> {
  const inventory = runtimeRuns(ctx, deps, undefined);
  const runs = inventory.runs as Array<Record<string, unknown>>;
  const failed = runs.filter((run) => run.status === "failed");
  const pendingControls: RuntimeTriage.RuntimePendingControl[] = [];
  const staleControls: RuntimeTriage.RuntimePendingControl[] = [];
  const backpressuredRuns: Array<Record<string, unknown>> = [];
  const controlDiagnostics: Array<Record<string, unknown>> = [];
  const traceDiagnostics: Array<Record<string, unknown>> = [];
  const nowMs = Date.now();
  for (const run of runs) {
    const stateDir = typeof run.state_dir === "string" ? run.state_dir : undefined;
    if (!stateDir) continue;
    const runId = String(run.run ?? "unknown");
    const journal = RunsControls.readRunControlJournalFromStateDir(stateDir);
    const capacity = computeRunControlCapacity(journal.records);
    controlDiagnostics.push(...journal.diagnostics.map((diagnostic) => ({
      ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
      reason: diagnostic.line === undefined ? "unreadable_control_journal" : "invalid_control_json", run: runId,
    })));
    if (capacity.backpressured) backpressuredRuns.push({
      run: runId, pending: capacity.pending, pending_limit: capacity.limit,
      journal_bytes: statSync(RunsControls.runControlsFile(stateDir)).size,
    });
    const traceSummary = RunsTrace.summarizeRunTraceJournal(RunsTrace.readRunTraceJournal(stateDir));
    if (!traceSummary.history_complete) traceDiagnostics.push({ run: runId, ...traceSummary });
    for (const control of journal.records) {
      const classified = RuntimeTriage.classifyRuntimeControl(
        {
          run: runId,
          ...(typeof run.run_instance_id === "string"
            ? { runInstanceId: run.run_instance_id }
            : {}),
          status: String(run.status ?? "unknown"),
        },
        control,
        nowMs,
      );
      if (classified.pending) pendingControls.push(classified.pending);
      if (classified.stale) staleControls.push(classified.stale);
      if (classified.diagnostic) controlDiagnostics.push({ ...classified.diagnostic });
    }
  }
  const attentionEvents = runs.flatMap((run) => {
    const stateDir = typeof run.state_dir === "string" ? run.state_dir : undefined;
    if (!stateDir) return [];
    return RunsTrace.readRunTraceEvents(stateDir)
      .filter((event) =>
      event.attention === "notify" ||
      event.attention === "followup" ||
      event.attention === "steer")
      .map((event) => ({
        run: run.run,
        id: event.id,
        kind: event.kind,
        attention: event.attention,
        summary: event.summary,
        ts: event.ts,
      }));
  });
  const boundedStaleControls = staleControls.slice(0, 40);
  const staleKeys = new Set(boundedStaleControls.map((control) =>
    `${control.run}\0${control.run_instance_id}\0${control.id}`,
  ));
  const boundedPendingControls = [
    ...boundedStaleControls,
    ...pendingControls.filter((control) =>
      !staleKeys.has(`${control.run}\0${control.run_instance_id}\0${control.id}`),
    ),
  ].slice(0, 40);
  return {
    ...inventory,
    failed_runs: failed,
    pending_control_count: pendingControls.length,
    pending_controls: boundedPendingControls,
    stale_control_count: staleControls.length,
    stale_controls: boundedStaleControls,
    backpressured_run_count: backpressuredRuns.length, backpressured_runs: backpressuredRuns.slice(0, 40),
    control_diagnostic_count: controlDiagnostics.length, control_diagnostics: controlDiagnostics.slice(0, 40),
    trace_diagnostic_count: traceDiagnostics.length, trace_diagnostics: traceDiagnostics.slice(0, 40),
    attention_events: attentionEvents.slice(-40).reverse(),
    next_actions: [
      ...(failed.length ? ["inspect target=runtime view=runs status=failed"] : []),
      ...new Set([...staleControls, ...backpressuredRuns].slice(0, 3).map((entry) =>
        `inspect target=run:${entry.run} view=control`,
      )),
      ...(attentionEvents.length
        ? attentionEvents.slice(-3).map((entry) =>
            `inspect target=run:${String(entry.run)} view=trace source=runtime`,
          )
        : []),
    ],
  };
}

function compactRuntime(view: string, details: Record<string, unknown>): string {
  if (view === "runs") {
    return `\nruntime runs=${(details.runs as unknown[] | undefined)?.length ?? 0}`;
  }
  if (view === "triage") {
    return `\nruntime failed=${(details.failed_runs as unknown[] | undefined)?.length ?? 0} pending_controls=${Number(details.pending_control_count ?? 0)} stale_controls=${Number(details.stale_control_count ?? 0)} backpressured=${Number(details.backpressured_run_count ?? 0)} incomplete_trace=${Number(details.trace_diagnostic_count ?? 0)} attention=${(details.attention_events as unknown[] | undefined)?.length ?? 0}`;
  }
  return `\nruntime version=${String(details.version)} state_schema=${String(details.state_schema)} automatic_review=${String(details.automatic_review)}`;
}

function inspectRuntime(
  view: string,
  input: Record<string, unknown>,
  ctx: unknown,
  deps: InspectToolDeps,
): Record<string, unknown> {
  if (view === "status") return runtimeStatus();
  if (view === "runs") {
    return runtimeRuns(
      ctx,
      deps,
      typeof input.status === "string" ? input.status : undefined,
    );
  }
  if (view === "triage") return runtimeTriage(ctx, deps);
  throw new Error("inspect runtime supports view=status, view=runs, or view=triage.");
}

function portableSkillRecipePath(
  file: string,
  skill: string,
  namespaces: Record<string, string[]>,
): string {
  const root = namespaces[skill]?.[0];
  if (!root) return `<active-skill:${skill}>`;
  const relation = relative(root, file);
  return !relation.startsWith("..") && !isAbsolute(relation)
    ? `<active-skill:${skill}>/${relation.replaceAll("\\", "/")}`
    : `<active-skill:${skill}>`;
}

function portableSkillRecipeDiagnosticReason(
  diagnostic: RecipesReferences.SkillRecipeComponentDiagnostic,
  namespaces: Record<string, string[]>,
): string {
  let reason = diagnostic.reason;
  if (diagnostic.file) {
    reason = reason.replaceAll(
      diagnostic.file,
      portableSkillRecipePath(
        diagnostic.file,
        diagnostic.skill,
        namespaces,
      ),
    );
  }
  for (const root of namespaces[diagnostic.skill] ?? []) {
    reason = reason.replaceAll(root, `<active-skill:${diagnostic.skill}>`);
  }
  return reason;
}

function inspectRecipeIdentity(
  identity: string,
  resolutionContext: RecipeResolution.RecipeResolutionContext | undefined,
  namespaces: Record<string, string[]>,
  inventory: RecipesReferences.SkillRecipeComponentInventory,
  registryStatus: Runtime.RecipeRegistryStatus | undefined,
): Record<string, unknown> {
  const match = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/u.exec(identity);
  const skill = match?.[1] ?? "";
  const roots = skill ? namespaces[skill] ?? [] : [];
  const skillActive = roots.length === 1;
  const matchingComponent = inventory.components.find(
    (component) => component.identity === identity,
  );
  const matchingRejection = inventory.rejected.find(
    (diagnostic) =>
      diagnostic.skill === skill &&
      (diagnostic.stem === undefined || diagnostic.stem === match?.[2]),
  );
  let sourceLocation: string | undefined;
  let rejectedReason: string | undefined;
  let resolvable = false;
  if (!match) {
    rejectedReason =
      "Identity must use canonical <skill>/<recipe> syntax.";
  } else if (roots.length === 0) {
    rejectedReason = `Active Skill Recipe not found: ${identity}`;
  } else if (roots.length > 1) {
    rejectedReason = matchingRejection
      ? portableSkillRecipeDiagnosticReason(matchingRejection, namespaces)
      : `Duplicate active Skill identity ${skill}`;
  } else if (matchingRejection) {
    rejectedReason = portableSkillRecipeDiagnosticReason(
      matchingRejection,
      namespaces,
    );
    if (matchingRejection.file) {
      sourceLocation = portableSkillRecipePath(
        matchingRejection.file,
        skill,
        namespaces,
      );
    }
  } else {
    try {
      const file = RecipesReferences.resolveRecipeReferencePath(
        identity,
        resolutionContext?.cwd,
        resolutionContext?.activeSkills,
      );
      if (!file || !existsSync(file)) {
        rejectedReason = `Skill Recipe component not found: ${identity}`;
      } else {
        sourceLocation = portableSkillRecipePath(file, skill, namespaces);
        const recipe = RecipesReferences.readResolvedRecipeConfig(file, [], {
          skillContext: resolutionContext?.activeSkills,
        });
        if (recipe) resolvable = true;
        else {
          rejectedReason =
            RecipesReferences.diagnoseRawRecipeConfigFailure(file) ??
            `Recipe could not be resolved: ${identity}`;
        }
      }
    } catch (error) {
      rejectedReason = error instanceof Error ? error.message : String(error);
    }
  }
  const componentStatus = resolvable
    ? "available"
    : !match
      ? "invalid_identity"
      : roots.length === 0
        ? "skill_inactive"
        : roots.length > 1
          ? "ambiguous_skill"
          : matchingRejection
            ? "rejected"
            : matchingComponent
              ? "unresolvable"
              : "missing";
  return {
    identity,
    skill_active: skillActive,
    resolvable,
    catalog_partial: inventory.partial,
    component_status: componentStatus,
    ...(sourceLocation ? { source_location: sourceLocation } : {}),
    resolution_generation:
      resolutionContext?.generation ?? registryStatus?.resolution_generation ?? "unavailable",
    ...(rejectedReason ? { rejected_reason: rejectedReason } : {}),
    next_actions: resolvable
      ? [
          `spawn recipe=${identity}`,
          `register_tool name=<tool-name> from=${identity}`,
        ]
      : roots.length === 0 && skill
        ? [
            `activate Skill ${skill}`,
            `inspect target=recipes view=doctor identity=${identity}`,
          ]
        : ["inspect target=recipes view=imports verbose=true"],
  };
}

function inspectRecipes(
  view: string,
  input: Record<string, unknown>,
  deps: InspectToolDeps,
  context: unknown,
): Record<string, unknown> {
  if (
    view !== "status" &&
    view !== "summary" &&
    view !== "doctor" &&
    view !== "imports" &&
    view !== "reviews"
  ) {
    throw new Error(
      "inspect recipes supports view=status, view=summary, view=doctor, view=imports, or view=reviews.",
    );
  }
  const recipeRoot = deps.recipeRoot ?? Paths.getRecipeRoot();
  if (view === "reviews") {
    return ReviewDiagnostics.readAutomaticReviewDiagnostics({ recipeRoot });
  }
  const discovered = RecipesDiscovery.discoverRecipeSources([
    { root: recipeRoot, defaultTool: true, mutableUsage: true },
  ]);
  const resolutionContext =
    context && typeof context === "object" && "recipeResolutionContext" in context
      ? (context as {
          recipeResolutionContext?: RecipeResolution.RecipeResolutionContext;
        }).recipeResolutionContext
      : undefined;
  const activeSkillContext =
    resolutionContext?.activeSkills ??
    RecipesReferences.EMPTY_ACTIVE_SKILL_RECIPE_CONTEXT;
  const skillRecipeNamespaces = RecipesReferences.getActiveSkillRecipeNamespaces(
    activeSkillContext,
  );
  const skillInventory =
    RecipesReferences.inventoryActiveSkillRecipeComponents(activeSkillContext);
  const registryStatus = deps.registryStatus?.();
  const identity =
    typeof input.identity === "string" ? input.identity.trim() : "";
  if (identity && view !== "doctor") {
    throw new Error("inspect recipes identity is supported only with view=doctor.");
  }
  if (view === "doctor" && identity) {
    return inspectRecipeIdentity(
      identity,
      resolutionContext,
      skillRecipeNamespaces,
      skillInventory,
      registryStatus,
    );
  }
  const skillRecipeComponents = skillInventory.components.map((component) => ({
    identity: component.identity,
    source_kind: "active_skill_component",
    skill: component.skill,
    stem: component.stem,
    imports: component.imports,
  }));
  const skillRecipeComponentDiagnostics = skillInventory.rejected.map(
    (diagnostic) => ({
      error: portableSkillRecipeDiagnosticReason(
        diagnostic,
        skillRecipeNamespaces,
      ),
      ...(diagnostic.file
        ? {
            file: portableSkillRecipePath(
              diagnostic.file,
              diagnostic.skill,
              skillRecipeNamespaces,
            ),
          }
        : {}),
      skill: diagnostic.skill,
      ...(diagnostic.stem ? { stem: diagnostic.stem } : {}),
    }),
  );
  const discoverySummary = RecipesDiscovery.summarizeDiscovery(discovered);
  const summary = {
    ...discoverySummary,
    ...(registryStatus
      ? {
          ...registryStatus,
          watched_root: "~/.pi/agent/recipes",
        }
      : {}),
    active: Array.isArray(discoverySummary.active)
      ? discoverySummary.active.map((entry) => ({
          ...(entry as Record<string, unknown>),
          source_kind: "user_registry_capability",
        }))
      : discoverySummary.active,
    skill_recipe_components: skillRecipeComponents,
    skill_recipe_component_diagnostics: skillRecipeComponentDiagnostics,
    skill_recipe_catalog_partial: skillInventory.partial,
    active_skill_recipe_identities: Object.keys(skillRecipeNamespaces).sort(),
    skill_recipe_namespace_diagnostics: Object.entries(skillRecipeNamespaces)
      .filter(([, roots]) => roots.length > 1)
      .map(([name]) => ({
        name,
        error: `Ambiguous active Skill Recipe namespace ${name}`,
      })),
    drafts: RecipesDiscovery.listDraftRecipes(join(recipeRoot, "drafts")),
  };
  return {
    ...summary,
    next_actions: ToolsResponse.recipeRegistryNextActions(summary, view),
  };
}

function parseRunTarget(target: string): string | undefined {
  if (!target.startsWith("run:")) return undefined;
  const run = target.slice(4);
  return run && /^[A-Za-z0-9_.-]+$/.test(run) ? run : undefined;
}

function inspectRun(
  run: string,
  view: string,
  input: Record<string, unknown>,
  ctx: unknown,
  deps: InspectToolDeps,
): Record<string, unknown> {
  if (view !== "recipe" && view !== "trace" && view !== "control") {
    throw new Error("inspect run:<id> supports view=recipe, view=trace, or view=control.");
  }
  const status = deps.getRunStatus
    ? ToolsAccess.assertRunStatusAccessibleToContext(
        run,
        deps.getRunStatus(run),
        ctx,
      )
    : ToolsAccess.assertRunAccessibleToContext(run, ctx);
  const stateDir = String(status.state_dir);
  if (view === "recipe") {
    return Inspector.readActorInspectorRecipe(stateDir) as unknown as Record<string, unknown>;
  }
  if (view === "trace") {
    const source = typeof input.source === "string" ? input.source : "all";
    if (
      source !== "all" &&
      source !== "lifecycle" &&
      source !== "control" &&
      source !== "process" &&
      source !== "agent" &&
      source !== "artifact" &&
      source !== "runtime"
    ) {
      throw new Error(`unsupported Trace source: ${source}`);
    }
    return {
      run, source,
      summary: RunsTrace.summarizeRunTraceJournal(RunsTrace.readRunTraceJournal(stateDir)),
      items: TraceProjection.projectRunTrace(stateDir, {
        artifacts: status.artifacts as
          | Record<string, AsyncRuns.RunArtifactDeclaration>
          | undefined,
        limit: Number(input.lines || Limits.DEFAULT_INSPECT_LINES),
        source,
      }),
    };
  }
  const runInstanceId = String(status.run_instance_id ?? "");
  const journal = RunsControls.readRunControlJournalFromStateDir(stateDir);
  const capacity = computeRunControlCapacity(journal.records);
  const structuralDiagnostics = journal.records.flatMap((value) => {
    const classified = RuntimeTriage.classifyRuntimeControl({ run,
      runInstanceId: runInstanceId || undefined, status: String(status.status ?? "unknown") }, value, Date.now());
    return classified.diagnostic ? [classified.diagnostic.reason] : [];
  });
  let journalBytes = 0;
  try { journalBytes = statSync(RunsControls.runControlsFile(stateDir)).size; } catch {}
  const diagnostics = [...journal.diagnostics.map((item) => ({
    ...(item.line === undefined ? {} : { line: item.line }),
    reason: item.line === undefined ? "unreadable_control_journal" : "invalid_control_json",
  })), ...structuralDiagnostics.map((reason) => ({ reason }))].slice(0, 40);
  const nowMs = Date.now();
  const stalePending = journal.records.reduce<number>((count, control) => count + Number(Boolean(
    RuntimeTriage.classifyRuntimeControl({ run, runInstanceId: runInstanceId || undefined,
      status: String(status.status ?? "unknown") }, control, nowMs).stale)), 0);
  return {
    run,
    run_instance_id: runInstanceId,
    status: status.status,
    pending: capacity.pending, pending_limit: capacity.limit,
    available: capacity.available, backpressured: capacity.backpressured,
    journal_bytes: journalBytes, journal_limit: Limits.RUN_CONTROL_JOURNAL_MAX_BYTES,
    ...(capacity.oldest_pending_at ? { oldest_pending_at: capacity.oldest_pending_at } : {}),
    stale_pending: stalePending,
    diagnostics,
    actor_actions: Array.isArray(status.control) ? status.control : [],
    runtime_actions: status.status === "running" ? ["kill"] : ["archive", "prune"],
    endpoint: runInstanceId
      ? RunControlDelivery.readRunControlEndpoint(stateDir, runInstanceId)
      : undefined,
    recent_controls: journal.records.slice(-Math.max(1, Number(input.lines || 20))).reverse()
      .map((control) => ControlProjection.projectRunControl(control as RunsControls.RunControlRecord)),
  };
}

function inspectTool(
  name: string,
  view: string,
  deps: InspectToolDeps,
): Record<string, unknown> {
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`invalid tool target: tool:${name}`);
  }
  if (view !== "status" && view !== "schema") {
    throw new Error("inspect tool:<name> supports view=status or view=schema.");
  }
  const tool = deps.getTool?.(name);
  const status = deps.getToolStatus?.(name);
  if (!tool && !status) {
    throw new Error(
      `Registered tool not found: ${name}. Next: inspect target=recipes view=doctor; do not substitute spawn for tool invocation.`,
    );
  }
  if (view === "schema" && !tool) {
    throw new Error(
      `Tool "${name}" is registered but its callable schema is unavailable; callable_now=${String(status?.callable_now ?? false)}, activation_boundary=${String(status?.activation_boundary ?? "host_registration")}. Next: inspect target=tool:${name} view=status.`,
    );
  }
  return {
    name,
    ...(view === "status" ? status : {}),
    ...(tool
      ? {
          description: tool.description,
          parameters: tool.parameters,
          promptSnippet: tool.promptSnippet,
        }
      : {}),
  };
}

function compactResult(target: string, view: string, details: Record<string, unknown>): string {
  if (target === "runtime") return compactRuntime(view, details);
  if (target === "recipes" && typeof details.identity === "string") {
    const lines = [
      `recipes doctor identity=${details.identity} skill_active=${String(details.skill_active)} resolvable=${String(details.resolvable)} catalog_partial=${String(details.catalog_partial)} component_status=${String(details.component_status)}`,
      ...(details.source_location
        ? [`source=${String(details.source_location)}`]
        : []),
      `resolution_generation=${String(details.resolution_generation)}`,
      ...(details.rejected_reason
        ? [`rejected_reason=${String(details.rejected_reason)}`]
        : []),
      ...((details.next_actions as unknown[] | undefined) ?? []).map(
        (action) => `next=${String(action)}`,
      ),
    ];
    return `\n${lines.join("\n")}`;
  }
  if (target === "recipes") return ToolsResponse.compactRecipeRegistry(details);
  if (target.startsWith("tool:") && view === "status") {
    const required = Array.isArray(details.required_args)
      ? details.required_args.map(String).join(",") || "none"
      : "unknown";
    const optional = Array.isArray(details.optional_args)
      ? details.optional_args.map(String).join(",") || "none"
      : "unknown";
    const next = Array.isArray(details.next_actions) && details.next_actions.length > 0
      ? String(details.next_actions[0])
      : details.callable_now === true
        ? `call tool ${target.slice(5)}`
        : `register_tool name=${target.slice(5)} update=true`;
    return `\ntool=${target.slice(5)} source=${String(details.source ?? "unknown")} callable_now=${String(details.callable_now ?? false)} activation_boundary=${String(details.activation_boundary ?? "unknown")} required=${required} optional=${optional} launch_kind=${String(details.launch_kind ?? "none")} spawn_calls=${Number(details.spawn_calls ?? 0)} tool_calls=${Number(details.tool_calls ?? 0)} next=${next}`;
  }
  if (target.startsWith("tool:")) return `\ntool=${target.slice(5)} view=${view}`;
  return `\nrun=${target.slice(4)} view=${view}`;
}

export function createInspectToolDefinition<TContext = unknown>(
  deps: InspectToolDeps<TContext> = {},
): any {
  return {
    name: "inspect",
    label: "Inspect",
    description:
      "Inspect a Run's Recipe, Trace, or Control evidence, or runtime/recipe/tool diagnostics.",
    parameters: Schema.objectSchema(
      {
        identity: Schema.stringSchema(
          "Optional canonical <skill>/<recipe> identity for focused Recipe doctor diagnosis.",
        ),
        lines: Schema.stringSchema("Bounded item count for Trace or recent Controls."),
        source: Schema.stringSchema(
          "Optional Trace source: all, lifecycle, control, process, agent, artifact, or runtime.",
        ),
        status: Schema.stringSchema("Optional runtime Run status filter."),
        target: Schema.stringSchema("Target: run:<id>, runtime, recipes, or tool:<name>."),
        verbose: Schema.booleanSchema("Return full JSON instead of compact text."),
        view: Schema.stringSchema(
          "Run view recipe|trace|control, or target-specific management view.",
        ),
      },
      ["target", "view"],
    ),
    async execute(
      _toolCallId: string,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: TContext,
    ) {
      const input = asRecord(params);
      const target = String(input.target ?? "");
      const view = String(input.view ?? "");
      let details: Record<string, unknown>;
      if (target === "runtime") {
        details = inspectRuntime(view, input, ctx, deps);
      } else if (target === "recipes") {
        details = inspectRecipes(view, input, deps, ctx);
      } else {
        const run = parseRunTarget(target);
        if (run) details = inspectRun(run, view, input, ctx, deps);
        else if (target.startsWith("tool:")) {
          details = inspectTool(target.slice(5), view, deps);
        } else {
          throw new Error(
            `unsupported inspect target: ${target}; use run:<id>, runtime, recipes, or tool:<name>`,
          );
        }
      }
      return {
        content: [{
          type: "text" as const,
          text: maybeJsonText(
            details,
            input.verbose === true || (target.startsWith("tool:") && view === "schema"),
            compactResult(target, view, details),
          ),
        }],
        details,
      };
    },
  };
}
