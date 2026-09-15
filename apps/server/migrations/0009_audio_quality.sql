ALTER TABLE tracks
  ADD COLUMN audio_codec TEXT;

ALTER TABLE tracks
  ADD COLUMN audio_container TEXT;

ALTER TABLE tracks
  ADD COLUMN audio_sample_rate_hz INTEGER CHECK (
    audio_sample_rate_hz IS NULL OR audio_sample_rate_hz > 0
  );

ALTER TABLE tracks
  ADD COLUMN audio_bit_depth INTEGER CHECK (
    audio_bit_depth IS NULL OR audio_bit_depth > 0
  );

ALTER TABLE tracks
  ADD COLUMN audio_bitrate_kbps INTEGER CHECK (
    audio_bitrate_kbps IS NULL OR audio_bitrate_kbps > 0
  );

ALTER TABLE tracks
  ADD COLUMN audio_bitrate_mode TEXT NOT NULL DEFAULT 'unknown' CHECK (
    audio_bitrate_mode IN ('cbr', 'unknown', 'vbr')
  );

ALTER TABLE tracks
  ADD COLUMN audio_quality_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    audio_quality_status IN ('hq', 'lossy', 'unknown')
  );

ALTER TABLE tracks
  ADD COLUMN audio_lossy_high_bitrate INTEGER NOT NULL DEFAULT 0 CHECK (
    audio_lossy_high_bitrate IN (0, 1)
  );

ALTER TABLE tracks
  ADD COLUMN audio_quality_analyzed_at TEXT;

ALTER TABLE tracks
  ADD COLUMN audio_quality_probe_error TEXT;

CREATE INDEX tracks_audio_quality_status_idx ON tracks (audio_quality_status);

CREATE INDEX tracks_audio_lossy_high_bitrate_idx ON tracks (audio_lossy_high_bitrate);
