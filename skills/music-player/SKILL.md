---
name: music-player
description: Use for starting, resuming, inspecting, and controlling one persistent local music playback actor from caller-approved files, directories, URLs, or playlists.
---

# Music Player

Use this Skill for one local music playback service. For generic Recipe execution, singleton Run lifecycle, persistent-tool setup, or diagnosis, follow `actors`; this Skill owns only playback-specific selection and controls.

## Interaction Routing

When a Telegram-originated turn or explicit Telegram-control question makes repeated player controls relevant, prefer the maintained Telegram view described below over synthesizing one-shot prompt buttons. If `telegram_bind` is available, load and follow the active operating guidance that owns Generative Apps, then bind or invoke the capability-owned adapter; do not re-author it or move playback authority into the view. If the runtime is unavailable or binding fails, report that boundary and fall back to ordinary model-mediated controls.

## Playback

`music-player/playback` is a singleton async controlled service with the canonical address `run:music-player`. The Recipe is the sole lifecycle owner: it starts the service, supervises it, and stops playback when the Run closes. The service owns queue, backend, checkpoint, and playback state. `scripts/playback.mjs` owns both foreground playback and the bounded control CLI. Its `control <state-dir> <action> [percent]` entrypoint observes or controls an existing owner without starting, adopting, or supervising it. Explicit foreground `serve` supports a caller-owned standalone host without importing the Actor runtime; Actor and standalone ownership of one state directory are mutually exclusive.

```text
spawn recipe=music-player/playback values={"source":"~/Music","player":"auto"}
message target=run:music-player action=pause
message target=run:music-player action=next
inspect target=run:music-player view=control
```

A repeated compatible spawn returns the healthy active singleton instead of launching a second player. A terminal or dead singleton restarts under the same Run id with a fresh fenced generation and restores its validated playback checkpoint when the source and configuration still match.

## Controls

Use only declared actions: `play`, `pause`, `resume`, `toggle`, `next`, `previous`, `seek`, `volume`, `stop`, and `status`.

- `play` and `resume` continue the current checkpointed track selection.
- `next` and `previous` update the checkpoint before the next backend launch.
- `seek` accepts Control input `{ "percent": 0..100 }`, resolves the current track duration, and restarts a supported backend at that percentage while preserving track identity and paused/playing intent. It fails when duration or backend seeking is unavailable.
- `volume` accepts Control input `{ "percent": 0..100 }` and sets any integer percentage. On Linux with WirePlumber, the helper resolves the exact current playback stream by process identity and changes its volume in place so the track continues; when no safe in-place control exists, it restarts the current track under the new volume while preserving paused/playing intent. UI adapters may expose coarse relative steps but must send the resolved absolute percentage.
- `status` is read-only and exposes bounded machine-readable player state, including the current absolute volume and a duration-derived progress percentage projected at read time.
- `stop` ends the live process without silently deleting the saved queue.

External local views use `playback.mjs control <state-dir> <action> [percent]`. For Actor-owned playback, the script validates Run availability, queues canonical Control, and waits for that exact record to become handled or failed. For standalone playback, it sends a bounded generation-fenced command to the service endpoint without creating Run, Control, or Trace state. Views themselves never read or edit Run files, signal processes, construct Control records, or import pi-actors internals. `status` is read-only and reports `actor_available` separately from playback state.

## Maintained Telegram View

> [!NOTE]
> This Skill includes a ready Music Player Generative App at `genapps/music-player.mjs`. When `telegram_bind` is available and Telegram interaction is relevant, use it to copy and install the app as `music-player`; hot replacement keeps the same app name with `replace: true`.

Bind with absolute `control` (the `scripts/playback.mjs` path), `stateDir`, and `node` arguments. This maintained adapter targets Actor-owned playback and uses the unified `control` entrypoint above for status and mutation; it displays controls only when `actor_available` is true. Exact terminal Control evidence remains visible in the Run inspector and failures reach Telegram. The adapter neither imports extension internals nor starts playback. Its stopped-state Start button returns to Pi so the composition root can spawn `music-player/playback`, while active controls remain deterministic Generative App actions that bypass the model. `pi-telegram` owns only the generic Generative App runtime.

## Sources And Backends

- `source` must name caller-approved local music, a readable directory, a playlist file, a URL, or an explicit `|`-separated list. Do not broaden it to unrelated directories.
- Directory and playlist resolution is owned by the playback helper; there is no separate public playlist Recipe.
- `player=auto` selects an available supported backend. Do not install or substitute a player silently.
- The checkpoint preserves source, resolved queue, current index/track, loop, volume, backend, and playback state. It does not promise within-track position restoration unless the selected backend can prove it.
- A changed source rebuilds the queue. Missing or corrupt checkpoint data fails visibly or rebuilds only under the helper's explicit recovery contract; never claim continuity without evidence.

## Stop Rules

Stop if the source is missing, unreadable, contains no playable audio, or no supported backend is available. Do not claim playback from process start alone; confirm through Run evidence or `status`. Prefer the declared `stop` action for a responsive player. If the service is unresponsive, return to `actors` for bounded Run recovery rather than shell process control.
