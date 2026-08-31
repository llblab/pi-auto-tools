# Project Backlog

- [ ] `Next minor — Linux MPRIS media integration`: Expose the active `music-player/playback` singleton as one optional generation-fenced MPRIS2 player so GNOME and compatible desktop shells can show current media and native controls without making D-Bus a second playback authority.
  - [ ] Publish `PlaybackStatus`, track metadata, duration, read-time position, volume, and supported capabilities under one stable session-scoped bus identity; disappear cleanly when the Run stops or its generation is replaced, and fail soft when the user D-Bus session is unavailable.
  - [ ] Map `Play`, `Pause`, `PlayPause`, `Next`, `Previous`, `Stop`, `Seek`, `SetPosition`, and `Volume` back into the existing generation-fenced music-player Control/helper contract rather than signaling the backend or editing Run state directly.
  - [ ] Validate deterministic D-Bus contract behavior plus a live GNOME smoke showing the media surface, metadata, progress, volume, and controls while preserving backend independence and exact Actor ownership.
