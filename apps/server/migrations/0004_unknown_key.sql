ALTER TABLE tracks ADD COLUMN key_unknown INTEGER NOT NULL DEFAULT 0 CHECK (key_unknown IN (0, 1));

CREATE INDEX tracks_key_unknown_idx ON tracks (key_unknown);
