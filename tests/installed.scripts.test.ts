/**
 * Installed package script regression tests.
 * Covers Node native type-stripping restrictions for scripts running under node_modules.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { deliverRunControl } from "../lib/runs-control-delivery.ts";

const execFileAsync = promisify(execFile);

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function waitForText(
  path: string,
  pattern: RegExp,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readTextIfExists(path);
    if (pattern.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${pattern} in ${path}`);
}

async function removeTreeEventually(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code ?? "") || attempt === 49) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function linkPiPeers(root: string): Promise<void> {
  const peersDir = join(root, "node_modules", "@earendil-works");
  await mkdir(peersDir, { recursive: true });
  for (const peer of ["pi-coding-agent", "pi-tui"]) {
    await symlink(join(process.cwd(), "node_modules", "@earendil-works", peer), join(peersDir, peer), "dir");
  }
}

async function prepareInstalledPackage(root: string): Promise<string> {
  const packageDir = join(root, "node_modules", "@llblab", "pi-actors");
  await mkdir(packageDir, { recursive: true });
  await linkPiPeers(root);
  await cp(join(process.cwd(), "package.json"), join(packageDir, "package.json"));
  await cp(join(process.cwd(), "dist"), join(packageDir, "dist"), { recursive: true });
  await cp(join(process.cwd(), "lib"), join(packageDir, "lib"), { recursive: true });
  await cp(join(process.cwd(), "scripts"), join(packageDir, "scripts"), { recursive: true });
  await cp(join(process.cwd(), "skills"), join(packageDir, "skills"), { recursive: true });
  return packageDir;
}

async function preparePackedPackage(root: string): Promise<string> {
  const packDir = join(root, "pack");
  await mkdir(packDir, { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ private: true })}\n`);
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "npm_execpath is required for packed-package tests");
  await execFileAsync(process.execPath, [
    npmCli,
    "pack",
    process.cwd(),
    "--pack-destination",
    packDir,
    "--silent",
  ], { cwd: root });
  const tarballs = (await readdir(packDir)).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  await execFileAsync(process.execPath, [
    npmCli,
    "install",
    "--ignore-scripts",
    "--legacy-peer-deps",
    "--no-package-lock",
    "--no-save",
    join(packDir, tarballs[0]),
  ], { cwd: root });
  await linkPiPeers(root);
  return join(root, "node_modules", "@llblab", "pi-actors");
}

test("package metadata exposes compiled and source extension entrypoints", async () => {
  const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  assert.deepEqual(pkg.pi.extensions, ["./dist/pi-actors/index.js"]);
  assert.deepEqual(pkg.pi.sourceExtensions, ["./index.ts"]);
  assert.deepEqual(pkg.pi.skills, ["./dist/skills"]);
  assert.deepEqual(pkg.pi.sourceSkills, ["./skills"]);
  assert.deepEqual(pkg.peerDependencies, {
    "@earendil-works/pi-coding-agent": ">=0.84.4",
    "@earendil-works/pi-tui": ">=0.84.4",
  });
  await access(join(process.cwd(), pkg.pi.extensions[0]));
  await access(join(process.cwd(), pkg.pi.sourceExtensions[0]));
});

test("build output mirrors JS runtime assets under dist", async () => {
  for (const dir of ["scripts", "fixtures", "skills"] as const) {
    const sourceEntries = await readdir(join(process.cwd(), dir));
    const distEntries = await readdir(join(process.cwd(), "dist", dir));
    assert.deepEqual(distEntries.sort(), sourceEntries.sort(), `dist/${dir} should mirror ${dir}`);
  }
  assert.equal(
    await readFile(join(process.cwd(), "dist", "pi-actors", "index.js"), "utf8"),
    'export { default } from "../index.js";\n',
  );
  await access(join(process.cwd(), "dist", "scripts", "async-runner.mjs"));
  await access(join(process.cwd(), "dist", "scripts", "build-dist.mjs"));
  await access(join(process.cwd(), "dist", "skills", "actors", "recipes", "recipe-validate.json"));
  await access(join(process.cwd(), "dist", "skills", "actors", "scripts", "validate-recipe.mjs"));
  await access(join(process.cwd(), "dist", "fixtures", "protocol", "control-record.json"));
  await access(join(process.cwd(), "dist", "fixtures", "protocol", "trace-event.json"));
  for (const skill of ["actors", "artifacts", "music-player", "project-work", "recipe-memory", "swarm"]) {
    await access(join(process.cwd(), "dist", "skills", skill, "SKILL.md"));
  }
});

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(() => access(path), /ENOENT/);
}

test("dist package contract excludes stale renamed files and source runtime imports", async () => {
  await assertMissing(join(process.cwd(), "dist", "index.ts"));
  for (const staleLib of [
    "actor-inspector-tui",
    "actor-messages",
    "actor-recipe-context",
    "actor-rooms",
    "actor-tools",
    "actor-worker",
    "async-runner",
    "coordinator",
    "locker",
    "mailbox-worker",
    "output",
    "recipe-context",
    "recipe-discovery",
    "recipe-references",
    "recipe-usage",
    "recipe-utils",
    "run-executor",
    "validate-recipe",
  ]) {
    await assertMissing(join(process.cwd(), "dist", "lib", `${staleLib}.js`));
    await assertMissing(join(process.cwd(), "dist", "lib", `${staleLib}.d.ts`));
  }
  for (const script of await readdir(join(process.cwd(), "dist", "scripts"))) {
    if (!script.endsWith(".mjs")) continue;
    const text = await readFile(join(process.cwd(), "dist", "scripts", script), "utf8");
    assert.doesNotMatch(text, /\.\.\/lib\/.*\.ts/);
    assert.doesNotMatch(text, /node_modules.*\.ts/);
  }
});

test("installed dist runtime reports exact package identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-identity-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "-e",
      `const { readFileSync } = require("node:fs");
       const { join } = require("node:path");
       const { pathToFileURL } = require("node:url");
       const packageDir = process.argv[1];
       const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
       import(pathToFileURL(join(packageDir, "dist", "lib", "tools-inspect.js")).href).then(async (mod) => {
         const tool = mod.createInspectToolDefinition();
         const result = await tool.execute("status", { target: "runtime", view: "status", verbose: true }, undefined, undefined, {});
         if (result.details.version !== pkg.version) process.exitCode = 2;
         if (result.details.state_schema !== "run-kernel-v1") process.exitCode = 3;
         console.log(JSON.stringify({ version: result.details.version, state_schema: result.details.state_schema }));
       }).catch((error) => { console.error(error); process.exitCode = 1; });`,
      packageDir,
    ]);
    assert.equal(stderr, "");
    const pkg = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    assert.deepEqual(JSON.parse(stdout), {
      version: pkg.version,
      state_schema: "run-kernel-v1",
    });
  } finally {
    await removeTreeEventually(root);
  }
});

test("installed dist resolves active-Skill and explicit file Recipes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-skill-recipes-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const skillDir = join(root, "skill");
    const recipeDir = join(skillDir, "recipes");
    await mkdir(recipeDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Skill\n");
    await writeFile(
      join(recipeDir, "task.json"),
      JSON.stringify({ template: "echo {skill_dir}" }),
    );
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "-e",
      `const { join } = require("node:path");
       const { pathToFileURL } = require("node:url");
       const packageDir = process.argv[1];
       const skillDir = process.argv[2];
       import(pathToFileURL(join(packageDir, "dist", "lib", "recipes-references.js")).href).then((mod) => {
         const skillContext = mod.createActiveSkillRecipeContext([{ name: "sample", baseDir: skillDir }]);
         const skillPath = mod.resolveRecipeReferencePath("sample/task", process.cwd(), skillContext);
         const skill = mod.readResolvedRecipeConfig(skillPath, [], { skillContext });
         const file = mod.readResolvedRecipeConfig(mod.resolveRecipeReferencePath(join(packageDir, "skills", "project-work", "recipes", "package-summary.json")));
         const context = mod.buildRecipeContextRecords(join(skillDir, "recipes", "task.json"), skillContext);
         console.log(JSON.stringify({
           skill_dir: skill.skill_dir,
           skill_template: skill.template,
           file_ok: JSON.stringify(file.template).includes("project-utils.mjs"),
           logical_reference: context[0].logical_reference,
         source_kind: context[0].source_kind,
         }));
       }).catch((error) => { console.error(error); process.exitCode = 1; });`,
      packageDir,
      skillDir,
    ]);
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.skill_dir, skillDir);
    assert.match(JSON.stringify(result.skill_template), /skill/);
    assert.equal(result.file_ok, true);
    assert.equal(result.logical_reference, "sample/task");
    assert.equal(result.source_kind, "active_skill_component");
  } finally {
    await removeTreeEventually(root);
  }
});

test("installed dist resolves every representative capability pack by qualified identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-capabilities-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const identities = [
      "project-work/repo-health",
      "project-work/release-readiness",
      "swarm/quorum-review",
      "artifacts/bundle",
      "music-player/playback",
      "recipe-memory/draft-review",
    ];
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "-e",
      `const { join } = require("node:path");
       const { pathToFileURL } = require("node:url");
       const packageDir = process.argv[1];
       const identities = JSON.parse(process.argv[2]);
       import(pathToFileURL(join(packageDir, "dist", "lib", "recipes-references.js")).href).then((mod) => {
         const skillContext = mod.createActiveSkillRecipeContext(
           ["actors", "artifacts", "music-player", "project-work", "recipe-memory", "swarm"]
             .map((name) => ({ name, baseDir: join(packageDir, "skills", name) })),
         );
         const resolved = identities.map((identity) => {
           const file = mod.resolveRecipeReferencePath(identity, process.cwd(), skillContext);
           const config = mod.readResolvedRecipeConfig(file, [], { skillContext });
           const context = mod.buildRecipeContextRecords(file, skillContext);
           return { identity, ok: Boolean(config?.template), logical: context[0].logical_reference, source: context[0].source_kind };
         });
         console.log(JSON.stringify(resolved));
       }).catch((error) => { console.error(error); process.exitCode = 1; });`,
      packageDir,
      JSON.stringify(identities),
    ]);
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), identities.map((identity) => ({
      identity,
      ok: true,
      logical: identity,
      source: "active_skill_component",
    })));
  } finally {
    await removeTreeEventually(root);
  }
});

test("packed artifact first session preserves agent-native Skill and tool parity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-packed-artifact-"));
  try {
    const packageDir = await preparePackedPackage(root);
    const pkg = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    const agentDir = join(root, "agent");
    const homeDir = join(root, "home");
    const staleSkillDir = join(root, "stale-skill");
    const sourceDir = join(root, "music");
    await mkdir(agentDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
    assert.deepEqual(await readdir(agentDir), []);
    await mkdir(join(staleSkillDir, "recipes"), { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "track.wav"), "audio fixture");
    const fakeFfplay = join(sourceDir, process.platform === "win32" ? "ffplay.cmd" : "ffplay");
    await writeFile(
      fakeFfplay,
      process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
    );
    if (process.platform !== "win32") await chmod(fakeFfplay, 0o755);
    await writeFile(join(staleSkillDir, "SKILL.md"), "---\nname: stale\n---\n");
    await writeFile(join(staleSkillDir, "recipes", "broken.json"), JSON.stringify({
      name: "removed-identity",
      template: "echo broken",
    }));
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "-e",
      `const { readFileSync } = require("node:fs");
       const { join } = require("node:path");
       const { pathToFileURL } = require("node:url");
       const packageDir = process.argv[1];
       const staleSkillDir = process.argv[2];
       const sourceDir = process.argv[3];
       import(pathToFileURL(join(packageDir, "dist", "pi-actors", "index.js")).href).then(async (mod) => {
         const tools = [];
         const definitions = new Map();
         let activeTools = [];
         const commands = [];
         const handlers = new Map();
         const pi = {
           getActiveTools: () => [...activeTools],
           getAllTools: () => [...definitions.values()],
           getThinkingLevel: () => "off",
           on: (name, handler) => handlers.set(name, handler),
           registerCommand: (name) => commands.push(name),
           registerTool: (definition) => {
             definitions.set(definition.name, definition);
             activeTools = [...new Set([...activeTools, definition.name])];
             tools.push({
               name: definition.name,
               properties: Object.keys(definition.parameters.properties).sort(),
               required: definition.parameters.required,
             });
           },
           setActiveTools: (names) => {
             activeTools = names.filter((name) => definitions.has(name));
           },
         };
         mod.default(pi);
         const resources = await handlers.get("resources_discover")();
         const context = {
           cwd: packageDir,
           sessionManager: { getSessionId: () => "packed-owner" },
         };
         const startup = await handlers.get("before_agent_start")({
           systemPrompt: "base",
           systemPromptOptions: {
             skills: [
               {
                 name: "actors",
                 filePath: join(packageDir, "dist", "skills", "actors", "SKILL.md"),
               },
               {
                 name: "music-player",
                 filePath: join(packageDir, "dist", "skills", "music-player", "SKILL.md"),
               },
               { name: "stale", filePath: join(staleSkillDir, "SKILL.md") },
             ],
           },
         }, context);
         const register = definitions.get("register_tool");
         const registration = await register.execute("packed-register", {
           name: "packed_ping",
           description: "Return a packed integration marker.",
           template: "printf packed-pong",
         }, undefined, undefined, context);
         const packedPing = definitions.get("packed_ping");
         const invocation = await packedPing.execute(
           "packed-ping-call",
           {},
           undefined,
           undefined,
           context,
         );
         const spawn = definitions.get("spawn");
         const inspect = definitions.get("inspect");
         const message = definitions.get("message");
         const musicRegistration = await register.execute("packed-music-register", {
           defaults: { source: sourceDir, loop: false, player: "ffplay" },
           name: "music_player",
           description: "Control local music from the maintained Music Player Recipe.",
           from: "music-player/playback",
         }, undefined, undefined, context);
         const musicPlayer = definitions.get("music_player");
         const wrapperPath = join(process.env.PI_CODING_AGENT_DIR, "recipes", "music_player.json");
         const authoredWrapper = JSON.parse(readFileSync(wrapperPath, "utf8"));
         const waitForMusicTerminal = async () => {
           for (let attempt = 0; attempt < 200; attempt += 1) {
             const current = await inspect.execute("packed-music-terminal", {
               target: "run:music-player",
               view: "control",
               verbose: true,
             }, undefined, undefined, context);
             if (current.details.status !== "running") {
               let pid = 0;
               try {
                 const runState = JSON.parse(readFileSync(join(
                   process.env.PI_CODING_AGENT_DIR,
                   "tmp", "pi-actors", "runs", "music-player", "run.json",
                 ), "utf8"));
                 pid = Number(runState.pid || 0);
               } catch {}
               try {
                 if (pid > 0) process.kill(pid, 0);
                 else return;
               } catch {
                 return;
               }
             }
             await new Promise((resolve) => setTimeout(resolve, 25));
           }
           throw new Error("packed music player did not reach terminal state");
         };
         const mediaSpawn = await spawn.execute("packed-media-spawn", {
           recipe: "music-player/playback",
           values: { source: sourceDir, loop: false, player: "ffplay" },
         }, undefined, undefined, context);
         await waitForMusicTerminal();
         const wrapperSpawn = await spawn.execute("packed-wrapper-spawn", {
           file: wrapperPath,
           values: {},
         }, undefined, undefined, context);
         await waitForMusicTerminal();
         const musicInvocation = await musicPlayer.execute(
           "packed-music-call", {}, undefined, undefined, context,
         );
         const musicStatus = await inspect.execute("packed-music-status", {
           target: "tool:music_player",
           view: "status",
           verbose: true,
         }, undefined, undefined, context);
         const musicControl = await inspect.execute("packed-music-control", {
           target: "run:music-player",
           view: "control",
           verbose: true,
         }, undefined, undefined, context);
         const recipeStatus = await inspect.execute("packed-recipes-status", {
           target: "recipes",
           view: "status",
           verbose: true,
         }, undefined, undefined, context);
         const focusedDoctor = await inspect.execute("packed-recipes-doctor", {
           target: "recipes",
           view: "doctor",
           identity: "music-player/playback",
           verbose: true,
         }, undefined, undefined, context);
         let started;
         let control;
         let trace;
         try {
           started = await spawn.execute("packed-spawn", {
             as: "run:packed-locker",
             recipe: "actors/resource-locker",
             values: { lease_ms: 1000 },
           }, undefined, undefined, context);
           for (let attempt = 0; attempt < 200; attempt += 1) {
             control = await inspect.execute("packed-control", {
               target: "run:packed-locker",
               view: "control",
               verbose: true,
             }, undefined, undefined, context);
             if (control.details.endpoint) break;
             if (control.details.status !== "running") {
               let failure = "stderr unavailable";
               try {
                 failure = readFileSync(join(started.details.state_dir, "stderr.log"), "utf8").trim();
               } catch {}
               throw new Error("packed locker terminated before readiness: " + failure);
             }
             await new Promise((resolve) => setTimeout(resolve, 25));
           }
           if (!control?.details.endpoint) throw new Error("packed locker endpoint unavailable");
           trace = await inspect.execute("packed-trace", {
             target: "run:packed-locker", view: "trace", verbose: true,
           }, undefined, undefined, context);
           await message.execute("packed-stop", {
             target: "run:packed-locker",
             action: "stop",
             verbose: true,
           }, undefined, undefined, context);
           for (let attempt = 0; attempt < 200; attempt += 1) {
             control = await inspect.execute("packed-terminal", {
               target: "run:packed-locker",
               view: "control",
               verbose: true,
             }, undefined, undefined, context);
             if (control.details.status === "done") break;
             if (["failed", "cancelled", "killed"].includes(control.details.status)) {
               throw new Error("packed locker stopped as " + control.details.status);
             }
             await new Promise((resolve) => setTimeout(resolve, 25));
           }
         } finally {
           if (started && control?.details.status === "running") {
             await message.execute("packed-kill", {
               target: "run:packed-locker",
               action: "kill",
             }, undefined, undefined, context).catch(() => undefined);
           }
         }
         console.log(JSON.stringify({
           commands,
           packedRun: {
             controlPending: control.details.pending,
             endpoint: control.details.endpoint?.type,
             skillDir: started.details.values.skill_dir,
             status: control.details.status,
             traceComplete: trace.details.summary.history_complete,
           },
           registration: registration.details,
           invocation: invocation.content[0].text,
           music: {
             actorActions: musicControl.details.actor_actions,
             authoredWrapper,
             directLaunchKind: mediaSpawn.details.launch_kind,
             invocationLaunchKind: musicInvocation.details.launch_kind,
             registration: musicRegistration.details,
             schemaProperties: Object.keys(musicPlayer.parameters.properties).sort(),
             status: musicStatus.details,
             wrapperLaunchKind: wrapperSpawn.details.launch_kind,
           },
           recipeCatalog: recipeStatus.details,
           focusedDoctor: focusedDoctor.details,
           lifecycleEvents: [...handlers.keys()].sort(),
           resources,
           systemPrompt: startup.systemPrompt,
           tools,
         }));
       }).catch((error) => { console.error(error); process.exit(1); });`,
      packageDir,
      staleSkillDir,
      sourceDir,
    ], {
      env: {
        ...process.env,
        HOME: homeDir,
        PI_CODING_AGENT_DIR: agentDir,
        PATH: `${sourceDir}${delimiter}${process.env.PATH ?? ""}`,
        USERPROFILE: homeDir,
      },
    });
    assert.equal(stderr, "");
    assert.equal(pkg.version, JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")).version);
    assert.deepEqual(pkg.pi.extensions, ["./dist/pi-actors/index.js"]);
    assert.deepEqual(pkg.pi.skills, ["./dist/skills"]);
    assert.deepEqual(pkg.peerDependencies, {
      "@earendil-works/pi-coding-agent": ">=0.84.4",
      "@earendil-works/pi-tui": ">=0.84.4",
    });
    const loaded = JSON.parse(stdout);
    assert.equal(loaded.lifecycleEvents.includes("agent_settled"), true);
    assert.equal(loaded.lifecycleEvents.includes("agent_end"), false);
    assert.match(loaded.systemPrompt, /^base\n\npi-actors Skill routing:/);
    assert.match(loaded.systemPrompt, /load and read the actors Skill/);
    assert.match(loaded.systemPrompt, /multiple actors or subagents.*swarm Skill/);
    assert.match(loaded.systemPrompt, /Skill Recipe distinct from a registered tool/);
    assert.match(loaded.systemPrompt, /Recipe spawn distinct from registered-tool invocation/);
    assert.match(loaded.systemPrompt, /persistence or registration as distinct from current callability/);
    assert.match(loaded.systemPrompt, /preserve the logical Recipe identity, stop, and follow actors diagnosis/);
    assert.match(loaded.systemPrompt, /never bypass.*copied contracts, helper paths, shell evaluation, or background-process workarounds/);
    assert.doesNotMatch(
      loaded.systemPrompt,
      /min_successful|accept_output|retire_when|trace\.jsonl|controls\.jsonl|run\.json|\b(?:380|512|1,?024|2,?048|4 MiB)\b/,
    );
    assert.deepEqual(loaded.commands, ["actor-inspector"]);
    assert.deepEqual(
      {
        active_tool: loaded.registration.active_tool,
        activation: loaded.registration.activation,
        callable_now: loaded.registration.callable_now,
        host_registered: loaded.registration.host_registered,
        persisted: loaded.registration.persisted,
        registry_active: loaded.registration.registry_active,
        resolved: loaded.registration.resolved,
        validated: loaded.registration.validated,
      },
      {
        active_tool: true,
        activation: "current_session",
        callable_now: true,
        host_registered: true,
        persisted: true,
        registry_active: true,
        resolved: true,
        validated: true,
      },
    );
    assert.match(loaded.invocation, /packed-pong/);
    assert.deepEqual(
      {
        active_tool: loaded.music.registration.active_tool,
        activation: loaded.music.registration.activation,
        callable_now: loaded.music.registration.callable_now,
        host_registered: loaded.music.registration.host_registered,
        persisted: loaded.music.registration.persisted,
        registry_active: loaded.music.registration.registry_active,
        resolved: loaded.music.registration.resolved,
        validated: loaded.music.registration.validated,
      },
      {
        active_tool: true,
        activation: "current_session",
        callable_now: true,
        host_registered: true,
        persisted: true,
        registry_active: true,
        resolved: true,
        validated: true,
      },
    );
    assert.equal(loaded.music.registration.async, true);
    assert.equal(loaded.music.registration.source, "music-player/playback");
    assert.equal(loaded.music.registration.activation_boundary, "current_session");
    assert.deepEqual(loaded.music.registration.required_args, []);
    assert.deepEqual(loaded.music.registration.optional_args, [
      "source", "loop", "volume", "player", "transport_context",
    ]);
    assert.deepEqual(loaded.music.registration.next_actions, [
      "call tool music_player",
      "inspect target=tool:music_player view=status",
    ]);
    assert.equal("config" in loaded.music.registration, false);
    assert.equal("template" in loaded.music.registration, false);
    assert.deepEqual(loaded.music.actorActions, [
      "play", "pause", "resume", "toggle", "next", "previous", "seek", "volume", "stop", "status",
    ]);
    assert.deepEqual(loaded.music.authoredWrapper, {
      description: "Control local music from the maintained Music Player Recipe.",
      defaults: { loop: false, player: "ffplay", source: sourceDir },
      template: "music-player/playback",
    });
    assert.deepEqual(loaded.music.schemaProperties, [
      "loop", "player", "source", "transport_context", "volume",
    ]);
    assert.equal(loaded.music.directLaunchKind, "spawn");
    assert.equal(loaded.music.wrapperLaunchKind, "spawn");
    assert.equal(loaded.music.invocationLaunchKind, "tool");
    assert.equal(loaded.music.status.callable_now, true);
    assert.equal(loaded.music.status.activation_boundary, "current_session");
    assert.equal(loaded.music.status.source, "music-player/playback");
    assert.equal(loaded.music.status.persisted, true);
    assert.equal(loaded.music.status.registry_active, true);
    assert.deepEqual(loaded.music.status.required_args, []);
    assert.deepEqual(loaded.music.status.optional_args, [
      "source", "loop", "volume", "player", "transport_context",
    ]);
    assert.deepEqual(loaded.music.status.next_actions, ["call tool music_player"]);
    assert.equal(loaded.music.status.launch_kind, "tool");
    assert.equal(loaded.music.status.spawn_calls, 1);
    assert.equal(loaded.music.status.tool_calls, 1);
    assert.equal(loaded.focusedDoctor.identity, "music-player/playback");
    assert.equal(loaded.focusedDoctor.skill_active, true);
    assert.equal(loaded.focusedDoctor.resolvable, true);
    assert.equal(loaded.focusedDoctor.catalog_partial, true);
    assert.equal(loaded.focusedDoctor.component_status, "available");
    assert.equal(loaded.focusedDoctor.source_location, "<active-skill:music-player>/playback.json");
    assert.equal(typeof loaded.focusedDoctor.resolution_generation, "string");
    assert.deepEqual(loaded.focusedDoctor.next_actions, [
      "spawn recipe=music-player/playback",
      "register_tool name=<tool-name> from=music-player/playback",
    ]);
    assert.equal(loaded.recipeCatalog.registry_generation, 1);
    assert.equal(loaded.recipeCatalog.skill_recipe_catalog_partial, true);
    assert.equal(
      loaded.recipeCatalog.skill_recipe_components.some(
        (component: any) => component.identity === "music-player/playback",
      ),
      true,
    );
    assert.match(
      loaded.recipeCatalog.skill_recipe_component_diagnostics[0].error,
      /Recipe\.name was removed/,
    );
    assert.doesNotMatch(
      JSON.stringify(loaded.music.authoredWrapper),
      /skill_dir|state_dir|control|artifacts|bash -lc|risk\.shell|risk\.eval/,
    );
    assert.equal(loaded.packedRun.endpoint, process.platform === "win32" ? "named-pipe" : "fifo");
    assert.equal(
      await realpath(loaded.packedRun.skillDir),
      await realpath(join(packageDir, "dist", "skills", "actors")),
    );
    assert.equal(loaded.packedRun.status, "done");
    assert.equal(loaded.packedRun.traceComplete, true);
    assert.equal(loaded.packedRun.controlPending, 0);
    assert.equal(loaded.resources.skillPaths.length, 1);
    assert.equal(loaded.resources.skillPaths[0].replaceAll("\\", "/").endsWith("/dist/skills"), true);
    assert.deepEqual(loaded.tools.map((tool: any) => tool.name), [
      "register_tool",
      "spawn",
      "message",
      "inspect",
      "packed_ping",
      "music_player",
    ]);
    assert.deepEqual(loaded.tools.map((tool: any) => tool.properties), [
      ["args", "async", "defaults", "description", "draft", "from", "name", "template", "update"],
      ["artifacts", "as", "file", "recipe", "template", "transport_context", "values", "verbose"],
      ["action", "input", "target", "verbose"],
      ["identity", "lines", "source", "status", "target", "verbose", "view"],
      [],
      ["loop", "player", "source", "transport_context", "volume"],
    ]);
    const expectedDescriptions: Record<string, string> = {
      actors: "Use for any non-trivial pi-actors operation, diagnosis, or development involving Recipes, persistent tools, Runs, spawn, message, inspect, Trace, Control, capability specialization, or activation.",
      artifacts: "Use when an actor workflow must write reusable files, reports, manifests, or bundles with deterministic paths and declared outputs.",
      "music-player": "Use for starting, resuming, inspecting, and controlling one persistent local music playback actor from caller-approved files, directories, URLs, or playlists.",
      "project-work": "Use for repository health inspection, project summaries, documentation maintenance, release-readiness evidence, or bounded run-operation reports.",
      "recipe-memory": "Use only for internal automatic Recipe-memory review, diagnosis, or recovery; do not use for normal Recipe creation, registration, or invocation.",
      swarm: "Use when work needs multiple actors or subagents for independent implementation, artifact generation, review, delegated audit, research, or coordinated decomposition and integration.",
    };
    for (const [skill, description] of Object.entries(expectedDescriptions)) {
      const body = await readFile(join(packageDir, "dist", "skills", skill, "SKILL.md"), "utf8");
      assert.match(body, new RegExp(`^---\\r?\\nname: ${skill}\\r?$`, "m"));
      assert.equal(body.match(/^description:\s*(.+)$/m)?.[1], description);
    }
    for (const reference of [
      "actors/references/diagnostics.md",
      "actors/references/persistent-tools.md",
      "actors/references/recipes.md",
      "actors/references/runs.md",
      "swarm/references/development-swarm.md",
      "swarm/references/review-swarms.md",
    ]) {
      await access(join(packageDir, "dist", "skills", reference));
    }
    await assert.rejects(access(join(packageDir, ".agents")));
    const sourcePlayer = JSON.parse(
      await readFile(join(process.cwd(), "skills", "music-player", "recipes", "playback.json"), "utf8"),
    );
    const expectedSchema = [
      ...sourcePlayer.args
        .map((arg: string) => arg.split(":", 1)[0])
        .filter((arg: string) => arg !== "state_dir"),
      "transport_context",
    ].sort();
    assert.deepEqual(loaded.music.schemaProperties, expectedSchema);
    assert.doesNotMatch(stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
  } finally {
    await removeTreeEventually(root);
  }
});

test("installed dist enforces the same bounded Trace, Control, and inspect contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-bounds-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const { stdout, stderr } = await execFileAsync(process.execPath, ["-e", `
      const { mkdtempSync, statSync } = require("node:fs");
      const { tmpdir } = require("node:os");
      const { join } = require("node:path");
      const { pathToFileURL } = require("node:url");
      const packageDir = process.argv[1];
      Promise.all(["limits", "runs-controls", "runs-trace", "tools-inspect"].map((name) =>
        import(pathToFileURL(join(packageDir, "dist", "lib", name + ".js")).href))).then(async ([limits, controls, trace, inspect]) => {
        const stateDir = mkdtempSync(join(tmpdir(), "pi-actors-installed-kernel-"));
        const status = { control: ["pause"], ownerId: "owner-a", run: "installed",
          run_instance_id: "generation-a", state_dir: stateDir, status: "running" };
        for (let index = 0; index <= limits.TRACE_JOURNAL_MAX_EVENTS; index++)
          trace.appendRunTraceEvent(stateDir, { kind: "installed.pressure", data: { index } });
        for (let index = 0; index < limits.RUN_CONTROL_PENDING_LIMIT; index++)
          controls.appendRunControlInStateDir(stateDir, { action: "pause", input: { index }, run_instance_id: "generation-a" });
        let reason;
        try { controls.appendRunControlInStateDir(stateDir, { action: "pause", run_instance_id: "generation-a" }); }
        catch (error) { reason = error.reason; }
        const tool = inspect.createInspectToolDefinition({ getRunStatus: () => status });
        const context = { sessionManager: { getSessionId: () => "owner-a" } };
        const traceView = await tool.execute("trace", { target: "run:installed", view: "trace", verbose: true }, undefined, undefined, context);
        const controlView = await tool.execute("control", { target: "run:installed", view: "control", verbose: true }, undefined, undefined, context);
        console.log(JSON.stringify({ reason, trace: traceView.details.summary, control: {
          available: controlView.details.available, backpressured: controlView.details.backpressured,
          pending: controlView.details.pending }, traceBytes: statSync(join(stateDir, "trace.jsonl")).size,
          controlBytes: statSync(join(stateDir, "controls.jsonl")).size }));
      }).catch((error) => { console.error(error); process.exit(1); });`, packageDir]);
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.reason, "control_backpressure");
    assert.equal(result.trace.history_complete, false);
    assert.equal(result.trace.compacted, true);
    assert.equal(result.control.pending, 64);
    assert.equal(result.control.available, 0);
    assert.equal(result.control.backpressured, true);
    assert.ok(result.traceBytes <= 4 * 1024 * 1024);
    assert.ok(result.controlBytes <= 1024 * 1024);
  } finally {
    await removeTreeEventually(root);
  }
});

test("installed extension entrypoint imports compiled dist runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-entry-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "-e",
      `const { readFileSync } = require("node:fs");
       const { join } = require("node:path");
       const { pathToFileURL } = require("node:url");
       const packageDir = process.argv[1];
       const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
       const entry = join(packageDir, pkg.pi.extensions[0]);
       import(pathToFileURL(entry).href).then((mod) => {
         if (typeof mod.default !== "function") throw new Error("extension default export missing");
         console.log("installed extension ok");
       }).catch((error) => {
         console.error(error.code || error.name, error.message);
         process.exit(1);
       });`,
      packageDir,
    ]);
    assert.match(stdout, /installed extension ok/);
    assert.doesNotMatch(stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("music-player direct control rejects a terminal Run before journal admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-music-control-"));
  const stateDir = join(root, "music");
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "run.json"),
      JSON.stringify({ run: "music", run_instance_id: "generation-a" }),
    );
    await writeFile(
      join(stateDir, "result.json"),
      JSON.stringify({ code: 0, completedAt: new Date().toISOString() }),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [
        join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
        "next",
        stateDir,
      ]),
      /Run playback is not active/,
    );
    assert.equal(await readTextIfExists(join(stateDir, "controls.jsonl")), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("music-player ships a capability-owned optional Generative App", async () => {
  const adapter = join(
    process.cwd(),
    "skills",
    "music-player",
    "genapps",
    "music-player.mjs",
  );
  await execFileAsync(process.execPath, ["--check", adapter]);
  const source = await readFile(adapter, "utf8");
  assert.doesNotMatch(source, /pi-telegram|pi-actors|run\.json|controls\.jsonl/);
  assert.match(source, /playback\.mjs/);
  assert.match(source, /actor_available/);
  assert.match(source, /export async function play[\s\S]*apply\("resume", context\)/);
  assert.match(source, /\[0, 15, 30, 45, 60, 75, 90\]/);
});

test("music-player standalone service uses only the neutral playback protocol", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-music-standalone-"));
  const stateDir = join(root, "music");
  const source = join(root, "silence.wav");
  const fakePlayer = join(root, process.platform === "win32" ? "ffplay.exe" : "ffplay");
  await mkdir(stateDir, { recursive: true });
  await writeFile(source, "audio fixture", "utf8");
  if (process.platform === "win32") {
    const sourceFile = join(root, "fake-player.cs");
    await writeFile(
      sourceFile,
      "using System.Threading; public class Program { public static void Main(string[] args) { Thread.Sleep(30000); } }\n",
      "utf8",
    );
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -Path '${sourceFile.replaceAll("'", "''")}' -OutputAssembly '${fakePlayer.replaceAll("'", "''")}' -OutputType ConsoleApplication`,
    ]);
  } else {
    await writeFile(fakePlayer, "#!/bin/sh\nexec sleep 30\n", "utf8");
    await chmod(fakePlayer, 0o755);
  }
  const service = join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs");
  const client = join(root, "playback.mjs");
  await cp(service, client);
  const env = { ...process.env, PATH: `${root}${delimiter}${process.env.PATH ?? ""}` };
  await assert.rejects(
    execFileAsync(process.execPath, [client, "control", stateDir, "start"], { env }),
    /unsupported command: start/,
  );
  const child = spawn(
    process.execPath,
    [client, "serve", source, "false", "70", "ffplay", stateDir],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await waitForText(join(stateDir, "playback-endpoint.json"), /service_instance_id/);
    const endpointPath = join(stateDir, "playback-endpoint.json");
    const endpoint = await readFile(endpointPath, "utf8");
    await writeFile(endpointPath, JSON.stringify({ ...JSON.parse(endpoint), service_instance_id: "stale" }));
    await assert.rejects(
      execFileAsync(process.execPath, [client, "control", stateDir, "pause"], { env }),
      /invalid playback protocol command/,
    );
    await writeFile(endpointPath, endpoint);
    await assert.rejects(
      execFileAsync(process.execPath, [client, "control", stateDir, "volume", "101"], { env }),
      /percent/,
    );
    await execFileAsync(process.execPath, [client, "control", stateDir, "pause"], { env });
    const paused = JSON.parse(
      (await execFileAsync(process.execPath, [client, "status", stateDir], { env })).stdout,
    );
    assert.equal(paused.state, "paused");
    await execFileAsync(process.execPath, [client, "control", stateDir, "play"], { env });
    await execFileAsync(process.execPath, [client, "stop", stateDir], { env });
    const code = await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("standalone playback did not stop")), 5000),
      ),
    ]);
    assert.equal(code, 0);
    assert.equal(await readTextIfExists(join(stateDir, "run.json")), "");
    assert.equal(await readTextIfExists(join(stateDir, "controls.jsonl")), "");
    assert.equal(await readTextIfExists(join(stateDir, "trace.jsonl")), "");
    assert.equal(await readTextIfExists(join(stateDir, "control-endpoint.json")), "");

    const standalone = spawn(
      process.execPath,
      [client, "serve", source, "false", "70", "ffplay", stateDir],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForText(
      join(stateDir, "playback-endpoint.json"),
      /"owner_mode": "standalone"/,
    );
    await writeFile(
      join(stateDir, "run.json"),
      JSON.stringify({ run: "music-player", run_instance_id: "generation-a" }),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [
        service,
        "play",
        source,
        "false",
        "70",
        "ffplay",
        stateDir,
      ], { env }),
      /standalone playback service already owns state/,
    );
    await execFileAsync(process.execPath, [client, "stop", stateDir], { env });
    await new Promise((resolve) => standalone.once("exit", resolve));
    const filesBeforeStatus = (await readdir(stateDir)).sort();
    const stopped = JSON.parse((await execFileAsync(process.execPath,
      [client, "control", stateDir, "status"], { env })).stdout);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.actor_available, false);
    assert.deepEqual((await readdir(stateDir)).sort(), filesBeforeStatus);
    await assert.rejects(
      execFileAsync(process.execPath, [client, "control", stateDir, "resume"], { env }),
      /Run playback is not active/,
    );
    assert.equal(await readTextIfExists(join(stateDir, "controls.jsonl")), "");
    assert.equal(await readTextIfExists(join(stateDir, "trace.jsonl")), "");
  } finally {
    child.kill("SIGKILL");
    await removeTreeEventually(root);
  }
});

test("music-player checkpoints and resumes its resolved playlist index", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-music-checkpoint-"));
  const stateDir = join(root, "music");
  const sourceDir = join(root, "source");
  const fakePlayer = join(root, process.platform === "win32" ? "ffplay.exe" : "ffplay");
  await mkdir(stateDir, { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(stateDir, "run.json"), JSON.stringify({ run: "music-player", run_instance_id: "generation-a" }));
  await writeFile(join(sourceDir, "one.wav"), "one");
  await writeFile(join(sourceDir, "two.wav"), "two");
  if (process.platform === "win32") {
    const sourceFile = join(root, "fake-player.cs");
    await writeFile(sourceFile, "public class Program { public static void Main(string[] args) {} }\n");
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -Path '${sourceFile.replaceAll("'", "''")}' -OutputAssembly '${fakePlayer.replaceAll("'", "''")}' -OutputType ConsoleApplication`,
    ]);
  } else {
    await writeFile(fakePlayer, "#!/bin/sh\nexit 0\n");
    await chmod(fakePlayer, 0o755);
  }
  const args = [
    join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
    "play", sourceDir, "false", "70", "ffplay", stateDir,
  ];
  const env = { ...process.env, PATH: `${root}${delimiter}${process.env.PATH ?? ""}` };
  try {
    await execFileAsync(process.execPath, args, { env });
    const checkpoint = JSON.parse(await readFile(join(stateDir, "playback.json"), "utf8"));
    assert.equal(checkpoint.source, sourceDir);
    assert.equal(checkpoint.tracks.length, 2);
    assert.equal(checkpoint.index, 1);
    assert.equal(checkpoint.volume, 70);
    const resumed = await execFileAsync(process.execPath, args, { env });
    assert.match(resumed.stderr, /checkpoint=resumed start_index=1/);
    await writeFile(join(stateDir, "playback.json"), "{truncated", "utf8");
    const recovered = await execFileAsync(process.execPath, args, { env });
    assert.match(recovered.stderr, /checkpoint_recovery=invalid-json/);
    assert.match(recovered.stderr, /checkpoint=recovered start_index=0/);
    assert.match(
      await readFile(join(stateDir, "trace.jsonl"), "utf8"),
      /"kind":"player\.checkpoint-recovered"/,
    );
    const invalidIndexCheckpoint = JSON.parse(
      await readFile(join(stateDir, "playback.json"), "utf8"),
    );
    invalidIndexCheckpoint.index = "not-an-index";
    await writeFile(
      join(stateDir, "playback.json"),
      JSON.stringify(invalidIndexCheckpoint),
      "utf8",
    );
    const invalidIndex = await execFileAsync(process.execPath, args, { env });
    assert.match(invalidIndex.stderr, /checkpoint_recovery=invalid-shape/);
    assert.match(invalidIndex.stderr, /checkpoint=recovered start_index=0/);
    const status = JSON.parse((await execFileAsync(process.execPath, [args[0], "status", stateDir])).stdout);
    assert.equal(status.state, "stopped");
    assert.equal(status.volume, 70);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("music-player restores a paused checkpoint without resuming intent", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX signal fixture");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "pi-actors-music-paused-"));
  const stateDir = join(root, "music");
  const source = join(root, "track.wav");
  const fakePlayer = join(root, "ffplay");
  await mkdir(stateDir, { recursive: true });
  await writeFile(source, "audio fixture");
  await writeFile(fakePlayer, "#!/bin/sh\nexec sleep 30\n");
  await chmod(fakePlayer, 0o755);
  await writeFile(
    join(stateDir, "run.json"),
    JSON.stringify({ run: "music-player", run_instance_id: "generation-a" }),
  );
  const args = [
    join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
    "play", source, "true", "70", "ffplay", stateDir,
  ];
  const env = { ...process.env, PATH: `${root}${delimiter}${process.env.PATH ?? ""}` };
  const first = spawn(process.execPath, args, { env, stdio: "ignore" });
  let second: ReturnType<typeof spawn> | undefined;
  try {
    await waitForText(join(stateDir, "player.json"), /"state":"playing"/);
    await deliverRunControl("music-player", stateDir, {
      action: "pause",
      run_instance_id: "generation-a",
    });
    const paused = JSON.parse(
      await waitForText(join(stateDir, "player.json"), /"state":"paused"/),
    );
    const pausedCheckpoint = JSON.parse(
      await waitForText(join(stateDir, "playback.json"), /"state":\s*"paused"/),
    );
    assert.equal(pausedCheckpoint.state, "paused");
    first.kill("SIGKILL");
    process.kill(Number(paused.pid), "SIGKILL");
    await new Promise((resolve) => first.once("exit", resolve));
    second = spawn(process.execPath, args, { env, stdio: "ignore" });
    const deadline = Date.now() + 5000;
    let restored: { state?: string } | undefined;
    while (Date.now() < deadline) {
      const text = await readTextIfExists(join(stateDir, "player.json"));
      if (text) {
        const candidate = JSON.parse(text);
        if (candidate.state === "paused" && candidate.pid !== paused.pid) {
          restored = candidate;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(restored?.state, "paused");
  } finally {
    first.kill("SIGKILL");
    second?.kill("SIGTERM");
    await removeTreeEventually(root);
  }
});

test("music-player consumes publicly delivered Controls", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-music-delivery-"));
  const stateDir = join(root, "music");
  const source = join(root, "silence.wav");
  const fakePlayer = join(root, process.platform === "win32" ? "ffplay.exe" : "ffplay");
  const fakeWpctl = join(root, "wpctl");
  const fakeFfprobe = join(root, "ffprobe");
  const playerLog = join(root, "ffplay.log");
  const wpctlLog = join(root, "wpctl.log");
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, "run.json"),
    JSON.stringify({ run: "music", run_instance_id: "generation-a" }),
  );
  await writeFile(source, "audio fixture", "utf8");
  if (process.platform === "win32") {
    const sourceFile = join(root, "fake-player.cs");
    await writeFile(
      sourceFile,
      "using System; using System.Threading; public class Program { public static void Main(string[] args) { Thread.Sleep(30000); } }\n",
      "utf8",
    );
    const quotedSource = sourceFile.replaceAll("'", "''");
    const quotedPlayer = fakePlayer.replaceAll("'", "''");
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -Path '${quotedSource}' -OutputAssembly '${quotedPlayer}' -OutputType ConsoleApplication`,
    ]);
  } else {
    await writeFile(
      fakePlayer,
      "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$FFPLAY_LOG_FILE\"\nexec sleep 30\n",
      "utf8",
    );
    await chmod(fakePlayer, 0o755);
    await writeFile(fakeFfprobe, "#!/bin/sh\nprintf '100\\n'\n", "utf8");
    await chmod(fakeFfprobe, 0o755);
    await writeFile(
      fakeWpctl,
      `#!/bin/sh
case "$1:$2" in
  status:-n) printf 'Audio\\n └─ Streams:\\n        88. ffplay\\n\\nVideo\\n' ;;
  inspect:88) printf '  * client.id = "99"\\n  * media.class = "Stream/Output/Audio"\\n' ;;
  inspect:99) printf '    application.process.id = "%s"\\n' "$(cat "$WPCTL_PID_FILE")" ;;
  set-volume:88) printf '%s %s\\n' "$2" "$3" >> "$WPCTL_LOG_FILE" ;;
  *) exit 1 ;;
esac
`,
      "utf8",
    );
    await chmod(fakeWpctl, 0o755);
  }
  let playbackPid: number | undefined;
  const playbackPids = new Set<number>();
  let childOutput = "";
  const child = spawn(
    process.execPath,
    [join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"), "play", source, "false", "70", "ffplay", stateDir],
    {
      env: {
        ...process.env,
        FFPLAY_LOG_FILE: playerLog,
        PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
        WPCTL_LOG_FILE: wpctlLog,
        WPCTL_PID_FILE: join(stateDir, "current.pid"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => { childOutput += String(chunk); });
  child.stderr.on("data", (chunk) => { childOutput += String(chunk); });
  try {
    await waitForText(join(stateDir, "control-endpoint.json"), /run_instance_id/);
    await waitForText(join(stateDir, "playback-endpoint.json"), /service_instance_id/);
    await waitForText(join(stateDir, "player.json"), /"state":"playing"/);
    await assert.rejects(
      execFileAsync(process.execPath, [
        join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
        "serve",
        source,
        "false",
        "70",
        "ffplay",
        stateDir,
      ], { env: { ...process.env, PATH: `${root}${delimiter}${process.env.PATH ?? ""}` } }),
      /active playback service already owns state/,
    );
    const initialPlayerState = JSON.parse(
      await waitForText(
        join(stateDir, "player.json"),
        /"pid":"\d+","updated_at":"[^"]+"}\s*$/,
      ),
    );
    playbackPid = Number(initialPlayerState.pid);
    playbackPids.add(playbackPid);
    const controlsBeforeClient = await readTextIfExists(join(stateDir, "controls.jsonl"));
    const client = join(
      process.cwd(),
      "skills",
      "music-player",
      "scripts",
      "playback.mjs",
    );
    const app = await import(pathToFileURL(join(process.cwd(), "skills", "music-player", "genapps", "music-player.mjs")).href);
    const run = async ({ command, args, cwd, timeoutMs }: {
      command: string; args: string[]; cwd: string; timeoutMs: number;
    }) => {
      assert.equal(args[0], client);
      assert.equal(args[1], "control");
      assert.equal(args[2], stateDir);
      const result = await execFileAsync(command, args, {
        cwd, timeout: timeoutMs,
        env: {
          ...process.env,
          PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
          WPCTL_LOG_FILE: wpctlLog,
          WPCTL_PID_FILE: join(stateDir, "current.pid"),
        },
      });
      return { code: 0, ...result };
    };
    const initialView = await app.init({ argument: { control: client, stateDir, node: process.execPath }, run });
    assert.equal(initialView.state.playback.actorAvailable, true);
    const volumeView = await app.volume({ argument: 62, state: initialView.state, run });
    assert.equal(volumeView.state.playback.volume, 62);
    const clientVolumeState = JSON.parse(
      await waitForText(join(stateDir, "player.json"), /"volume":62/),
    );
    if (process.platform === "win32") {
      playbackPids.add(Number(clientVolumeState.pid));
    }
    const controlsAfterClient = await readTextIfExists(join(stateDir, "controls.jsonl"));
    assert.notEqual(controlsAfterClient, controlsBeforeClient);
    assert.match(controlsAfterClient, /"action":"volume".*"percent":62.*"status":"handled"/);
    const clientStatus = JSON.parse(
      (await execFileAsync(process.execPath, [client, "status", stateDir])).stdout,
    );
    assert.equal(clientStatus.volume, 62);
    if (process.platform === "win32") {
      assert.equal(clientStatus.progress_percent, null);
    } else {
      assert.equal(Number.isInteger(clientStatus.progress_percent), true);
    }
    await deliverRunControl("music", stateDir, {
      action: "volume",
      input: { percent: 63 },
      run_instance_id: "generation-a",
    });
    await waitForText(
      join(stateDir, "controls.jsonl"),
      /"action":"volume".*"status":"handled"/,
    );
    const volumeState = JSON.parse(
      await waitForText(
        join(stateDir, "player.json"),
        /"volume":63.*"updated_at":"[^"]+"}\s*$/,
      ),
    );
    if (process.platform === "linux") {
      assert.equal(Number(volumeState.pid), playbackPid);
      assert.equal(await readFile(wpctlLog, "utf8"), "88 62%\n88 63%\n");
    } else {
      playbackPid = Number(volumeState.pid);
      playbackPids.add(playbackPid);
    }
    await deliverRunControl("music", stateDir, {
      action: "volume",
      input: { percent: 101 },
      run_instance_id: "generation-a",
    });
    await waitForText(
      join(stateDir, "controls.jsonl"),
      /"action":"volume".*"percent":101.*"status":"failed"/,
    );
    if (process.platform !== "win32") {
      await deliverRunControl("music", stateDir, {
        action: "seek",
        input: { percent: 40 },
        run_instance_id: "generation-a",
      });
      await waitForText(
        join(stateDir, "controls.jsonl"),
        /"action":"seek".*"status":"handled"/,
      );
      const seekState = JSON.parse(
        await waitForText(
          join(stateDir, "player.json"),
          /"seek_percent":40.*"pid":"\d+","updated_at":"[^"]+"}\s*$/,
        ),
      );
      assert.notEqual(Number(seekState.pid), playbackPid);
      await waitForText(playerLog, /-ss 40/);
      playbackPid = Number(seekState.pid);
    }
    await execFileAsync(process.execPath, [
      join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
      "pause",
      stateDir,
    ]);
    try {
      await waitForText(join(stateDir, "controls.jsonl"), /"action":"pause".*"status":"handled"/);
    } catch (error) {
      const controls = await readTextIfExists(join(stateDir, "controls.jsonl"));
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `child_exit=${child.exitCode ?? "running"}; child_signal=${child.signalCode ?? "none"}; ` +
        `controls=${JSON.stringify(controls.slice(-2000))}; output=${JSON.stringify(childOutput.slice(-2000))}`,
      );
    }
    const pausedStatus = JSON.parse((await execFileAsync(process.execPath, [
      join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
      "status",
      stateDir,
    ])).stdout);
    assert.equal(pausedStatus.state, "paused");
    if (process.platform === "win32") {
      assert.equal(pausedStatus.progress_percent, null);
    } else {
      assert.equal(Number.isInteger(pausedStatus.progress_percent), true);
      assert.ok(pausedStatus.progress_percent >= 0 && pausedStatus.progress_percent <= 100);
    }
    await execFileAsync(process.execPath, [
      join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
      "volume",
      stateDir,
      "57",
    ]);
    await waitForText(
      join(stateDir, "controls.jsonl"),
      /"action":"volume".*"percent":57.*"status":"handled"/,
    );
    await waitForText(
      join(stateDir, "player.json"),
      /"state":"paused".*"volume":57.*"updated_at":"[^"]+"}\s*$/,
    );
    const controlsBeforeInvalidVolume = await readFile(
      join(stateDir, "controls.jsonl"),
      "utf8",
    );
    await assert.rejects(
      execFileAsync(process.execPath, [
        join(process.cwd(), "skills", "music-player", "scripts", "playback.mjs"),
        "volume",
        stateDir,
        "101",
      ]),
      /volume percent must be an integer 0\.\.100/,
    );
    assert.equal(
      await readFile(join(stateDir, "controls.jsonl"), "utf8"),
      controlsBeforeInvalidVolume,
    );
    const action = process.platform === "win32" ? "status" : "stop";
    const stopStartedAt = Date.now();
    await deliverRunControl("music", stateDir, {
      action,
      run_instance_id: "generation-a",
    });
    try {
      await waitForText(join(stateDir, "controls.jsonl"), new RegExp(`"action":"${action}".*"status":"handled"`));
    } catch (error) {
      const controls = await readTextIfExists(join(stateDir, "controls.jsonl"));
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `child_exit=${child.exitCode ?? "running"}; child_signal=${child.signalCode ?? "none"}; ` +
        `controls=${JSON.stringify(controls.slice(-2000))}; output=${JSON.stringify(childOutput.slice(-2000))}`,
      );
    }
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      const code = await Promise.race([
        new Promise<number | null>((resolve) => child.once("exit", resolve)),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("music-player did not stop")), 5000),
        ),
      ]);
      assert.equal(code, 0);
      assert.ok(Date.now() - stopStartedAt < 2500, "music-player stop must beat natural fixture exit");
    }
    const controls = (await readFile(join(stateDir, "controls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const pauseControl = controls.find((control) => control.action === "pause");
    assert.equal(pauseControl?.status, "handled");
    assert.equal(Object.hasOwn(pauseControl ?? {}, "delivered_at"), false);
    const seekControl = controls.find((control) => control.action === "seek");
    if (process.platform !== "win32") {
      assert.deepEqual(seekControl?.input, { percent: 40 });
      assert.equal(seekControl?.status, "handled");
    }
    const volumeControls = controls.filter((control) => control.action === "volume");
    assert.deepEqual(volumeControls.map((control) => control.input), [
      { percent: 62 },
      { percent: 63 },
      { percent: 101 },
      { percent: 57 },
    ]);
    assert.deepEqual(volumeControls.map((control) => control.status), [
      "handled",
      "handled",
      "failed",
      "handled",
    ]);
    assert.equal(Object.hasOwn(volumeControls[0] ?? {}, "delivered_at"), false);
    assert.equal(typeof volumeControls[1]?.delivered_at, "string");
    assert.match(volumeControls[2]?.error ?? "", /integer 0\.\.100/);
    assert.equal(Object.hasOwn(volumeControls[3] ?? {}, "delivered_at"), false);
    const volumeTrace = await readFile(join(stateDir, "trace.jsonl"), "utf8");
    assert.match(volumeTrace, /"kind":"player\.volume"/);
    assert.match(volumeTrace, /"percent":57/);
    const delivered = controls.find((control) => control.action === action);
    assert.equal(delivered?.status, "handled");
    assert.equal(typeof delivered?.delivered_at, "string");
  } finally {
    if (process.platform === "win32") {
      const quotedPlayer = fakePlayer.replaceAll("'", "''");
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$target = '${quotedPlayer}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ]).catch(() => {});
      for (const pid of playbackPids) {
        await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
      }
    }
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    await removeTreeEventually(root);
  }
});

test("installed async-runner avoids importing TypeScript from node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-runner-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const stateDir = join(root, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "run.json"),
      `${JSON.stringify({
        run: "installed-runner",
        state_dir: stateDir,
        status: "running",
        template: `${process.execPath} -e "console.log('installed async ok')"`,
        values: {
          run_id: "installed-runner",
          state_dir: stateDir,
          trace_file: join(stateDir, "trace.jsonl"),
        },
      })}\n`,
    );
    await execFileAsync(process.execPath, [
      join(packageDir, "scripts", "async-runner.mjs"),
      stateDir,
    ]);
    const result = JSON.parse(await readFile(join(stateDir, "result.json"), "utf8"));
    assert.equal(result.code, 0);
    assert.doesNotMatch(
      await readTextIfExists(join(stateDir, "stderr.log")),
      /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/,
    );
    assert.match(await readFile(join(stateDir, "stdout.log"), "utf8"), /installed async ok/);
    assert.equal(await readTextIfExists(join(stateDir, ".type-strip-lib", "async-runner.ts")), "");
    assert.equal(await readTextIfExists(join(stateDir, ".type-strip-lib", "execution.ts")), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed validate-recipe avoids importing TypeScript from node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-validator-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const recipe = join(root, "recipe.json");
    await writeFile(recipe, `${JSON.stringify({ template: "echo ok" })}\n`);
    const { stdout } = await execFileAsync(process.execPath, [
      join(packageDir, "skills", "actors", "scripts", "validate-recipe.mjs"),
      recipe,
    ]);
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.equal(report.passed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed Skill Recipe QA matches the source capability inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-validator-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const args = ["--skills", "--qa", "--summary"];
    const source = await execFileAsync(process.execPath, [
      join(process.cwd(), "skills", "actors", "scripts", "validate-recipe.mjs"),
      join(process.cwd(), "skills"),
      ...args,
    ]);
    const installed = await execFileAsync(process.execPath, [
      join(packageDir, "skills", "actors", "scripts", "validate-recipe.mjs"),
      join(packageDir, "skills"),
      ...args,
    ]);
    assert.deepEqual(JSON.parse(installed.stdout), JSON.parse(source.stdout));
    assert.equal(JSON.parse(installed.stdout).total, 55);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packed extension presents explicit steer before its exact completion epoch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-packed-delivery-"));
  try {
    const packageDir = await preparePackedPackage(root);
    const agentDir = join(root, "agent");
    const runDir = join(agentDir, "tmp", "pi-actors", "runs", "packed-run");
    await mkdir(runDir, { recursive: true });
    const timestamp = new Date().toISOString();
    await writeFile(join(runDir, "run.json"), JSON.stringify({
      createdAt: timestamp,
      cwd: packageDir,
      notification_policy: "normal",
      ownerId: "packed-owner",
      pid: 999_999,
      run: "packed-run",
      run_instance_id: "11111111-1111-4111-8111-111111111111",
      state_dir: runDir,
    }));
    await writeFile(join(runDir, "result.json"), JSON.stringify({
      code: 0,
      finished_at: timestamp,
    }));
    await writeFile(join(runDir, "trace.jsonl"), `${JSON.stringify({
      attention: "steer",
      id: "packed-steer-event",
      kind: "checkpoint.ready",
      level: "info",
      summary: "Inspect the packed delivery boundary.",
      ts: timestamp,
    })}\n`);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "-e",
      `const { readFileSync } = require("node:fs");
       const { join } = require("node:path");
       const { pathToFileURL } = require("node:url");
       const packageDir = process.argv[1];
       import(pathToFileURL(join(packageDir, "dist", "pi-actors", "index.js")).href).then(async (mod) => {
         const handlers = new Map();
         const sent = [];
         const pi = {
           getActiveTools: () => [],
           getAllTools: () => [],
           getThinkingLevel: () => "off",
           on: (name, handler) => handlers.set(name, handler),
           registerCommand: () => {},
           registerTool: () => {},
           sendMessage: (message, options) => sent.push({ message, options }),
           setActiveTools: () => {},
         };
         mod.default(pi);
         const context = {
           cwd: packageDir,
           hasUI: true,
           isIdle: () => true,
           sessionManager: {
             getEntry: () => undefined,
             getLeafEntry: () => undefined,
             getSessionId: () => "packed-owner",
           },
           ui: {
             notify: () => {},
             setStatus: () => {},
             setWidget: () => {},
             theme: { bold: (value) => value, fg: (_name, value) => value },
           },
         };
         await handlers.get("session_start")({}, context);
         if (sent[0]?.options?.deliverAs !== "steer") throw new Error("packed steer was not first");
         await handlers.get("context")({ messages: [sent[0].message] }, context);
         await handlers.get("agent_settled")({}, context);
         if (sent[1]?.options?.deliverAs !== "followUp") throw new Error("packed completion was not second");
         await handlers.get("context")({ messages: [sent[1].message] }, context);
         await handlers.get("session_shutdown")({}, context);
         const runDir = join(process.env.PI_CODING_AGENT_DIR, "tmp", "pi-actors", "runs", "packed-run");
         const handled = JSON.parse(readFileSync(join(runDir, "terminal-handled.json"), "utf8"));
         const trace = readFileSync(join(runDir, "trace.jsonl"), "utf8");
         console.log(JSON.stringify({
           completionType: sent[1].message.customType,
           handledGeneration: handled.run_instance_id,
           steerMarker: trace.includes("delivery.steer_presented"),
           steerType: sent[0].message.customType,
         }));
       }).catch((error) => { console.error(error); process.exit(1); });`,
      packageDir,
    ], {
      env: {
        ...process.env,
        HOME: root,
        PI_CODING_AGENT_DIR: agentDir,
        USERPROFILE: root,
      },
    });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), {
      completionType: "pi-actors-run-batch",
      handledGeneration: "11111111-1111-4111-8111-111111111111",
      steerMarker: true,
      steerType: "pi-actors-run-steer",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed validate-recipe resolves explicit file imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-installed-imports-"));
  try {
    const packageDir = await prepareInstalledPackage(root);
    const recipe = join(root, "recipe.json");
    await writeFile(
      recipe,
      `${JSON.stringify({
        imports: { status: join(packageDir, "skills", "project-work", "recipes", "git-status.json") },
        template: [{ name: "status" }],
      })}\n`,
    );
    const { stdout } = await execFileAsync(process.execPath, [
      join(packageDir, "skills", "actors", "scripts", "validate-recipe.mjs"),
      recipe,
    ]);
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.equal(report.passed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
