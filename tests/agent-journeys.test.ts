import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CommandTemplateExecResult } from "../lib/command-templates.ts";
import { getRunStateRoot } from "../lib/paths.ts";
import {
  createRecipeResolutionContext,
} from "../lib/recipes-context.ts";
import {
  createActiveSkillRecipeContext,
  inventoryActiveSkillRecipeComponents,
} from "../lib/recipes-references.ts";
import { executeRegisterTool } from "../lib/registry.ts";
import { createAutoToolsRuntime } from "../lib/runtime.ts";
import { createSpawnToolDefinition } from "../lib/tools-spawn.ts";

const exec = async (): Promise<CommandTemplateExecResult> => ({
  code: 0,
  killed: false,
  stderr: "",
  stdout: "ok",
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function journeyFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-agent-journey-"));
  const media = join(root, "skills", "music-player");
  const stale = join(root, "skills", "stale");
  const recipeRoot = join(root, "recipes");
  await mkdir(join(media, "recipes"), { recursive: true });
  await mkdir(join(stale, "recipes"), { recursive: true });
  await mkdir(recipeRoot, { recursive: true });
  await writeFile(join(media, "SKILL.md"), "---\nname: music-player\ndescription: Use for media.\n---\n");
  await writeFile(join(stale, "SKILL.md"), "---\nname: stale\ndescription: Stale fixture.\n---\n");
  await writeFile(
    join(media, "recipes", "playback.json"),
    JSON.stringify({
      async: true,
      args: [
        "command:enum(play,status)",
        "source:path",
        "state_dir:path",
      ],
      control: ["play", "status"],
      defaults: { command: "play" },
      description: "Maintained media player fixture.",
      template: `${process.execPath} -e "console.log('media-ready')"`,
    }),
  );
  const stalePath = join(stale, "recipes", "broken.json");
  await writeFile(
    stalePath,
    JSON.stringify({ name: "removed", template: "echo stale" }),
  );
  const skillContext = createActiveSkillRecipeContext([
    { name: "music-player", baseDir: media },
    { name: "stale", baseDir: stale },
  ]);
  return {
    context: createRecipeResolutionContext("agent-journey", root, skillContext),
    media,
    recipeRoot,
    root,
    skillContext,
    stalePath,
  };
}

test("Agent Journeys A-D preserve one-off, persistent, degraded, and unavailable paths", async () => {
  const fixture = await journeyFixture();
  const oneOffRun = `journey-one-off-${process.pid}-${Date.now()}`;
  const toolRun = `journey-tool-${process.pid}-${Date.now()}`;
  const oneOffState = join(getRunStateRoot(), oneOffRun);
  const toolState = join(getRunStateRoot(), toolRun);
  try {
    // Journey A: the maintained capability is spawned once; no persistent tool appears.
    const spawn = createSpawnToolDefinition();
    const oneOff = await spawn.execute(
      "journey-a",
      {
        as: `run:${oneOffRun}`,
        recipe: "music-player/playback",
        values: { command: "status", source: "~/Music/1MIX" },
      },
      undefined,
      undefined,
      { cwd: fixture.root, recipeResolutionContext: fixture.context },
    );
    assert.equal(oneOff.details.launch_kind, "spawn");
    assert.equal(
      oneOff.details.recipe_file,
      join(fixture.media, "recipes", "playback.json"),
    );
    assert.deepEqual(await readdir(fixture.recipeRoot), []);
    await waitForFile(join(oneOffState, "result.json"));

    // Journeys B and C: exact valid resolution survives unrelated catalog damage,
    // registration activates the compact specialization, and the generated tool is called.
    const inventory = inventoryActiveSkillRecipeComponents(fixture.skillContext);
    assert.equal(inventory.partial, true);
    assert.equal(
      inventory.components.some((component) => component.identity === "music-player/playback"),
      true,
    );
    const staleBefore = await readFile(fixture.stalePath, "utf8");
    const definitions = new Map<string, any>();
    let activeTools: string[] = [];
    const runtime = createAutoToolsRuntime({
      configPath: join(fixture.root, "tool-registry.json"),
      exec,
      getActiveTools: () => activeTools,
      getAllTools: () => [...definitions.values()],
      recipeRoot: fixture.recipeRoot,
      registerTool: (definition) => definitions.set(definition.name, definition),
      reservedToolNames: new Set(),
      setActiveTools: (names) => {
        activeTools = [...names];
      },
    });
    const registration = await executeRegisterTool(
      {
        defaults: { source: "~/Music/1MIX" },
        from: "music-player/playback",
        name: "music_player",
      },
      { recipeResolutionContext: fixture.context },
      {
        configPath: join(fixture.root, "tool-registry.json"),
        getActiveTools: () => activeTools,
        getToolNameBlocker: runtime.getToolNameBlocker,
        getTools: runtime.getTools,
        notify: () => undefined,
        recipeRoot: fixture.recipeRoot,
        registerRuntimeTool: runtime.registerRuntimeTool,
        reservedToolNames: new Set(),
        setActiveTools: (names) => {
          activeTools = [...names];
        },
      },
    );
    assert.equal(registration.details.source, "music-player/playback");
    assert.equal(registration.details.callable_now, true);
    assert.deepEqual(registration.details.next_actions?.[0], "call tool music_player");
    assert.deepEqual(
      JSON.parse(await readFile(join(fixture.recipeRoot, "music_player.json"), "utf8")),
      { defaults: { source: "~/Music/1MIX" }, template: "music-player/playback" },
    );
    const musicPlayer = definitions.get("music_player");
    assert.ok(musicPlayer);
    const invocation = await musicPlayer.execute(
      "journey-b-tool-call",
      { command: "status", run_id: toolRun },
      undefined,
      undefined,
      { cwd: fixture.root },
    );
    assert.equal(invocation.details.launch_kind, "tool");
    await waitForFile(join(toolState, "result.json"));
    assert.equal(runtime.getToolStatus("music_player")?.tool_calls, 1);
    assert.equal(await readFile(fixture.stalePath, "utf8"), staleBefore);

    // Journey D: inactive ownership stops at a focused public diagnostic.
    const inactive = createRecipeResolutionContext(
      "agent-journey-inactive",
      fixture.root,
      createActiveSkillRecipeContext([]),
    );
    await assert.rejects(
      spawn.execute(
        "journey-d",
        { recipe: "music-player/playback", values: { source: "~/Music/1MIX" } },
        undefined,
        undefined,
        { cwd: fixture.root, recipeResolutionContext: inactive },
      ),
      /Owning Skill "music-player" is not active.*Next: activate Skill music-player.*inspect target=recipes view=doctor identity=music-player\/playback/s,
    );
    await assert.rejects(
      executeRegisterTool(
        { from: "music-player/playback", name: "inactive_player" },
        { recipeResolutionContext: inactive },
        {
          configPath: join(fixture.root, "tool-registry.json"),
          getActiveTools: () => activeTools,
          getToolNameBlocker: runtime.getToolNameBlocker,
          getTools: runtime.getTools,
          notify: () => undefined,
          recipeRoot: fixture.recipeRoot,
          registerRuntimeTool: runtime.registerRuntimeTool,
          reservedToolNames: new Set(),
          setActiveTools: (names) => {
            activeTools = [...names];
          },
        },
      ),
      /Recipe source "music-player\/playback" validation failed:.*Owning Skill "music-player" is not active.*Next: inspect target=recipes view=doctor identity=music-player\/playback/s,
    );
    assert.equal(existsSync(join(fixture.recipeRoot, "inactive_playback.json")), false);
  } finally {
    await rm(oneOffState, { force: true, recursive: true });
    await rm(toolState, { force: true, recursive: true });
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("Music Player routes Telegram control intent to its maintained Generative App", () => {
  const music = readFileSync("skills/music-player/SKILL.md", "utf8");

  assert.match(
    music,
    /Telegram-originated turn.*prefer the maintained Telegram view.*one-shot prompt buttons/s,
  );
  assert.match(
    music,
    /`telegram_bind` is available.*operating guidance that owns Generative Apps.*capability-owned adapter/s,
  );
  assert.match(music, /do not re-author it or move playback authority into the view/);
});

test("Agent Journeys E-G route multi-actor, project, and artifact intent to owning Skills", () => {
  const prompt = readFileSync("lib/prompts.ts", "utf8");
  const actors = readFileSync("skills/actors/SKILL.md", "utf8");
  const swarm = readFileSync("skills/swarm/SKILL.md", "utf8");
  const project = readFileSync("skills/project-work/SKILL.md", "utf8");
  const artifacts = readFileSync("skills/artifacts/SKILL.md", "utf8");

  assert.match(prompt, /multiple actors or subagents.*swarm Skill/s);
  assert.match(actors, /Coordinate several independent actors or subagents.*read the swarm Skill/s);
  assert.match(swarm, /Read `actors` first for generic Recipe, spawn, Run, Trace, Control, artifact, and lifecycle operation/);
  assert.match(swarm, /swarm\/lens-review/);
  assert.doesNotMatch(swarm, /room:|task tree|task-tree/i);
  assert.match(swarm, /Coordinator checkpoints are bounded decision requests, not free-form actor chat/);

  assert.match(project, /project-work\/repo-health/);
  assert.match(project, /project-work\/release-readiness/);
  assert.match(project, /Readiness only; does not publish/);

  assert.match(artifacts, /Desired outcome/);
  assert.match(artifacts, /artifacts\/bundle/);
  assert.match(artifacts, /without committing a filesystem write.*artifacts\/report/s);
  assert.match(artifacts, /artifacts\/write.*Declared artifact path written/s);
});
