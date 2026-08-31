/**
 * pi-actors — actor runtime and persistent local tool registry for pi.
 * Zones: composition root, pi agent, actor runtime
 * Owns extension composition and Pi event registration, not domain behavior.
 */

import * as ExtensionRuntime from "./lib/extension-runtime.ts";
import * as InspectorCommand from "./lib/inspector-command.ts";
import * as Pi from "./lib/pi.ts";

export default function toolRegistryExtension(pi: Pi.ExtensionAPI) {
  const runtime = ExtensionRuntime.createActorExtensionRuntime(pi);
  pi.on("resources_discover", async () =>
    runtime.discoverResources(import.meta.url),
  );
  pi.on("session_start", async (_event, ctx) => runtime.onSessionStart(ctx));
  pi.on("agent_settled", async (_event, ctx) => runtime.onAgentSettled(ctx));
  pi.on("session_shutdown", async (event, ctx) =>
    runtime.onSessionShutdown(event.reason, ctx),
  );
  pi.on("before_agent_start", async (event, ctx) =>
    runtime.beforeAgentStart(
      event.systemPrompt,
      event.systemPromptOptions.skills ?? [],
      ctx,
    ),
  );
  InspectorCommand.registerActorInspectorCommand(pi, runtime.getRunOwnerId);
  runtime.registerCoreTools();
}
