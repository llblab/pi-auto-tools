/**
 * Pi actor extension runtime coordinator.
 * Zones: extension session lifecycle, host tool adaptation, runtime service composition
 * Owns low-level Pi lifecycle effects and tool wrapping without owning event registration.
 */

import * as AutomaticReviewRuntime from "./automatic-review-runtime.ts";
import * as CommandTemplates from "./command-templates.ts";
import * as Paths from "./paths.ts";
import * as Pi from "./pi.ts";
import * as Prompts from "./prompts.ts";
import * as RecipeResolution from "./recipes-context.ts";
import * as RecipesReferences from "./recipes-references.ts";
import * as RunUiRuntime from "./run-ui-runtime.ts";
import * as Runtime from "./runtime.ts";
import * as Temp from "./temp.ts";
import * as Tools from "./tools.ts";
import * as ToolsResponse from "./tools-response.ts";

export interface ActorExtensionRuntime {
  beforeAgentStart(
    systemPrompt: string,
    skills: RecipesReferences.ActiveSkillRecipeSource[],
    ctx: Pi.ExtensionContext,
  ): { systemPrompt: string };
  discoverResources(metaUrl: string): { skillPaths: string[] } | undefined;
  getRunOwnerId(ctx: Pi.ExtensionContext): string;
  onAgentSettled(ctx: Pi.ExtensionContext): void;
  onSessionShutdown(reason: string, ctx: Pi.ExtensionContext): void;
  onSessionStart(ctx: Pi.ExtensionContext): Promise<void>;
  registerCoreTools(): void;
}

