ALTER TABLE tracks ADD COLUMN raw_key TEXT;
ALTER TABLE tracks ADD COLUMN meter TEXT;
ALTER TABLE tracks ADD COLUMN bpm_std REAL;
ALTER TABLE tracks ADD COLUMN source_kind TEXT;
ALTER TABLE tracks ADD COLUMN source_identity TEXT;
ALTER TABLE tracks ADD COLUMN imported_at TEXT;

CREATE UNIQUE INDEX tracks_source_identity_idx
  ON tracks (source_kind, source_identity)
  WHERE source_kind IS NOT NULL AND source_identity IS NOT NULL;

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_root TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  report_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chordai_reports (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL REFERENCES import_runs (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  report_path TEXT NOT NULL,
  report_folder_name TEXT NOT NULL,
  title TEXT NOT NULL,
  audio_file_name TEXT,
  source_export TEXT,
  duration_seconds REAL,
  bpm REAL,
  bpm_std REAL,
  meter TEXT,
  raw_key TEXT,
  bars_count INTEGER,
  chord_segments_count INTEGER,
  creation_date TEXT,
  last_edit_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX chordai_reports_track_idx ON chordai_reports (track_id);
CREATE INDEX chordai_reports_import_run_idx ON chordai_reports (import_run_id);

CREATE TABLE chordai_chord_segments (
  report_id TEXT NOT NULL REFERENCES chordai_reports (id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  start_s REAL NOT NULL,
  end_s REAL NOT NULL,
  duration_s REAL NOT NULL,
  chord TEXT NOT NULL,
  bass TEXT,
  label TEXT NOT NULL,
  basic_label TEXT,
  degree TEXT,
  midi_notes TEXT,
  PRIMARY KEY (report_id, segment_index)
);

CREATE TABLE chordai_bars (
  report_id TEXT NOT NULL REFERENCES chordai_reports (id) ON DELETE CASCADE,
  bar INTEGER NOT NULL,
  start_s REAL NOT NULL,
  duration_s REAL NOT NULL,
  bpm REAL,
  basic_progression TEXT,
  slash_bass_progression TEXT,
  beat_1 TEXT,
  beat_2 TEXT,
  beat_3 TEXT,
  beat_4 TEXT,
  PRIMARY KEY (report_id, bar)
);
