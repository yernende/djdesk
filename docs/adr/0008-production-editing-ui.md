# ADR 0008: Production Editing UI

## Status

Accepted.

## Date

2026-04-20

## Context

DJ Desk started with imported catalog data, synthetic boundary examples, and
client-side draft sets. That was useful for proving the modal-circle workflow,
but it was not enough for real evening use: sets, manual track additions, audio
uploads, and BPM/key verification need to persist in SQLite.

## Decision

Use the existing SQLite database as the production editing store.

Persist sets through `set_drafts` and `set_draft_tracks`:

- the default set list is empty.
- users can create, rename, delete, reorder, and sort sets from the UI.
- repeated tracks in one set remain allowed.
- deleting a set uses the browser's native confirmation dialog.

Move demo data behind an explicit client feature flag:

- `VITE_ENABLE_DEMO_DATA=true` enables local demo tracks and mock sets.
- production UI uses only API/SQLite data by default.
- synthetic debug fixtures are removed from SQLite by migration.

Allow manual track creation from the UI:

- only `title` is required.
- artist, BPM, key, harmony notes, comments, compact chords, tags, and audio are
  optional.
- missing BPM is stored as `NULL` and shown as unknown.
- missing key uses `key_unknown = 1`, appears in the unknown-key shelf, and is
  selected from the tonic dropdown rather than through a separate checkbox.
- manually supplied BPM/key values default to confirmed confidence.
- tracks that are not aligned to standard A=440 Hz tuning use a separate
  `non_standard_tuning` flag. This is a caution marker only; it does not hide
  the track from the circle.

Add structured track editing and verification:

- BPM and key can be edited independently.
- BPM/key confidence can be changed independently with two states: unverified
  and confirmed.
- key editing uses structured tonic, mode, and variant controls instead of a
  free-text parser.
- comments, harmony notes, compact chords, and tags can be edited from the
  focus panel.
- imports keep preserving confirmed manual BPM/key values.

Support optional audio upload for manual operation:

- `@fastify/multipart` handles uploads.
- `AUDIO_UPLOAD_DIR` configures the target folder.
- the default is `data/audio`, relative to the repository root.
- uploaded audio is stored by path and streamed through the existing audio
  endpoint.
- Unicode filenames are preserved on disk and served through the existing
  Unicode-safe `Content-Disposition` behavior.

## Consequences

- DJ Desk can now be used as a real local planning tool rather than a local UI
  mock.
- SQLite becomes the source of truth for set order and manual metadata.
- Unknown BPM/key states are first-class and do not force fake musical values
  into the UI.
- Demo data remains available for future layout testing without polluting the
  production database.
- The upload directory is still a local-first compromise; hosted deployment will
  need a deliberate storage strategy later.
