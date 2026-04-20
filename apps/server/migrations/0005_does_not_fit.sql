ALTER TABLE tracks ADD COLUMN does_not_fit INTEGER NOT NULL DEFAULT 0 CHECK (does_not_fit IN (0, 1));

CREATE INDEX tracks_does_not_fit_idx ON tracks (does_not_fit);
