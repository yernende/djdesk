# Audio Quality Contract

This is the current normative contract for DJ Desk audio quality. It is intentionally
not an ADR: ADRs record historical decisions, while this document describes the rule
that importers, APIs, UI code, and future agents must follow now.

## Source Of Truth

Audio quality is derived from the linked audio file with FFprobe. The database columns
are a cache of the probe result, not user-authored metadata.

The source file is `tracks.audio_path`. When `audio_path` changes, any previous quality
cache is stale and must be cleared before the new file is analyzed.

## Canonical Code Paths

Use these paths instead of duplicating the rules:

- Analyze one file with `analyzeAudioQuality` in `apps/server/src/audio/quality.ts`.
- Store an analysis result with `writeTrackAudioQuality` in
  `apps/server/src/audio/quality-backfill.ts`.
- Backfill existing tracks with `backfillAudioQuality` or the CLI script:
  `npm run audio:quality -- --force`.
- In request/retrieval code, call `TrackRepository.updateTrackAudioPath` and then
  `TrackRepository.updateTrackAudioQuality`.

FFprobe is resolved as `FFPROBE_PATH` when set, otherwise `ffprobe`.

## Database Cache

The `tracks` table stores these derived fields:

- `audio_codec`: lower-case FFprobe stream codec name, for example `flac` or `mp3`.
- `audio_container`: lower-case FFprobe format name.
- `audio_sample_rate_hz`: audio stream sample rate in Hz.
- `audio_bit_depth`: `bits_per_raw_sample`, falling back to `bits_per_sample`.
- `audio_bitrate_kbps`: `format.bit_rate`, falling back to `stream.bit_rate`, rounded
  to kbps.
- `audio_bitrate_mode`: `cbr`, `vbr`, or `unknown`, detected best-effort from sampled
  packet rate spread.
- `audio_quality_status`: `hq`, `lossy`, or `unknown`.
- `audio_lossy_high_bitrate`: `1` only for the `Lossy+` hint.
- `audio_quality_analyzed_at`: ISO timestamp for the probe attempt.
- `audio_quality_probe_error`: truncated probe or file error, otherwise `NULL`.

## Classification

`HQ` is strict bit-depth quality:

- `audio_quality_status = 'hq'` only when `audio_sample_rate_hz >= 44100` and
  `audio_bit_depth >= 16`.

Everything else that probes successfully is `Lossy`:

- Bitrate alone never promotes MP3/AAC/Opus/Vorbis to `HQ`.
- Missing bit depth means the track is not proven HQ and remains `lossy`.
- Sample rates below 44.1 kHz remain `lossy`, even with 16-bit depth.

`Lossy+` is a display hint, not a status upgrade:

- `audio_lossy_high_bitrate = 1` only when the status is `lossy`, the codec is known
  lossy, `audio_sample_rate_hz >= 44100`, and `audio_bitrate_kbps >= 256`.

`unknown` is reserved for files that were not analyzed or could not be analyzed:

- Missing or unreadable file.
- FFprobe failure or timeout.
- No audio stream found.
- A track whose `audio_path` was just changed and has not been reprobed yet.

## Importer Rule

Importers must not hand-write `audio_quality_*` classification values. If an importer
sets or changes `tracks.audio_path`, it must either:

- immediately run the canonical analyzer and persist the result, or
- clear the stale cache and make the run finish with `npm run audio:quality -- --force`
  before those tracks are considered analyzed.

## UI Labels

Use these labels consistently:

- `HQ`: strict HQ.
- `Lossy+`: high-bitrate lossy hint.
- `Lossy`: ordinary lossy or not proven HQ.
- `Unknown`: audio exists but analysis has not produced usable quality.
- `No audio`: no linked audio file.

Detailed UI text should derive from the cached fields, for example
`HQ - 16-bit / 44.1 kHz - FLAC` or `Lossy+ - MP3 VBR ~320 kbps / 44.1 kHz`.

## Verification

If the classification changes, update the unit tests in
`apps/server/src/audio/quality.test.ts` first. Then run:

```sh
npm run test
npm run typecheck
```