export function createActorExtensionRuntime(
  pi: Pi.ExtensionAPI,
): ActorExtensionRuntime {
  let activeRunContext: Pi.ExtensionContext | undefined;
  let activeRunOwnerId: string | undefined;
  const runOwnerIdsByContext = new WeakMap<Pi.ExtensionContext, string>();
  const recipeResolutionContextsBySession = new Map<
    string,
    RecipeResolution.RecipeResolutionContext
  >();
  const getRunOwnerId = Pi.getSessionId;
  const getRecipeResolutionContext = (ctx: Pi.ExtensionContext) => {
    const sessionId = getRunOwnerId(ctx);
    const resolutionContext = recipeResolutionContextsBySession.get(sessionId);
    if (!resolutionContext) {
      throw new Error(
        `Recipe resolution context is unavailable for session ${sessionId}.`,
      );
    }
    return resolutionContext;
  };
  const automaticReview = AutomaticReviewRuntime.createAutomaticReviewRuntime({
    getActiveContext: () => activeRunContext,
    getRunOwnerId,
    getThinkingLevel: () => pi.getThinkingLevel(),
  });
  let recipeReload: Runtime.RecipeToolReloadWatcher | undefined;
  let runUiRuntime: RunUiRuntime.RunUiRuntime;
  const closeActiveSessionRuntimes = (): void => {
    const ownerId = activeRunOwnerId;
    activeRunContext = undefined;
    activeRunOwnerId = undefined;
    runUiRuntime?.close();
    automaticReview.close();
    recipeReload?.close();
    if (ownerId) recipeResolutionContextsBySession.delete(ownerId);
  };
  runUiRuntime = RunUiRuntime.createRunUiRuntime({
    getActiveContext: () => activeRunContext,
    onCallbackError: closeActiveSessionRuntimes,
    onRunEvent: automaticReview.schedule,
    pi,
  });
  const actorToolDefinitions = new Map<string, Tools.ActorToolDefinition>();
  const withCurrentThinkingContext = <T extends Tools.ActorToolDefinition>(
    definition: T,
  ): T => {
    if (typeof definition.execute !== "function") return definition;
    const execute = definition.execute as (...args: unknown[]) => unknown;
    return {
      ...definition,
      execute: async (...args: unknown[]) => {
        const nextArgs = [...args];
        const ctx = nextArgs[4];
        if (ctx && typeof ctx === "object") {
          nextArgs[4] = {
            ...(ctx as Record<string, unknown>),
            recipeResolutionContext: getRecipeResolutionContext(
              ctx as Pi.ExtensionContext,
            ),
            getThinkingLevel: () => pi.getThinkingLevel(),
          };
        }
        try {
          return ToolsResponse.spaceToolResult(await execute(...nextArgs));
        } catch (error) {
          throw ToolsResponse.spaceToolError(error);
        }
      },
    } as T;
  };
  const runtime = Runtime.createAutoToolsRuntime({
    configPath: Paths.EXTENSION_RUNTIME_PATHS.configPath,
    exec: CommandTemplates.execCommandTemplate,
    getActiveTools: () => pi.getActiveTools(),
    getAllTools: () => pi.getAllTools(),
    registerTool: (definition) => {
      const wrapped = withCurrentThinkingContext(definition);
      actorToolDefinitions.set(wrapped.name, wrapped);
      pi.registerTool(wrapped);
    },
    reservedToolNames: Tools.RESERVED_TOOL_NAMES,
    setActiveTools: (toolNames) => pi.setActiveTools(toolNames),
  });
  recipeReload = Runtime.createRecipeToolReloadWatcher(runtime, {
    getResolutionContext: () =>
      activeRunContext
        ? getRecipeResolutionContext(activeRunContext)
        : undefined,
    onCallbackError: closeActiveSessionRuntimes,
  });
  return {
    beforeAgentStart(systemPrompt, skills, ctx) {
      const sessionId = getRunOwnerId(ctx);
      const resolutionContext = RecipeResolution.createRecipeResolutionContext(
        sessionId,
        ctx.cwd,
        RecipesReferences.createActiveSkillRecipeContext(skills),
      );
      recipeResolutionContextsBySession.set(sessionId, resolutionContext);
      runtime.loadTools(ctx, resolutionContext);
      return {
        systemPrompt: `${systemPrompt}\n\n${Prompts.ONBOARDING_SYSTEM_PROMPT}`,
      };
    },
    discoverResources(metaUrl) {
      const skillPaths = Paths.getExistingExtensionSkillPaths(metaUrl);
      return skillPaths.length > 0 ? { skillPaths } : undefined;
    },
    getRunOwnerId,
    onAgentSettled(ctx) {
      if (activeRunContext === ctx) automaticReview.schedule();
    },
    onSessionShutdown(reason, ctx) {
      const ownerId = runOwnerIdsByContext.get(ctx);
      runOwnerIdsByContext.delete(ctx);
      if (activeRunContext === ctx) closeActiveSessionRuntimes();
      if (ownerId) recipeResolutionContextsBySession.delete(ownerId);
      runUiRuntime.shutdown(reason, ownerId, ctx);
    },
    async onSessionStart(ctx) {
      const sessionId = getRunOwnerId(ctx);
      recipeResolutionContextsBySession.set(
        sessionId,
        RecipeResolution.createEmptyRecipeResolutionContext(sessionId, ctx.cwd),
      );
      ctx.ui.setWidget("zz-pi-actors-comms", undefined);
      activeRunContext = ctx;
      activeRunOwnerId = sessionId;
      runOwnerIdsByContext.set(ctx, sessionId);
      runUiRuntime.close();
      automaticReview.close();
      recipeReload.close();
      await Temp.prepareExtensionTempDir(Paths.EXTENSION_RUNTIME_PATHS.tempDir);
      if (activeRunContext !== ctx || activeRunOwnerId !== sessionId) return;
      automaticReview.start(ctx);
      runUiRuntime.start(ctx, sessionId);
      recipeReload.watch(ctx);
    },
    registerCoreTools() {
      Pi.registerToolDefinitions(
        pi,
        Tools.createCoreActorToolDefinitions<Pi.ExtensionContext>({
          configPath: Paths.EXTENSION_RUNTIME_PATHS.configPath,
          getActiveTools: () => pi.getActiveTools(),
          getRecipeResolutionContext: () =>
            activeRunContext
              ? getRecipeResolutionContext(activeRunContext)
              : undefined,
          getRuntimeTool: (name) =>
            Tools.resolveActiveRuntimeTool(
              name,
              runtime.getTools(),
              (activeName) => actorToolDefinitions.get(activeName),
            ),
          getRuntimeToolStatus: runtime.getToolStatus,
          handleRuntimeControl: automaticReview.handleControl,
          registryRuntime: runtime,
          setActiveTools: (toolNames) => pi.setActiveTools(toolNames),
        }).map(withCurrentThinkingContext),
      );
    },
  };
}
