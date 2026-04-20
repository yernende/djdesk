-- djdesk:migration transaction-managed

DELETE FROM set_draft_tracks
WHERE track_id IN (
  SELECT id
  FROM tracks
  WHERE source_kind = 'debug-fixture' OR id LIKE 'demo-fake-%'
);

DELETE FROM tracks
WHERE source_kind = 'debug-fixture' OR id LIKE 'demo-fake-%';

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

CREATE TABLE tracks_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  bpm REAL CHECK (bpm IS NULL OR bpm > 0),
  tonic TEXT NOT NULL,
  mode TEXT NOT NULL,
  modal_variant TEXT NOT NULL,
  key_confidence TEXT NOT NULL,
  bpm_confidence TEXT NOT NULL,
  chords_confidence TEXT NOT NULL,
  harmony_notes TEXT,
  comment TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_key TEXT,
  meter TEXT,
  bpm_std REAL,
  source_kind TEXT,
  source_identity TEXT,
  imported_at TEXT,
  key_unknown INTEGER NOT NULL DEFAULT 0 CHECK (key_unknown IN (0, 1)),
  does_not_fit INTEGER NOT NULL DEFAULT 0 CHECK (does_not_fit IN (0, 1)),
  audio_path TEXT
);

INSERT INTO tracks_new (
  id,
  title,
  artist,
  bpm,
  tonic,
  mode,
  modal_variant,
  key_confidence,
  bpm_confidence,
  chords_confidence,
  harmony_notes,
  comment,
  duration_seconds,
  created_at,
  updated_at,
  raw_key,
  meter,
  bpm_std,
  source_kind,
  source_identity,
  imported_at,
  key_unknown,
  does_not_fit,
  audio_path
)
SELECT
  id,
  title,
  artist,
  bpm,
  tonic,
  mode,
  modal_variant,
  key_confidence,
  bpm_confidence,
  chords_confidence,
  harmony_notes,
  comment,
  duration_seconds,
  created_at,
  updated_at,
  raw_key,
  meter,
  bpm_std,
  source_kind,
  source_identity,
  imported_at,
  key_unknown,
  does_not_fit,
  audio_path
FROM tracks;

DROP TABLE tracks;

ALTER TABLE tracks_new RENAME TO tracks;

CREATE INDEX tracks_tonic_mode_idx ON tracks (tonic, mode);
CREATE INDEX tracks_bpm_idx ON tracks (bpm);
CREATE INDEX tracks_key_confidence_idx ON tracks (key_confidence);

CREATE UNIQUE INDEX tracks_source_identity_idx
  ON tracks (source_kind, source_identity)
  WHERE source_kind IS NOT NULL AND source_identity IS NOT NULL;

CREATE INDEX tracks_key_unknown_idx ON tracks (key_unknown);
CREATE INDEX tracks_does_not_fit_idx ON tracks (does_not_fit);

CREATE INDEX tracks_audio_path_idx
  ON tracks (audio_path)
  WHERE audio_path IS NOT NULL;

COMMIT;

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
