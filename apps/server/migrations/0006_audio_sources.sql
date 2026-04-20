ALTER TABLE tracks ADD COLUMN audio_path TEXT;

CREATE INDEX tracks_audio_path_idx
  ON tracks (audio_path)
  WHERE audio_path IS NOT NULL;
