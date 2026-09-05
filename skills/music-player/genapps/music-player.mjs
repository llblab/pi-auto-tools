import { basename, dirname, isAbsolute } from "node:path";

const ACTIONS = new Set([
  "play",
  "pause",
  "resume",
  "toggle",
  "next",
  "previous",
  "stop",
]);

function requireAdapter(argument) {
  if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
    throw new Error("music-player init requires an object argument");
  }
  const control = typeof argument.control === "string" ? argument.control : "";
  const stateDir = typeof argument.stateDir === "string" ? argument.stateDir : "";
  const node = typeof argument.node === "string" ? argument.node : process.execPath;
  if (!isAbsolute(control) || !control.endsWith("playback.mjs")) {
    throw new Error("music-player control must be an absolute playback.mjs path");
  }
  if (!isAbsolute(stateDir)) {
    throw new Error("music-player stateDir must be an absolute path");
  }
  if (!isAbsolute(node)) {
    throw new Error("music-player node executable must be an absolute path");
  }
  return { control, node, stateDir };
}

function inline(value) {
  return String(value ?? "").replaceAll("`", "'");
}

function normalizePlayback(status) {
  const actorAvailable = status.actor_available === true;
  if (!actorAvailable) {
    return {
      actorAvailable: false,
      count: null,
      index: null,
      pid: "",
      player: "",
      progressPercent: null,
      seekPercent: 0,
      state: "inactive",
      track: "",
      updatedAt: typeof status.updated_at === "string" ? status.updated_at : "",
      volume: null,
    };
  }
  return {
    actorAvailable: true,
    state: typeof status.state === "string" ? status.state : "unknown",
    index: Number.isInteger(status.index) ? status.index : null,
    count: Number.isInteger(status.count) ? status.count : null,
    track: typeof status.track === "string" ? status.track : "",
    player: typeof status.player === "string" ? status.player : "",
    volume: Number.isInteger(status.volume) ? status.volume : null,
    seekPercent: Number.isInteger(status.seek_percent) ? status.seek_percent : 0,
    progressPercent: Number.isInteger(status.progress_percent) ? status.progress_percent : null,
    pid: typeof status.pid === "string" || typeof status.pid === "number"
      ? String(status.pid)
      : "",
    updatedAt: typeof status.updated_at === "string" ? status.updated_at : "",
  };
}

async function readPlayback(adapter, run) {
  const result = await run({
    command: adapter.node,
    args: [adapter.control, "control", adapter.stateDir, "status"],
    cwd: dirname(adapter.control),
    timeoutMs: 5_000,
  });
  if (result.code !== 0) {
    throw new Error(`music-player status failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    throw new Error("music-player status returned invalid JSON");
  }
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("music-player status returned an invalid object");
  }
  return normalizePlayback(status);
}

function withPlayback(state, playback) {
  return { version: 1, adapter: state.adapter, playback };
}

function mainControls(playback) {
  if (!playback.actorAvailable || playback.state === "stopped" || playback.state === "unknown") {
    return [
      [{ label: "▶ Start", prompt: "Start the music player", selected_style: "success" }],
      [{ label: "🔄 Status", prompt: "music-player::status", selected_style: "primary" }],
    ];
  }
  const primary = playback.state === "paused"
    ? { label: "▶ Play", prompt: "music-player::resume", selected_style: "success" }
    : { label: "⏸ Pause", prompt: "music-player::pause", selected_style: "primary" };
  const percentages = [0, 15, 30, 45, 60, 75, 90];
  const seek = percentages.map((percent) => ({
    label: percent === 0 ? "P0" : String(percent),
    prompt: `music-player::seek_percent(${percent})`,
    selected_style: percent === 0 ? "primary" : "success",
  }));
  const volume = percentages.map((percent) => ({
    label: percent === 0 ? "V0" : String(percent),
    prompt: `music-player::volume(${percent})`,
    selected_style: percent === 0 ? "primary" : "success",
  }));
  return [
    seek,
    volume,
    [
      { label: "⏮ Previous", prompt: "music-player::previous", selected_style: "primary" },
      primary,
      { label: "⏭ Next", prompt: "music-player::next", selected_style: "success" },
    ],
    [
      { label: "⏹ Stop", prompt: "music-player::stop", selected_style: "danger" },
      { label: "🔄 Status", prompt: "music-player::status", selected_style: "primary" },
    ],
  ];
}

function playbackLines(playback) {
  const track = playback.track ? basename(playback.track) : "—";
  const index = playback.index === null ? "—" : playback.index + 1;
  const count = playback.count === null ? "—" : playback.count;
  return [
    `- **Actor:** \`${playback.actorAvailable ? "available" : "unavailable"}\``,
    `- **State:** \`${inline(playback.state)}\``,
    `- **Progress:** \`${playback.progressPercent === null ? "—" : `${playback.progressPercent}%`}\``,
    `- **Volume:** \`${playback.volume === null ? "—" : `${playback.volume}%`}\``,
    `- **Backend:** \`${inline(playback.player || "—")}\``,
    `- **Queue:** \`${index}/${count}\``,
    `- **Track:** \`${inline(track)}\``,
  ];
}

function render(playback) {
  return [
    "**🎵 Music Player**",
    "",
    ...playbackLines(playback),
    "",
    `<!-- telegram_button ${JSON.stringify(mainControls(playback))} -->`,
  ].join("\n");
}

async function waitForTransition(adapter, run, before, action) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const playback = await readPlayback(adapter, run);
    const changed = action === "stop"
      ? playback.state === "stopped"
      : action === "pause"
        ? playback.state === "paused"
        : action === "play" || action === "resume"
          ? playback.state === "playing"
          : action === "toggle"
            ? playback.state !== before.state
            : playback.index !== before.index || playback.track !== before.track;
    if (changed) return playback;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return await readPlayback(adapter, run);
}

