/**
 * Packaged skill regressions
 * Ensures extension-owned skills remain discoverable and self-contained
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };

const packagedSkillPaths = readdirSync("skills", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("skills", entry.name, "SKILL.md").replaceAll("\\", "/"))
  .sort();

function listMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function readSkillFrontmatter(path: string): string {
  const content = readFileSync(path, "utf8");
  return content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
}

function readSkillDescription(path: string): string {
  return readSkillFrontmatter(path).match(/^description:\s*(.+)$/m)?.[1] ?? "";
}

test("Package extension entrypoint uses compiled dist output", () => {
  assert.deepEqual(packageJson.pi.extensions, ["./dist/pi-actors/index.js"]);
  assert.equal(packageJson.files.includes("index.ts"), true);
  assert.equal(packageJson.files.includes("dist"), true);
  assert.equal(packageJson.files.includes("index.js"), false);
  assert.equal(existsSync("index.ts"), true);
  assert.equal(existsSync("index.js"), false);
});

test("Packaged skills are registered through dist metadata", () => {
  assert.deepEqual(packagedSkillPaths, [
    "skills/actors/SKILL.md",
    "skills/artifacts/SKILL.md",
    "skills/music-player/SKILL.md",
    "skills/project-work/SKILL.md",
    "skills/recipe-memory/SKILL.md",
    "skills/swarm/SKILL.md",
  ]);
  assert.deepEqual(packageJson.pi.skills, ["./dist/skills"]);
  assert.deepEqual(packageJson.pi.sourceSkills, ["./skills"]);
});

test("Auto-discovered extension contributes co-located skills", () => {
  const extensionSource = readFileSync("index.ts", "utf8");
  const extensionRuntimeSource = readFileSync("lib/extension-runtime.ts", "utf8");
  const pathsSource = readFileSync("lib/paths.ts", "utf8");
  assert.match(extensionSource, /pi\.on\("resources_discover"/);
  assert.match(extensionSource, /runtime\.discoverResources/);
  assert.match(extensionRuntimeSource, /Paths\.getExistingExtensionSkillPaths/);
  assert.match(pathsSource, /getExtensionSkillsDir/);
});

test("Packaged Skill identity matches its directory exactly", () => {
  for (const skillPath of packagedSkillPaths) {
    const frontmatter = readSkillFrontmatter(skillPath);
    const declared = frontmatter.match(/^name:\s*(\S+)$/m)?.[1];
    assert.equal(declared, dirname(skillPath).split(/[\\/]/).at(-1));
  }
});

test("Packaged Skill descriptions are stable routing triggers", () => {
  const descriptions: Record<string, string> = Object.fromEntries(
    packagedSkillPaths.map((path) => [
      dirname(path).split(/[\\/]/).at(-1),
      readSkillDescription(path),
    ]),
  );
  assert.deepEqual(descriptions, {
    actors: "Use for any non-trivial pi-actors operation, diagnosis, or development involving Recipes, persistent tools, Runs, spawn, message, inspect, Trace, Control, capability specialization, or activation.",
    artifacts: "Use when an actor workflow must write reusable files, reports, manifests, or bundles with deterministic paths and declared outputs.",
    "music-player": "Use for starting, resuming, inspecting, and controlling one persistent local music playback actor from caller-approved files, directories, URLs, or playlists.",
    "project-work": "Use for repository health inspection, project summaries, documentation maintenance, release-readiness evidence, or bounded run-operation reports.",
    "recipe-memory": "Use only for internal automatic Recipe-memory review, diagnosis, or recovery; do not use for normal Recipe creation, registration, or invocation.",
    swarm: "Use when work needs multiple actors or subagents for independent implementation, artifact generation, review, delegated audit, research, or coordinated decomposition and integration.",
  });
  assert.equal(new Set(Object.values(descriptions)).size, 6);
  for (const description of Object.values(descriptions)) {
    assert.match(description, /^Use (?:for|when|only)/);
    assert.doesNotMatch(description, /version|history|package-owned|recipes\/|\.json|helper|script/i);
  }
  for (const name of ["artifacts", "music-player", "project-work", "recipe-memory", "swarm"]) {
    assert.doesNotMatch(
      (descriptions as Record<string, string>)[name],
      /\bspawn\b|\bmessage\b|\binspect\b|\bTrace\b|\bControl\b|activation|persistent tool/,
    );
  }
  assert.match(descriptions["recipe-memory"], /internal/);
  assert.match(descriptions["recipe-memory"], /do not use for normal Recipe/);
});

test("Packaged capability Skills route outcomes without duplicating actors mechanics", () => {
  const guides = Object.fromEntries(
    ["artifacts", "music-player", "project-work", "recipe-memory"].map((name) => [
      name,
      readFileSync(`skills/${name}/SKILL.md`, "utf8"),
    ]),
  ) as Record<string, string>;

  for (const [name, guide] of Object.entries(guides)) {
    assert.match(guide, /follow `actors`/i, `${name} should delegate generic mechanics`);
    assert.doesNotMatch(guide, /README|docs\/|npm install|pnpm|yarn|git clone|maintainer|contributor/i);
    assert.doesNotMatch(guide, /Skill Recipe ≠|persisted ≠|callable_now|launch_kind|Recipe --spawn/);
  }

  for (const identity of [
    "artifacts/bundle",
    "artifacts/report",
    "artifacts/write",
    "artifacts/manifest",
    "artifacts/file-write",
  ]) assert.match(guides.artifacts, new RegExp(identity));
  assert.match(guides.artifacts, /report.*without committing a filesystem write/i);
  assert.match(guides.artifacts, /write_mode=create.*stops if the target exists/i);
  assert.match(guides.artifacts, /Do not claim a durable artifact from `report` or `manifest` alone/);
  assert.match(guides.artifacts, /persistent-capability workflow in `actors`/);

  assert.match(guides["music-player"], /music-player\/playback/);
  assert.match(guides["music-player"], /singleton async controlled service/);
  assert.match(guides["music-player"], /canonical address `run:music-player`/);
  assert.match(guides["music-player"], /caller-approved local music/);
  assert.match(guides["music-player"], /## Stop Rules/);

  for (const identity of [
    "project-work/repo-health",
    "project-work/docs-maintenance",
    "project-work/release-readiness",
    "project-work/release-summary",
    "project-work/run-ops",
  ]) assert.match(guides["project-work"], new RegExp(identity));
  assert.match(guides["project-work"], /## Supporting Recipes/);
  assert.match(guides["project-work"], /Readiness only; does not publish/);
  assert.match(guides["project-work"], /does not send Control or mutate Runs/);
  assert.match(guides["project-work"], /persistent-capability workflow in `actors`/);

  assert.match(guides["recipe-memory"], /inspect target=recipes view=reviews/);
  assert.match(guides["recipe-memory"], /inspect target=runtime view=triage/);
  assert.match(guides["recipe-memory"], /message target=runtime action=review\.retry/);
  assert.match(guides["recipe-memory"], /message target=runtime action=review\.reset/);
  assert.match(guides["recipe-memory"], /package-owned internal reviewer components/);
  assert.doesNotMatch(guides["recipe-memory"], /spawn recipe=recipe-memory|register_tool.*recipe-memory/);
});

test("Packaged skill frontmatter scalar lines avoid extra colons", () => {
  for (const skillPath of packagedSkillPaths) {
    const frontmatter = readSkillFrontmatter(skillPath);
    const scalarLines = frontmatter
      .split("\n")
      .filter((line) => /^\w+:\s*\S/.test(line));
    for (const line of scalarLines) {
      assert.equal(
        (line.match(/:/g) ?? []).length,
        1,
        `${skillPath} frontmatter line should contain only the key separator colon: ${line}`,
      );
    }
  }
});

test("Packaged swarm skill stays independent of pi-actors concrete runtime", () => {
  const forbiddenPatterns = [
    /pi-actors/i,
    /coordinator-locker/i,
    /\brun:/,
    /\btool:/,
    /\boutbox\b/i,
    /\bFIFO\b/i,
  ];
  for (const path of listMarkdownFiles("skills/swarm")) {
    const content = readFileSync(path, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(
        content,
        pattern,
        `${path} should not mention ${pattern}`,
      );
    }
  }
});

test("Packaged swarm composes with actors as methodology only", () => {
  const swarm = readFileSync("skills/swarm/SKILL.md", "utf8");
  const review = readFileSync("skills/swarm/references/review-swarms.md", "utf8");
  const development = readFileSync("skills/swarm/references/development-swarm.md", "utf8");
  const admissionAt = swarm.indexOf("Use multi-actor execution only when");
  const actorsAt = swarm.indexOf("Read `actors` first");
  const selectionAt = swarm.indexOf("## Choose the shape");
  assert.ok(admissionAt > 0 && actorsAt > admissionAt && selectionAt > actorsAt);
  for (const identity of [
    "swarm/lens-review",
    "swarm/quorum-review",
    "swarm/research-synthesis",
    "swarm/architect",
    "swarm/development-tasking",
    "swarm/review-readiness",
  ]) assert.match(swarm, new RegExp(identity));
  for (const retained of [
    /disjoint read or write scopes/,
    /reviewer evidence/,
    /minority high-impact findings/,
    /conflicts from explicit intent and invariants/,
    /One integrator owns merge order/,
    /## Stop rules/,
  ]) assert.match(swarm, retained);
  assert.match(swarm, /references\/review-swarms\.md/);
  assert.match(swarm, /references\/development-swarm\.md/);
  assert.doesNotMatch(
    swarm,
    /Recipe files have no|Async Run Adapter|## Run Adapter|## Tool Contracts|register_tool|spawn recipe|~\/\.pi|Maintain this skill|After changing Swarm|host package/i,
  );

  assert.match(review, /## Lens selection/);
  assert.match(review, /## Quorum design/);
  assert.match(review, /## Merge protocol/);
  assert.match(review, /## Conflict and disagreement/);
  assert.match(review, /## Post-merge review/);
  assert.match(development, /\.\.\/SKILL\.md#reasoning-allocation/);
  assert.match(swarm, /## Reasoning allocation/);
  assert.match(development, /## Task card/);
  assert.match(development, /## Write ownership/);
  assert.match(development, /## Conflict evidence/);
  assert.match(development, /## Integration protocol/);
  assert.doesNotMatch(development, /git worktree|\.agents\/|```bash|npm|pnpm|yarn/);
});

test("Packaged skill markdown links resolve inside package", () => {
  const localMarkdownLink = /\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+)\)/g;
  for (const path of listMarkdownFiles("skills")) {
    const content = readFileSync(path, "utf8");
    for (const match of content.matchAll(localMarkdownLink)) {
      const href = match[1].split("#")[0];
      if (!href) continue;
      const target = normalize(join(dirname(path), href));
      assert.ok(existsSync(target), `${path} link should resolve: ${match[1]}`);
    }
  }
});

test("Agent and human guidance surfaces keep explicit ownership", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  assert.match(agents, /`README\.md` and `docs\/`: human-facing/);
  assert.match(agents, /`skills\/`: agent-facing operating protocols/);
  assert.match(agents, /injected system prompt: routing-only meta-protocol/);
  assert.match(agents, /`AGENTS\.md`, source, and tests: implementation protocol and executable evidence/);

  const localMarkdownLink = /\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+)\)/g;
  for (const skillPath of packagedSkillPaths) {
    const skillRoot = dirname(skillPath);
    for (const path of listMarkdownFiles(skillRoot)) {
      const content = readFileSync(path, "utf8");
      for (const match of content.matchAll(localMarkdownLink)) {
        const href = match[1].split("#")[0];
        if (!href) continue;
        const target = normalize(join(dirname(path), href));
        const relation = relative(skillRoot, target);
        assert.ok(
          !relation.startsWith("..") && !isAbsolute(relation),
          `${path} agent guidance should stay Skill-local: ${match[1]}`,
        );
      }
    }
  }

  const readme = readFileSync("README.md", "utf8");
  for (const section of [
    "## Install",
    "## Public Tools",
    "## Recipe",
    "## Trace",
    "## Control",
    "## Run State",
    "## Actor Inspector",
    "## Skill Recipes",
    "## Development",
  ]) assert.match(readme, new RegExp(section));
  const humanCatalog = readFileSync("docs/recipe-library.md", "utf8");
  for (const identity of [
    "project-work/repo-health",
    "project-work/docs-maintenance",
    "project-work/release-readiness",
    "project-work/release-summary",
    "project-work/run-ops",
    "swarm/development-tasking",
    "swarm/lens-review",
    "swarm/quorum-review",
    "swarm/research-synthesis",
    "swarm/architect",
    "artifacts/report",
    "artifacts/write",
    "artifacts/bundle",
    "music-player/playback",
  ]) assert.match(humanCatalog, new RegExp(identity));
});

test("Packaged actors skill stays focused on agent operations, not Inspector UI", () => {
  const actorSkill = readFileSync("skills/actors/SKILL.md", "utf8");
  assert.doesNotMatch(actorSkill, /\/actors-inspector|actor inspector|inside the overlay/i);
});

test("Packaged actors skill is the decision-first operating protocol", () => {
  const actorSkill = readFileSync("skills/actors/SKILL.md", "utf8");
  const chooseAt = actorSkill.indexOf("## Choose the operation");
  const distinctionsAt = actorSkill.indexOf("## Core distinctions");
  const persistentAt = actorSkill.indexOf("## Persistent capability workflow");
  assert.ok(chooseAt > 0);
  assert.ok(distinctionsAt > chooseAt);
  assert.ok(persistentAt > distinctionsAt);
  const capabilityMap = actorSkill.split("## Capability map")[1]?.split("## Delegation boundary")[0] ?? "";
  for (const skillPath of packagedSkillPaths) {
    assert.ok(capabilityMap.includes(`\`${dirname(skillPath).split("/").at(-1)}\``));
  }
  for (const file of readdirSync("skills/actors/recipes")) {
    const stem = file.replace(/\.(json|md)$/, "");
    assert.ok(capabilityMap.includes(`\`${stem}\``), `${stem} must route through actors`);
  }
  assert.match(actorSkill, /spawn recipe=<skill>\/<recipe>/);
  assert.match(actorSkill, /register_tool from=<skill>\/<recipe>/);
  assert.match(actorSkill, /Skill Recipe ≠ registered tool/);
  assert.match(actorSkill, /spawn ≠ registered-tool invocation/);
  assert.match(actorSkill, /persisted ≠ callable/);
  assert.match(actorSkill, /direct delegation ≠ named import composition/);
  assert.match(actorSkill, /Run Control ≠ actor chat/);
  assert.match(actorSkill, /callable_now: true/);
  assert.match(actorSkill, /launch_kind: "tool"/);
  assert.match(actorSkill, /Never recover by copying maintained Recipe args/);
  assert.match(actorSkill, /Never introduce `bash -lc`, `eval`/);
  assert.match(actorSkill, /read the owning capability Skill/);
  assert.match(actorSkill, /also read the swarm Skill/);
  assert.doesNotMatch(actorSkill, /README|docs\//);
  assert.doesNotMatch(actorSkill, /trace\.jsonl|controls\.jsonl|run\.json/);
  assert.doesNotMatch(actorSkill, /\b(?:380|512|1,?024|2,?048|4 MiB)\b/);
});

test("Packaged actors references own operation detail without human-doc fallback", () => {
  const references = ["diagnostics", "persistent-tools", "recipes", "runs"];
  const combined = references
    .map((name) =>
      readFileSync(`skills/actors/references/${name}.md`, "utf8"),
    )
    .join("\n");
  assert.match(combined, /register_tool from=music-player\/playback/);
  assert.match(combined, /Named import composition/);
  assert.match(combined, /inspect target=tool:<name> view=status/);
  assert.match(combined, /inspect target=recipes view=doctor/);
  assert.match(combined, /Control is not actor chat/);
  assert.match(combined, /Never recover by copying maintained contracts/);
  assert.doesNotMatch(combined, /README|docs\//);
});
