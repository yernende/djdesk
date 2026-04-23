UPDATE tracks SET key_confidence = 'estimated' WHERE key_confidence = 'rejected';
UPDATE tracks SET bpm_confidence = 'estimated' WHERE bpm_confidence = 'rejected';
UPDATE tracks SET chords_confidence = 'estimated' WHERE chords_confidence = 'rejected';

ALTER TABLE tracks
  ADD COLUMN non_standard_tuning INTEGER NOT NULL DEFAULT 0 CHECK (non_standard_tuning IN (0, 1));

CREATE INDEX tracks_non_standard_tuning_idx ON tracks (non_standard_tuning);