function normalizeAbsoluteVolume(argument) {
  const candidate =
    argument && typeof argument === "object" && !Array.isArray(argument)
      ? argument.percent
      : argument;
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 100) {
    throw new Error("music-player volume requires an integer percent 0..100");
  }
  return candidate;
}

async function applyVolume(percent, context) {
  const result = await context.run({
    command: context.state.adapter.node,
    args: [
      context.state.adapter.control,
      "control",
      context.state.adapter.stateDir,
      "volume",
      String(percent),
    ],
    cwd: dirname(context.state.adapter.control),
    timeoutMs: 5_000,
  });
  if (result.code !== 0) {
    throw new Error(`music-player volume failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  let playback;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    playback = await readPlayback(context.state.adapter, context.run);
    if (playback.volume === percent) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  playback ??= await readPlayback(context.state.adapter, context.run);
  return {
    state: withPlayback(context.state, playback),
    output: render(playback),
    viewMode: "edit",
  };
}

function normalizeSeekPercent(argument) {
  if (!Number.isInteger(argument) || argument < 0 || argument > 100) {
    throw new Error("music-player seek requires an integer percent 0..100");
  }
  return argument;
}

async function applySeek(percent, context) {
  const result = await context.run({
    command: context.state.adapter.node,
    args: [
      context.state.adapter.control,
      "control",
      context.state.adapter.stateDir,
      "seek",
      String(percent),
    ],
    cwd: dirname(context.state.adapter.control),
    timeoutMs: 5_000,
  });
  if (result.code !== 0) {
    throw new Error(`music-player seek failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  let playback;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    playback = await readPlayback(context.state.adapter, context.run);
    if (playback.seekPercent === percent && playback.pid) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  playback ??= await readPlayback(context.state.adapter, context.run);
  return {
    state: withPlayback(context.state, playback),
    output: render(playback),
    viewMode: "edit",
  };
}

async function apply(action, context) {
  if (!ACTIONS.has(action)) throw new Error(`unsupported music-player action: ${action}`);
  const before = await readPlayback(context.state.adapter, context.run);
  const result = await context.run({
    command: context.state.adapter.node,
    args: [context.state.adapter.control, "control", context.state.adapter.stateDir, action],
    cwd: dirname(context.state.adapter.control),
    timeoutMs: 5_000,
  });
  if (result.code !== 0) {
    throw new Error(`music-player ${action} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  const playback = await waitForTransition(
    context.state.adapter,
    context.run,
    before,
    action,
  );
  return {
    state: withPlayback(context.state, playback),
    output: render(playback),
    viewMode: "edit",
  };
}

export async function init({ argument, run }) {
  const adapter = requireAdapter(argument);
  const playback = await readPlayback(adapter, run);
  return {
    state: { version: 1, adapter, playback },
    output: render(playback),
  };
}

export async function status({ state, run }) {
  const playback = await readPlayback(state.adapter, run);
  const changed = JSON.stringify(playback) !== JSON.stringify(state.playback);
  return {
    ...(changed ? { state: withPlayback(state, playback) } : {}),
    output: render(playback),
    viewMode: "edit",
  };
}

export async function refresh({ state, run }) {
  const playback = await readPlayback(state.adapter, run);
  const changed = JSON.stringify(playback) !== JSON.stringify(state.playback);
  return {
    ...(changed ? { state: withPlayback(state, playback) } : {}),
    output: render(playback),
  };
}

export async function main({ state, run }) {
  const playback = await readPlayback(state.adapter, run);
  const changed = JSON.stringify(playback) !== JSON.stringify(state.playback);
  return {
    ...(changed ? { state: withPlayback(state, playback) } : {}),
    output: render(playback),
    viewMode: "edit",
  };
}

export async function play(context) {
  return await apply("resume", context);
}

export async function pause(context) {
  return await apply("pause", context);
}

export async function resume(context) {
  return await apply("resume", context);
}

export async function toggle(context) {
  return await apply("toggle", context);
}

export async function next(context) {
  return await apply("next", context);
}

export async function previous(context) {
  return await apply("previous", context);
}

export async function seek_percent({ argument, ...context }) {
  return await applySeek(normalizeSeekPercent(argument), context);
}

export async function volume({ argument, ...context }) {
  return await applyVolume(normalizeAbsoluteVolume(argument), context);
}

export async function volume_delta({ argument, ...context }) {
  if (!Number.isInteger(argument) || argument < -100 || argument > 100) {
    throw new Error("music-player volume_delta requires an integer -100..100");
  }
  const playback = await readPlayback(context.state.adapter, context.run);
  const current = playback.volume;
  if (!Number.isInteger(current)) {
    throw new Error("music-player current volume is unavailable");
  }
  return await applyVolume(Math.max(0, Math.min(100, current + argument)), context);
}

export async function stop(context) {
  return await apply("stop", context);
}
