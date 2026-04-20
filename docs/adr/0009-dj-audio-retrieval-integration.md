# ADR 0009: DJ Audio Retrieval Integration

## Status

Accepted.

## Context

DJ Desk can already store an `audio_path` and upload a local audio file, but the
actual retrieval workflow lives in the sibling `~/Development/dj` CLI. That CLI
has useful Yandex, SpotiFLAC, and Lucida fallback behavior, including two manual
candidate-picking stages.

Parsing terminal output would make DJ Desk fragile and would couple the UI to
CLI decoration. The sibling project now exposes a small machine-readable
single-track API, while the existing CLI keeps its current behavior.

## Decision

DJ Desk integrates with `~/Development/dj` through its programmatic API:

- Yandex search returns selectable lossless candidates.
- Yandex download writes into DJ Desk's configured `AUDIO_UPLOAD_DIR`.
- If Yandex is skipped or fails, Spotify search returns selectable SpotiFLAC
  candidates.
- If SpotiFLAC is skipped or fails, the server returns a Lucida URL and the
  client opens/shows it.
- Successful retrieval updates only `tracks.audio_path`; track metadata,
  comments, analysis, source/import fields, and verification states remain
  unchanged.

The output folder remains configured by `AUDIO_UPLOAD_DIR`. The UI displays that
path read-only; changing it from the website is intentionally deferred.

Retrieval jobs are in memory only. They are meant to drive the current UI flow,
not to be an audit log or durable queue.

## Consequences

- DJ Desk reuses the downloader's behavior without duplicating the integration
  with Yandex, Spotify, SpotiFLAC, FFmpeg, and Lucida.
- Lucida opens on the client device instead of the Fastify host, which is better
  when DJ Desk is accessed over the local network.
- Server restart or page reload may lose retrieval job state. The track remains
  correct if audio was already linked.

## Further Considerations

- Persist retrieval job history/state in SQLite if retrievals become long-lived
  or multi-user.
- Add playlist retrieval as a separate bulk import flow.
- Add manual linking to an already downloaded Lucida file.
- Consider a future UI setting for switching `AUDIO_UPLOAD_DIR`, with careful
  validation and deployment rules.
