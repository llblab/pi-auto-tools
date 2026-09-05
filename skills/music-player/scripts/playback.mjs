#!/usr/bin/env node

/**
 * Packaged persistent local music playback controlled-service helper.
 *
 * This script backs the singleton music-player/playback Recipe. It scans local music
 * sources, builds playback queues, launches an available backend player, and
 * consumes generation-bound Controls such as play, pause, next, previous,
 * stop, and status.
 *
 * Keep the helper focused on one maintained controlled Run implementation; Recipe
 * metadata and invocation arguments choose source paths and backend behavior.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function packageRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

async function importRuntimeModule(name) {
  const root = packageRoot();
  const compiled = join(root, "lib", `${name}.js`);
  const installedCompiled = join(root, "dist", "lib", `${name}.js`);
  const source = join(root, "lib", `${name}.ts`);
  const module = existsSync(compiled)
    ? compiled
    : root.includes(`${delimiter}node_modules${delimiter}`) && existsSync(installedCompiled)
      ? installedCompiled
      : source;
  return await import(pathToFileURL(module).href);
}

const actorAdapterEnabled = process.argv[2] !== "serve";
let appendRunControlInStateDir;
let claimRunControlByIdInStateDir;
let processRunControlsInStateDir;
let readRunControlJournalFromStateDir;
let updateRunControlStatusInStateDir;
let isAlive;
let verifyRunProcessIdentity;
let appendRunTraceEvent = () => {};
async function loadActorAdapter() {
  ({
    appendRunControlInStateDir,
    claimRunControlByIdInStateDir,
    processRunControlsInStateDir,
    readRunControlJournalFromStateDir,
    updateRunControlStatusInStateDir,
  } = await importRuntimeModule("runs-controls"));
  ({ isAlive, verifyRunProcessIdentity } =
    await importRuntimeModule("runs-process"));
  ({ appendRunTraceEvent } = await importRuntimeModule("runs-trace"));
}

const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
]);
const PLAYLIST_EXTENSIONS = new Set([".m3u", ".m3u8", ".txt"]);
const CONTROL_COMMANDS = new Set([
  "play",
  "resume",
  "pause",
  "toggle",
  "next",
  "previous",
  "seek",
  "volume",
  "stop",
  "status",
]);
function usage() {
  console.error(`Usage:
  playback.mjs <play|serve> <source-file-dir-url-playlist-or-list> [loop=true] [volume=70] [player=auto] [state-dir]
  playback.mjs <pause|resume|toggle|next|previous|stop|status> <state-dir>
  playback.mjs <seek|volume> <state-dir> <percent>
  playback.mjs control <state-dir> <play|pause|toggle|next|previous|seek|volume|stop|status> [percent]

Runs a foreground music player so pi-actors can own it as a controlled Run.
Actor-owned controls use canonical records in <state-dir>/controls.jsonl.
Standalone controls use the generation-fenced playback service endpoint.
Prefer message target=run:<run> action=<command> for Actors; external adapters use control <state-dir> <action>.
Supported players: auto, mpv, afplay, ffplay, cvlc, play, wmp.
`);
}

function fail(message, code = 1) {
  console.error(`music-player: ${message}`);
  process.exit(code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expandPath(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function isUrl(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

function exists(path) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function isLocalProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function have(command) {
  const paths = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of paths) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return false;
}

function parseBool(value) {
  switch (String(value).toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "y":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "n":
    case "off":
      return false;
    default:
      fail(`invalid loop value: ${value}`, 2);
  }
}

function parsePercent(value, label) {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? value.percent
      : value;
  if (!/^\d+$/.test(String(candidate))) {
    throw new Error(`${label} percent must be an integer 0..100`);
  }
  const percent = Number(candidate);
  if (percent < 0 || percent > 100) {
    throw new Error(`${label} percent must be an integer 0..100`);
  }
  return percent;
}

function parseSeekPercent(value) {
  return parsePercent(value, "seek");
}

function parseVolumePercent(value) {
  return parsePercent(value, "volume");
}

function normalizeVolume(value) {
  try {
    return parseVolumePercent(value);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }
}

function powershellCommand() {
  return have("powershell") ? "powershell.exe" : undefined;
}

function windowsMediaPlayerExecutable() {
  if (process.platform !== "win32") return undefined;
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.SystemDrive
      ? join(process.env.SystemDrive, "Program Files")
      : undefined,
    process.env.SystemDrive
      ? join(process.env.SystemDrive, "Program Files (x86)")
      : undefined,
  ];
  for (const root of roots.filter(Boolean)) {
    const candidate = join(root, "Windows Media Player", "wmplayer.exe");
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

function havePlayer(player) {
  if (player === "wmp") {
    return (
      process.platform === "win32" &&
      Boolean(powershellCommand()) &&
      Boolean(windowsMediaPlayerExecutable())
    );
  }
  return have(player);
}

function selectPlayer(requested) {
  let selected = requested;
  if (selected === "auto") {
    let candidates;
    if (process.platform === "win32") {
      candidates = ["wmp", "mpv", "ffplay", "cvlc"];
    } else if (process.platform === "darwin") {
      candidates = ["mpv", "afplay", "ffplay", "cvlc", "play"];
    } else {
      candidates = ["mpv", "ffplay", "cvlc", "play"];
    }
    selected = candidates.find(havePlayer) || selected;
  }
  if (!["mpv", "afplay", "ffplay", "cvlc", "play", "wmp"].includes(selected)) {
    fail(`unsupported player: ${requested}`, 2);
  }
  if (selected === "wmp" && !havePlayer(selected)) {
    fail(
      "player not found: wmp requires native Windows, powershell.exe, and wmplayer.exe under Program Files/Windows Media Player",
      127,
    );
  }
  if (!havePlayer(selected)) fail(`player not found: ${selected}`, 127);
  return selected;
}

function addTrack(tracks, item) {
  const track = expandPath(item.trim());
  if (!track) return;
  if (isUrl(track) || exists(track)) {
    tracks.push(track);
    return;
  }
  console.error(`music-player: source entry not found: ${track}`);
}

function collectAudioFiles(dir, result = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectAudioFiles(path, result);
      continue;
    }
    if (
      entry.isFile() &&
      AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      result.push(path);
    }
  }
  return result;
}

function loadPlaylist(source) {
  const sourceArg = expandPath(source);
  const tracks = [];
  if (sourceArg.includes("|")) {
    for (const item of sourceArg.split("|")) addTrack(tracks, item);
  } else if (isUrl(sourceArg)) {
    tracks.push(sourceArg);
  } else if (isDirectory(sourceArg)) {
    tracks.push(
      ...collectAudioFiles(sourceArg).sort((a, b) => a.localeCompare(b)),
    );
  } else if (
    isFile(sourceArg) &&
    PLAYLIST_EXTENSIONS.has(extname(sourceArg).toLowerCase())
  ) {
    const baseDir = dirname(resolve(sourceArg));
    const lines = readFileSync(sourceArg, "utf8").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "").trim();
      if (!line || line.startsWith("#")) continue;
      if (isUrl(line) || isAbsolute(line) || line.startsWith("~"))
        addTrack(tracks, line);
      else addTrack(tracks, join(baseDir, line));
    }
  } else if (exists(sourceArg)) {
    tracks.push(sourceArg);
  } else {
    fail(`source not found: ${sourceArg}`, 66);
  }
  if (tracks.length === 0)
    fail(`source has no playable tracks: ${sourceArg}`, 66);
  return tracks;
}

function windowsMediaPlayerCommand(ctx, volume, track) {
  const command = powershellCommand();
  const wmplayer = windowsMediaPlayerExecutable();
  if (!command || !wmplayer) {
    fail(
      "Windows Media Player backend requires powershell.exe and wmplayer.exe",
      127,
    );
  }
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$track = $args[0]
$volume = [int]$args[1]
$controlFile = $args[2]
$wmplayerExe = $args[3]
if (-not (Test-Path -LiteralPath $wmplayerExe)) { throw "wmplayer.exe not found: $wmplayerExe" }
$player = New-Object -ComObject WMPlayer.OCX
$player.settings.volume = [Math]::Min([Math]::Max($volume, 0), 100)
$player.URL = $track
$player.controls.play()
try {
  while ($true) {
    Start-Sleep -Milliseconds 100
    if (Test-Path -LiteralPath $controlFile) {
      $control = (Get-Content -LiteralPath $controlFile -Raw -ErrorAction SilentlyContinue).Trim().ToLowerInvariant()
      Clear-Content -LiteralPath $controlFile -ErrorAction SilentlyContinue
      switch ($control) {
        'play' { $player.controls.play() }
        'pause' { $player.controls.pause() }
        'stop' { $player.controls.stop(); break }
      }
    }
    if ($player.playState -eq 1 -or $player.playState -eq 8) { break }
  }
} finally {
  $player.close()
}
`;
  return [
    command,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      track,
      String(volume),
      ctx.playerControlFile,
      wmplayer,
    ],
  ];
}

function probeDurationSeconds(track) {
  if (!have("ffprobe")) return undefined;
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      track,
    ],
    { encoding: "utf8", timeout: 5_000, windowsHide: true },
  );
  const duration = Number(String(result.stdout).trim());
  return result.status === 0 && Number.isFinite(duration) && duration > 0
    ? duration
    : undefined;
}

function playerCommand(ctx, player, volume, track, startSeconds = 0) {
  switch (player) {
    case "mpv":
      return [
        "mpv",
        [
          "--no-video",
          "--really-quiet",
          "--force-window=no",
          `--volume=${volume}`,
          ...(startSeconds > 0 ? [`--start=${startSeconds}`] : []),
          track,
        ],
      ];
    case "afplay":
      return [
        "afplay",
        ["-v", String(Math.min(Math.max(volume / 100, 0), 1)), track],
      ];
    case "ffplay":
      return [
        "ffplay",
        [
          "-nodisp",
          "-hide_banner",
          "-loglevel",
          "warning",
          "-autoexit",
          "-volume",
          String(volume),
          ...(startSeconds > 0 ? ["-ss", String(startSeconds)] : []),
          track,
        ],
      ];
    case "cvlc":
      return [
        "cvlc",
        [
          "--intf",
          "dummy",
          "--no-video",
          "--play-and-exit",
          "--volume",
          String(Math.floor((volume * 256) / 100)),
          ...(startSeconds > 0 ? ["--start-time", String(startSeconds)] : []),
          track,
        ],
      ];
    case "play":
      return [
        "play",
        ["-q", track, ...(startSeconds > 0 ? ["trim", String(startSeconds)] : [])],
      ];
    case "wmp":
      return windowsMediaPlayerCommand(ctx, volume, track);
    default:
      fail(`unsupported player: ${player}`, 2);
  }
}

function writeText(path, value) {
  writeFileSync(path, value, "utf8");
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function emitPlayerEvent(ctx, kind, summary, data = {}) {
  appendRunTraceEvent(ctx.stateDir, {
    data,
    kind,
    level: "info",
    summary,
  });
}

function emitTrackEvent(ctx, index, count, track, player) {
  const title = track.split(/[\\/]/).filter(Boolean).pop() || track;
  emitPlayerEvent(ctx, "player.track", `Now playing: ${title}`, {
    count,
    index,
    player,
    track,
  });
}

function emitStoppedEvent(ctx, reason = "stop") {
  emitPlayerEvent(ctx, "player.stopped", "Music player stopped", { reason });
}

function positionSnapshot(ctx, state, nowMs = Date.now()) {
  const duration = Number(ctx.durationSeconds);
  let position = Number(ctx.positionSeconds ?? 0);
  if (state === "playing" && Number.isFinite(ctx.positionStartedAtMs)) {
    position += Math.max(0, nowMs - ctx.positionStartedAtMs) / 1000;
  }
  if (Number.isFinite(duration) && duration > 0) {
    position = Math.min(Math.max(position, 0), duration);
  } else {
    position = Math.max(position, 0);
  }
  const progressPercent = Number.isFinite(duration) && duration > 0
    ? Math.min(100, Math.max(0, (position / duration) * 100))
    : undefined;
  return { duration, position, progressPercent, updatedAtMs: nowMs };
}

function freezePosition(ctx) {
  const snapshot = positionSnapshot(ctx, "playing");
  ctx.positionSeconds = snapshot.position;
  ctx.positionStartedAtMs = undefined;
}

function resumePosition(ctx) {
  ctx.positionStartedAtMs = Date.now();
}

function writeStatus(ctx, state, index, count, track, player, pid = "") {
  const updatedAt = new Date().toISOString();
  const position = positionSnapshot(ctx, state);
  writeText(
    ctx.statusFile,
    `state=${state}\nindex=${index}\ncount=${count}\ntrack=${track}\nplayer=${player}\nvolume=${ctx.volume}\nseek_percent=${ctx.seekPercent ?? 0}\nprogress_percent=${position.progressPercent === undefined ? "" : Math.round(position.progressPercent)}\npid=${pid}\nupdated_at=${updatedAt}\n`,
  );
  writeText(
    ctx.statusJsonFile,
    `${JSON.stringify({ state, index, count, track, player, volume: ctx.volume, seek_percent: ctx.seekPercent ?? 0, progress_percent: position.progressPercent === undefined ? null : Math.round(position.progressPercent), position_seconds: position.position, duration_seconds: Number.isFinite(position.duration) ? position.duration : null, position_updated_at_ms: position.updatedAtMs, pid: String(pid), updated_at: updatedAt })}\n`,
  );
  ctx.current = {
    count,
    index,
    pid: String(pid),
    player,
    state,
    track,
    volume: ctx.volume,
    seekPercent: ctx.seekPercent ?? 0,
    progressPercent: position.progressPercent,
  };
  writePlaybackCheckpoint(ctx, state, index, track);
}

function setState(ctx, state) {
  ctx.desiredState = state;
  writeText(ctx.stateFile, state);
  if (ctx.current) {
    writeStatus(
      ctx,
      state,
      ctx.current.index,
      ctx.current.count,
      ctx.current.track,
      ctx.current.player,
      ctx.current.pid,
    );
  }
}

function sendSignalToCurrent(ctx, signal) {
  const pid = Number(readText(ctx.pidFile).trim());
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    if (signal === "SIGTERM") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
    return;
  }
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Fall through to the direct child fallback.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Best effort control signal.
  }
}

function controlCurrentPlayback(ctx, command) {
  if (ctx.current?.player === "wmp") {
    writeText(ctx.playerControlFile, command);
    return;
  }
  switch (command) {
    case "play":
      sendSignalToCurrent(ctx, "SIGCONT");
      break;
    case "pause":
      sendSignalToCurrent(ctx, "SIGSTOP");
      break;
    case "stop":
      sendSignalToCurrent(ctx, "SIGCONT");
      sendSignalToCurrent(ctx, "SIGTERM");
      break;
  }
}

function pipeWireAudioStreamIds() {
  if (process.platform !== "linux" || !have("wpctl")) return [];
  const result = spawnSync("wpctl", ["status", "-n"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  const audio = (String(result.stdout).split(/\nVideo\n/u)[0] ?? "");
  const streams = audio.split(/\n\s*└─ Streams:\s*\n/u)[1] ?? "";
  return [...streams.matchAll(/^\s+(\d+)\.\s/gmu)]
    .map((match) => Number(match[1]))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function wpctlInspect(id) {
  const result = spawnSync("wpctl", ["inspect", String(id)], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout) : "";
}

function findPipeWireAudioStreamForPid(pid) {
  for (const nodeId of pipeWireAudioStreamIds()) {
    const node = wpctlInspect(nodeId);
    if (!/media\.class = "Stream\/Output\/Audio"/u.test(node)) continue;
    const clientId = Number(node.match(/client\.id = "(\d+)"/u)?.[1]);
    if (!Number.isInteger(clientId) || clientId <= 0) continue;
    const client = wpctlInspect(clientId);
    const processId = Number(client.match(/application\.process\.id = "(\d+)"/u)?.[1]);
    if (processId === pid) return nodeId;
  }
  return undefined;
}

function setCurrentPlaybackVolume(ctx, percent) {
  const pid = Number(ctx.child?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const cached = ctx.pipeWireVolumeTarget;
  const nodeId = cached?.pid === pid
    ? cached.nodeId
    : findPipeWireAudioStreamForPid(pid);
  if (!Number.isInteger(nodeId) || nodeId <= 0) return false;
  const result = spawnSync(
    "wpctl",
    ["set-volume", String(nodeId), `${percent}%`],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    ctx.pipeWireVolumeTarget = undefined;
    return false;
  }
  ctx.pipeWireVolumeTarget = { nodeId, pid };
  return true;
}

function seekCurrentPlayback(ctx, percent) {
  if (!["mpv", "ffplay", "cvlc", "play"].includes(ctx.player)) {
    throw new Error(`player ${ctx.player} does not support percentage seeking`);
  }
  const track = ctx.current?.track;
  if (!track) throw new Error("current track is unavailable for seeking");
  const duration = probeDurationSeconds(track);
  if (duration === undefined) {
    throw new Error("current track duration is unavailable for seeking");
  }
  ctx.seekPercent = percent;
  ctx.seekSeconds = (duration * percent) / 100;
  writeText(ctx.commandFile, "seek");
  emitPlayerEvent(
    ctx,
    "player.seek",
    `Music player seek set to ${percent}%`,
    { percent, seconds: ctx.seekSeconds },
  );
  controlCurrentPlayback(ctx, "stop");
}

function handleControl(ctx, input, controlInput) {
  const command = input.trim().toLowerCase();
  if (!command) return;
  if (!CONTROL_COMMANDS.has(command)) {
    console.error(`music-player: unknown control command: ${command}`);
    return;
  }
  switch (command) {
    case "play":
    case "resume":
      resumePosition(ctx);
      setState(ctx, "playing");
      controlCurrentPlayback(ctx, "play");
      break;
    case "pause":
      freezePosition(ctx);
      setState(ctx, "paused");
      controlCurrentPlayback(ctx, "pause");
      break;
    case "toggle": {
      const current = readText(ctx.stateFile).trim();
      if (current === "paused") {
        resumePosition(ctx);
        setState(ctx, "playing");
        controlCurrentPlayback(ctx, "play");
      } else {
        freezePosition(ctx);
        setState(ctx, "paused");
        controlCurrentPlayback(ctx, "pause");
      }
      break;
    }
    case "next":
      writeText(ctx.commandFile, "next");
      controlCurrentPlayback(ctx, "stop");
      break;
    case "previous":
    case "prev":
      writeText(ctx.commandFile, "previous");
      controlCurrentPlayback(ctx, "stop");
      break;
    case "seek":
      seekCurrentPlayback(ctx, parseSeekPercent(controlInput));
      break;
    case "volume": {
      const percent = parseVolumePercent(controlInput);
      ctx.volume = percent;
      if (ctx.current) {
        writeStatus(
          ctx,
          ctx.current.state,
          ctx.current.index,
          ctx.current.count,
          ctx.current.track,
          ctx.current.player,
          ctx.current.pid,
        );
      }
      const adjustedInPlace = setCurrentPlaybackVolume(ctx, percent);
      emitPlayerEvent(
        ctx,
        "player.volume",
        `Music player volume set to ${percent}%`,
        { adjusted_in_place: adjustedInPlace, percent },
      );
      if (ctx.child?.pid && !adjustedInPlace) {
        writeText(ctx.commandFile, "replay");
        controlCurrentPlayback(ctx, "stop");
      }
      break;
    }
    case "stop":
      ctx.stopping = true;
      writeText(ctx.commandFile, "stop");
      controlCurrentPlayback(ctx, "stop");
      break;
    case "status":
      break;
  }
}

function runJsonFile(ctx) {
  return join(ctx.stateDir, "run.json");
}

function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function readPlaybackCheckpoint(path) {
  if (!existsSync(path)) return { checkpoint: undefined, state: "new" };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { checkpoint: undefined, recovery: "invalid-json", state: "recovered" };
  }
  const checkpoint = normalizeCheckpoint(raw);
  return checkpoint
    ? { checkpoint, state: "valid" }
    : { checkpoint: undefined, recovery: "invalid-shape", state: "recovered" };
}

function normalizeCheckpoint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (
    value.version !== 1 ||
    typeof value.source !== "string" ||
    !["playing", "paused", "stopped"].includes(value.state) ||
    !Array.isArray(value.tracks) ||
    value.tracks.length === 0 ||
    value.tracks.some((track) => typeof track !== "string" || !track)
  ) return undefined;
  const index = Number(value.index);
  if (!Number.isInteger(index) || index < 0 || index >= value.tracks.length)
    return undefined;
  return { ...value, index, tracks: value.tracks };
}

function writePlaybackCheckpoint(ctx, state, index, track) {
  if (!ctx.playbackFile || !ctx.tracks?.length) return;
  writeJsonFile(ctx.playbackFile, {
    version: 1,
    source: ctx.source,
    tracks: ctx.tracks,
    index,
    track,
    state,
    loop: ctx.loop,
    volume: ctx.volume,
    seek_percent: ctx.seekPercent ?? 0,
    player: ctx.player,
    updated_at: new Date().toISOString(),
  });
}

function writePlaybackEndpoint(ctx, path) {
  writeJsonFile(join(ctx.stateDir, "playback-endpoint.json"), {
    owner_mode: ctx.ownerMode,
    path,
    service_instance_id: ctx.serviceInstanceId,
    service_pid: process.pid,
    type: "named-pipe",
  });
}

async function startPlaybackProtocolServer(ctx) {
  const path = process.platform === "win32"
    ? `\\\\.\\pipe\\pi-music-player-${ctx.serviceInstanceId}`
    : join(ctx.stateDir, "playback.sock");
  if (process.platform !== "win32") rmSync(path, { force: true });
  const server = createServer((socket) => {
    let content = "";
    let handled = false;
    const respond = () => {
      if (handled) return;
      handled = true;
      try {
        const wire = JSON.parse(content.trim());
        if (
          !wire ||
          typeof wire !== "object" ||
          Array.isArray(wire) ||
          wire.service_instance_id !== ctx.serviceInstanceId ||
          typeof wire.action !== "string" ||
          !CONTROL_COMMANDS.has(wire.action)
        ) throw new Error("invalid playback protocol command");
        handleControl(ctx, wire.action, wire.input);
        socket.end(`${JSON.stringify({ ok: true })}\n`);
      } catch (error) {
        socket.end(`${JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        })}\n`);
      }
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      content += chunk;
      if (Buffer.byteLength(content, "utf8") > 4096) {
        handled = true;
        socket.destroy();
        return;
      }
      if (content.includes("\n")) respond();
    });
    socket.on("end", respond);
    socket.resume();
  });
  await new Promise((resolveReady, rejectReady) => {
    server.once("error", rejectReady);
    server.listen(path, () => {
      server.off("error", rejectReady);
      writePlaybackEndpoint(ctx, path);
      resolveReady();
    });
  });
  return () => {
    server.close();
    rmSync(join(ctx.stateDir, "playback-endpoint.json"), { force: true });
    if (process.platform !== "win32") rmSync(path, { force: true });
  };
}

async function startControlServer(ctx, wakeControlLoop) {
  if (!ctx.runInstanceId) return undefined;
  const path = process.platform === "win32"
    ? `\\\\.\\pipe\\pi-actors-music-${String(process.env.run_id ?? process.pid).replaceAll(/[^A-Za-z0-9_-]/g, "-")}`
    : join(ctx.stateDir, "control.sock");
  if (process.platform !== "win32") rmSync(path, { force: true });
  const server = createServer((socket) => {
    let content = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { content += chunk; });
    socket.on("end", () => {
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const claimed = claimControl(ctx, JSON.parse(line));
          if (!claimed) continue;
          handleControl(ctx, claimed.action, claimed.input);
          finalizeControl(ctx, claimed.id, "handled");
        } catch (error) {
          const id = (() => { try { return JSON.parse(line).id; } catch { return undefined; } })();
          finalizeControl(ctx, id, "failed", error instanceof Error ? error.message : String(error));
        }
      }
      wakeControlLoop();
    });
    socket.resume();
  });
  await new Promise((resolveReady, rejectReady) => {
    server.once("error", rejectReady);
    server.listen(path, () => {
      server.off("error", rejectReady);
      writeJsonFile(join(ctx.stateDir, "control-endpoint.json"), {
        path,
        ready_at: new Date().toISOString(),
        run_instance_id: ctx.runInstanceId,
        type: "named-pipe",
      });
      resolveReady();
    });
  });
  return () => {
    server.close();
    rmSync(join(ctx.stateDir, "control-endpoint.json"), { force: true });
    if (process.platform !== "win32") rmSync(path, { force: true });
  };
}

function commandFromControl(control) {
  if (typeof control.action !== "string") return undefined;
  const action = control.action.trim();
  return CONTROL_COMMANDS.has(action) ? action : undefined;
}

function appendControl(ctx, action, input) {
  const run = readJsonFile(runJsonFile(ctx), {});
  return appendRunControlInStateDir(ctx.stateDir, {
    action,
    ...(input !== undefined ? { input } : {}),
    run_instance_id: run.run_instance_id,
  });
}

function claimControl(ctx, wire) {
  const control = claimRunControlByIdInStateDir(
    ctx.stateDir, ctx.runInstanceId, wire.id,
  );
  const action = control ? commandFromControl(control) : undefined;
  if (!action && control) {
    updateRunControlStatusInStateDir(ctx.stateDir, control.id, "failed", {
      error: "Unsupported music-player Control",
    }, ["claimed"]);
  }
  return action && control
    ? { action, id: control.id, input: control.input }
    : undefined;
}

function finalizeControl(ctx, id, status, error) {
  if (!id) return;
  updateRunControlStatusInStateDir(
    ctx.stateDir, id, status, error ? { error } : {}, ["claimed"],
  );
}

function controlsSignature(ctx) {
  try {
    const stat = statSync(ctx.controlsFile);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

function startControlLoop(ctx) {
  let closed = false;
  let dirty = true;
  let watcher;
  if (process.platform !== "win32") {
    try {
      watcher = watch(ctx.stateDir, { persistent: false }, (_eventType, file) => {
        const name = file ? String(file) : "";
        if (
          !name ||
          name === basename(ctx.controlsFile)
        ) {
          dirty = true;
        }
      });
    } catch {
      // fs.watch is advisory; signature checks remain the portable fallback.
    }
  }
  const close = () => {
    closed = true;
    watcher?.close();
  };
  const promise = (async () => {
    let lastSignature = "";
    while (!ctx.stopping && !closed) {
      const signature = controlsSignature(ctx);
      if (dirty || signature !== lastSignature) {
        dirty = false;
        if (ctx.runInstanceId) {
          await processRunControlsInStateDir(
            ctx.stateDir,
            ctx.runInstanceId,
            (control) => {
              const action = commandFromControl(control);
              if (!action) throw new Error("Unsupported music-player Control");
              handleControl(ctx, action, control.input);
            },
            8,
          );
        }
        lastSignature = controlsSignature(ctx);
      }
      await sleep(250);
    }
  })();
  return { close, promise, wake: () => { dirty = true; } };
}

function playOne(ctx, player, track, index, count) {
  return new Promise((resolveDone) => {
    if (ctx.stopping) {
      resolveDone();
      return;
    }
    rmSync(ctx.playerControlFile, { force: true });
    ctx.durationSeconds = probeDurationSeconds(track);
    ctx.positionSeconds = ctx.seekSeconds ?? 0;
    ctx.positionStartedAtMs = Date.now();
    const [command, args] = playerCommand(
      ctx,
      player,
      ctx.volume,
      track,
      ctx.seekSeconds ?? 0,
    );
    writeStatus(ctx, "playing", index, count, track, player, "");
    const child = spawn(command, args, {
      detached: process.platform === "win32",
      stdio: ["ignore", "inherit", "inherit"],
    });
    ctx.child = child;
    ctx.pipeWireVolumeTarget = undefined;
    const pid = child.pid || "";
    if (pid) writeText(ctx.pidFile, String(pid));
    if (ctx.stopping) controlCurrentPlayback(ctx, "stop");
    writeStatus(ctx, "playing", index, count, track, player, pid);
    if (ctx.desiredState === "paused") {
      controlCurrentPlayback(ctx, "pause");
      freezePosition(ctx);
      writeStatus(ctx, "paused", index, count, track, player, pid);
    }
    emitTrackEvent(ctx, index, count, track, player);
    child.once("error", (error) => {
      console.error(
        `music-player: failed to start ${command}: ${error.message}`,
      );
      resolveDone();
    });
    child.once("exit", () => {
      rmSync(ctx.pidFile, { force: true });
      ctx.child = undefined;
      resolveDone();
    });
  });
}

function readAndClearCommand(ctx) {
  const command = readText(ctx.commandFile).trim();
  writeText(ctx.commandFile, "");
  return command;
}

async function playMain(args) {
  if (actorAdapterEnabled) await loadActorAdapter();
  const [
    sourceArg,
    loopArg = "true",
    volumeArg = "70",
    playerArg = "auto",
    rawStateDir,
  ] = args;
  if (!sourceArg || sourceArg === "-h" || sourceArg === "--help") {
    usage();
    process.exit(2);
  }
  const stateDir = expandPath(
    rawStateDir ||
      join(
        process.env.TMPDIR || "/tmp",
        `pi-actors-music-player-${process.pid}`,
      ),
  );
  mkdirSync(stateDir, { recursive: true });
  const existingEndpoint = readJsonFile(
    join(stateDir, "playback-endpoint.json"),
    {},
  );
  if (isLocalProcessAlive(Number(existingEndpoint.service_pid))) {
    if (actorAdapterEnabled && existingEndpoint.owner_mode === "standalone") {
      fail(`standalone playback service already owns state: ${stateDir}`, 3);
    }
    if (!actorAdapterEnabled) {
      fail(`active playback service already owns state: ${stateDir}`, 3);
    }
  }
  const startupRun = actorAdapterEnabled
    ? readJsonFile(runJsonFile({ stateDir }), {})
    : {};
  const source = expandPath(sourceArg);
  const loop = parseBool(loopArg);
  const volume = normalizeVolume(volumeArg);
  const player = selectPlayer(playerArg);
  const playbackFile = join(stateDir, "playback.json");
  const checkpointLoad = readPlaybackCheckpoint(playbackFile);
  const checkpoint = checkpointLoad.checkpoint;
  const checkpointTracksUsable =
    checkpoint?.source === source &&
    checkpoint.player === player &&
    checkpoint.tracks.every((track) => isUrl(track) || exists(track));
  const tracks = checkpointTracksUsable ? checkpoint.tracks : loadPlaylist(source);
  let index = checkpointTracksUsable ? checkpoint.index : 0;
  const ctx = {
    commandFile: join(stateDir, "command.txt"),
    current: undefined,
    controlsFile: join(stateDir, "controls.jsonl"),
    desiredState:
      checkpointTracksUsable && checkpoint.state === "paused"
        ? "paused"
        : "playing",
    index,
    loop,
    pidFile: join(stateDir, "current.pid"),
    playbackFile,
    ownerMode: actorAdapterEnabled ? "actor" : "standalone",
    player,
    playerControlFile: join(stateDir, "player-control.txt"),
    positionSeconds: 0,
    positionStartedAtMs: undefined,
    runInstanceId: typeof startupRun.run_instance_id === "string"
      ? startupRun.run_instance_id
      : undefined,
    seekPercent: 0,
    seekSeconds: 0,
    serviceInstanceId: randomUUID(),
    source,
    stateDir,
    stateFile: join(stateDir, "player-state.txt"),
    statusFile: join(stateDir, "status.txt"),
    statusJsonFile: join(stateDir, "player.json"),
    stopping: false,
    tracks,
    volume,
  };
  rmSync(ctx.commandFile, { force: true });
  rmSync(ctx.pidFile, { force: true });
  rmSync(ctx.playerControlFile, { force: true });
  let controlLoop;
  let closeControlServer;
  let closePlaybackProtocolServer;
  const cleanup = () => {
    ctx.stopping = true;
    if (ctx.current) {
      freezePosition(ctx);
      writeStatus(ctx, "stopped", index, tracks.length, tracks[index] ?? "", player, "");
    } else writeText(ctx.stateFile, "stopped");
    if (ctx.child?.pid) controlCurrentPlayback(ctx, "stop");
    controlLoop?.close();
    closeControlServer?.();
    closePlaybackProtocolServer?.();
    rmSync(ctx.pidFile, { force: true });
    rmSync(ctx.playerControlFile, { force: true });
  };
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGHUP", () => {
    cleanup();
    process.exit(129);
  });
  try {
    controlLoop = startControlLoop(ctx);
    closePlaybackProtocolServer = await startPlaybackProtocolServer(ctx);
    closeControlServer = await startControlServer(ctx, controlLoop.wake);
    if (checkpointLoad.recovery) {
      console.error(
        `music-player: checkpoint_recovery=${checkpointLoad.recovery} state_dir=${stateDir}`,
      );
      emitPlayerEvent(
        ctx,
        "player.checkpoint-recovered",
        "Ignored malformed playback checkpoint and rebuilt the queue",
        { reason: checkpointLoad.recovery },
      );
    }
    setState(ctx, ctx.desiredState);
    const checkpointState = checkpointTracksUsable
      ? "resumed"
      : checkpointLoad.recovery
        ? "recovered"
        : checkpoint
          ? "rebuilt"
          : "new";
    console.error(
      `music-player: player=${player} loop=${loop} volume=${ctx.volume} tracks=${tracks.length} checkpoint=${checkpointState} start_index=${index} state_dir=${stateDir}`,
    );
    const count = tracks.length;
    while (!ctx.stopping) {
      const track = tracks[index];
      await playOne(ctx, player, track, index, count);
      const command = readAndClearCommand(ctx);
      if (command === "stop") {
        freezePosition(ctx);
        writeStatus(ctx, "stopped", index, count, track, player, "");
        emitStoppedEvent(ctx, "message");
        return;
      }
      if (command === "previous" || command === "prev") {
        ctx.seekPercent = 0;
        ctx.seekSeconds = 0;
        index = (index - 1 + count) % count;
        continue;
      }
      if (command === "next") {
        ctx.seekPercent = 0;
        ctx.seekSeconds = 0;
        index = (index + 1) % count;
        continue;
      }
      if (command === "seek" || command === "replay") continue;
      ctx.seekPercent = 0;
      ctx.seekSeconds = 0;
      if (index + 1 >= count) {
        if (loop) index = 0;
        else break;
      } else {
        index += 1;
      }
    }
    freezePosition(ctx);
    writeStatus(ctx, "stopped", index, tracks.length, "", player, "");
    emitStoppedEvent(ctx, "complete");
  } finally {
    cleanup();
    await Promise.race([controlLoop?.promise ?? Promise.resolve(), sleep(100)]);
  }
}

function projectCurrentProgress(status, nowMs = Date.now()) {
  if (!status || typeof status !== "object" || Array.isArray(status)) return status;
  const duration = Number(status.duration_seconds);
  let position = Number(status.position_seconds);
  const updatedAtMs = Number(status.position_updated_at_ms);
  if (!Number.isFinite(position)) position = 0;
  if (status.state === "playing" && Number.isFinite(updatedAtMs)) {
    position += Math.max(0, nowMs - updatedAtMs) / 1000;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return { ...status, progress_percent: null };
  }
  position = Math.min(Math.max(position, 0), duration);
  return {
    ...status,
    progress_percent: Math.round((position / duration) * 100),
    position_seconds: position,
    position_updated_at_ms: nowMs,
  };
}

async function actorControlAvailability(stateDir) {
  const run = readJsonFile(join(stateDir, "run.json"), {});
  const result = readJsonFile(join(stateDir, "result.json"), {});
  const endpoint = readJsonFile(join(stateDir, "control-endpoint.json"), {});
  const playerStatus = readJsonFile(join(stateDir, "player.json"), {});
  const runInstanceId = typeof run.run_instance_id === "string"
    ? run.run_instance_id
    : undefined;
  // Inactive status must remain readable without an installed Actor runtime,
  // including standalone state beside metadata from a rejected Actor launch.
  if (!runInstanceId || typeof result.completedAt === "string" ||
      endpoint.run_instance_id !== runInstanceId ||
      !["playing", "paused"].includes(playerStatus.state)) {
    return { available: false, runInstanceId };
  }
  if (!verifyRunProcessIdentity) {
    await loadActorAdapter();
    // Re-read authority after the asynchronous import before admitting control.
    return actorControlAvailability(stateDir);
  }
  const pid = Number(run.pid || 0);
  const hasProcessIdentity = pid > 0 || run.process_identity !== undefined;
  const processIdentity = pid > 0
    ? verifyRunProcessIdentity(pid, run.process_identity)
    : { valid: false };
  return {
    available: !hasProcessIdentity ||
      (pid > 0 && isAlive(pid) && processIdentity.valid === true),
    runInstanceId,
  };
}

async function sendPlaybackCommand(endpoint, action, input) {
  const payload = `${JSON.stringify({
    action,
    ...(input !== undefined ? { input } : {}),
    service_instance_id: endpoint.service_instance_id,
  })}\n`;
  const response = await new Promise((resolveResponse, rejectResponse) => {
    const socket = createConnection(endpoint.path);
    let content = "";
    const timeout = setTimeout(() => {
      socket.destroy(new Error("playback service command timed out"));
    }, 5_000);
    timeout.unref?.();
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      content += chunk;
      if (Buffer.byteLength(content, "utf8") > 4096) {
        socket.destroy(new Error("playback service response is too large"));
      }
    });
    socket.on("close", () => clearTimeout(timeout));
    socket.on("error", rejectResponse);
    socket.on("end", () => {
      try {
        resolveResponse(JSON.parse(content.trim()));
      } catch {
        rejectResponse(new Error("playback service returned invalid JSON"));
      }
    });
  });
  if (response?.ok !== true) {
    throw new Error(response?.error || "playback service rejected the command");
  }
}

async function controlMain(args) {
  const stateDir = expandPath(args[0] || "");
  const command = args[1] || "status";
  const rawInput = args[2];
  if (!stateDir) {
    usage();
    process.exit(2);
  }
  if (!CONTROL_COMMANDS.has(command)) fail(`unsupported command: ${command}`, 2);
  const endpoint = readJsonFile(join(stateDir, "playback-endpoint.json"), {});
  // A standalone service retains authority even if an unsuccessful Actor launch
  // left Run metadata beside its endpoint. Clients never start or adopt it.
  const actorOwned = endpoint.owner_mode !== "standalone" &&
    existsSync(join(stateDir, "run.json"));
  if (command === "status") {
    const statusFile = join(stateDir, "player.json");
    const status = exists(statusFile)
      ? readJsonFile(statusFile, { state: "unknown" })
      : { state: "unknown" };
    const actor = actorOwned
      ? await actorControlAvailability(stateDir)
      : { available: false };
    process.stdout.write(`${JSON.stringify({
      ...projectCurrentProgress(status),
      actor_available: actor.available,
      ...(actor.runInstanceId
        ? { actor_run_instance_id: actor.runInstanceId }
        : {}),
    })}\n`);
    return;
  }
  if (actorOwned && !(await actorControlAvailability(stateDir)).available) {
    fail(`Run playback is not active: ${stateDir}`, 3);
  }
  let input;
  if (command === "seek" || command === "volume") {
    try {
      input = {
        percent: command === "seek"
          ? parseSeekPercent(rawInput)
          : parseVolumePercent(rawInput),
      };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 2);
    }
  }
  if (!actorOwned) {
    if (endpoint.owner_mode !== "standalone" ||
        typeof endpoint.path !== "string" || !endpoint.path ||
        typeof endpoint.service_instance_id !== "string" || !endpoint.service_instance_id) {
      fail(`standalone playback service is not active: ${stateDir}`, 3);
    }
    try {
      await sendPlaybackCommand(endpoint, command === "resume" ? "play" : command, input);
      console.log(`music-player: command=${command} handled state_dir=${stateDir}`);
      return;
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 3);
    }
  }
  const queued = appendControl(
    { controlsFile: join(stateDir, "controls.jsonl"), stateDir },
    command,
    input,
  );
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = readRunControlJournalFromStateDir(stateDir).records.find(
      (record) => record.id === queued.id,
    );
    if (current?.status === "handled") {
      console.log(
        `music-player: command=${command} handled control_id=${queued.id} state_dir=${stateDir}`,
      );
      return;
    }
    if (current?.status === "failed") {
      fail(current.error || `Control ${queued.id} failed`, 3);
    }
    await sleep(50);
  }
  fail(`Control ${queued.id} did not become terminal`, 3);
}

const [mode, ...rest] = process.argv.slice(2);
const directControlCommands = new Set([
  "pause",
  "resume",
  "toggle",
  "next",
  "previous",
  "seek",
  "volume",
  "stop",
  "status",
]);
if (mode === "play" || mode === "serve") await playMain(rest);
else if (mode === "control") await controlMain(rest);
else if (mode === "seek" || mode === "volume") {
  await controlMain([rest[0], mode, rest[1]]);
} else if (directControlCommands.has(mode)) {
  await controlMain([rest.at(-1), mode === "resume" ? "play" : mode]);
} else if (!mode || mode === "-h" || mode === "--help" || mode === "help") {
  usage();
  process.exit(mode ? 0 : 2);
} else {
  await playMain([mode, ...rest]);
}
