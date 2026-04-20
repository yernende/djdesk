CREATE TABLE rekordbox_playlist_entries (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL REFERENCES import_runs (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  playlist_path TEXT NOT NULL,
  playlist_position INTEGER NOT NULL CHECK (playlist_position > 0),
  title TEXT NOT NULL,
  artist TEXT,
  bpm REAL NOT NULL CHECK (bpm > 0),
  raw_key TEXT,
  parsed_key TEXT NOT NULL,
  key_source TEXT NOT NULL,
  comments TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX rekordbox_playlist_entries_track_idx
  ON rekordbox_playlist_entries (track_id);

CREATE INDEX rekordbox_playlist_entries_import_run_idx
  ON rekordbox_playlist_entries (import_run_id);

CREATE INDEX rekordbox_playlist_entries_position_idx
  ON rekordbox_playlist_entries (playlist_position);
