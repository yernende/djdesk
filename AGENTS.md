# Agent Notes

## Audio Quality

Audio quality is a derived contract, not hand-authored track metadata. Before changing
imports, retrieval, uploads, audio linking, or any `audio_quality_*` column, read
`docs/specs/audio-quality.md`.

Do not classify tracks by writing `audio_quality_status` directly from an importer.
Use the canonical analyzer/repository path:

- `analyzeAudioQuality` in `apps/server/src/audio/quality.ts`
- `writeTrackAudioQuality` or `backfillAudioQuality` in
  `apps/server/src/audio/quality-backfill.ts`
- `TrackRepository.updateTrackAudioPath` followed by
  `TrackRepository.updateTrackAudioQuality`
- `npm run audio:quality -- --force` for a full backfill

Any code path that changes `tracks.audio_path` must clear stale quality and then
recompute it, or run the backfill before the track is treated as analyzed.
