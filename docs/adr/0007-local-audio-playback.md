# ADR 0007: Local Audio Playback

## Status

Accepted.

## Date

2026-04-20

## Context

DJ Desk now stores the real track catalog, and the operator needs to listen to
tracks while planning a set. The audio files already exist on the local machine
and should remain the source of truth. The app should not copy or re-encode them
into the project.

Browsers cannot reliably play arbitrary local filesystem paths from a web app,
and direct `file://` URLs would not be suitable once the app moves from local
hosting to a server.

## Decision

Store an optional absolute `audio_path` on `tracks`.

Add a repeatable audio-linking CLI:

- root command: `npm run audio:link -- --root "<music folder>"`.
- server command: `audio:link`.
- the linker recursively scans configured roots for audio files.
- supported extensions are `.aac`, `.aif`, `.aiff`, `.flac`, `.m4a`, `.mp3`,
  and `.wav`.
- files are matched against imported ChordAI filenames, track titles, and
  artist-title combinations.
- matching normalizes punctuation, accents, underscores, dashes, safe join-word
  differences, and optional filename extensions.
- the database stores the chosen absolute path and does not copy the file.

Expose playback through Fastify, not through direct filesystem URLs:

- `GET /api/tracks/:trackId/audio` streams the linked file.
- the route only accepts a track id and reads the path from SQLite.
- range requests are supported so browser controls can seek within long tracks.
- content type is inferred from the linked file extension.

Keep the first UI implementation simple:

- the track browser shows a compact `audio` chip when a source file is linked.
- the focus panel shows a native browser audio control for the selected track.
- the native control gives play, pause, volume, and timeline scrubbing without
  adding a custom waveform dependency yet.
- if the operator changes the focused track while the current focused track is
  playing, the newly focused track starts automatically.
- if the current focused track is paused, changing focus stays silent.

## Consequences

- Local files remain the single source of truth, and the app can be relinked
  after new analysis/import work.
- The local database contains machine-specific absolute paths, so it is still
  ignored by git.
- Playback works through the same HTTP origin as the API and can later be
  replaced by object storage or managed media URLs without changing the client
  shape much.
- Native audio controls are enough for the current spike, but a future DJ
  workflow may add waveform previews, cue points, gain display, or keyboard
  shortcuts.

## Further Considerations

- A persistent mini-player may be useful once focus changes become frequent,
  because it would separate "currently playing" from "currently inspected".
- The follow-playback behavior may eventually need an explicit UI toggle if the
  operator alternates between listening mode and catalog inspection mode.
- Waveform previews, cue markers, and beat-grid overlays should be considered
  only after the basic catalog/player flow feels stable.
- Server deployment will need a media-source strategy that replaces local
  absolute paths with managed storage paths or mounted media volumes.
