CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  bpm REAL NOT NULL CHECK (bpm > 0),
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX tracks_tonic_mode_idx ON tracks (tonic, mode);
CREATE INDEX tracks_bpm_idx ON tracks (bpm);
CREATE INDEX tracks_key_confidence_idx ON tracks (key_confidence);

CREATE TABLE track_chords (
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  symbol TEXT NOT NULL,
  PRIMARY KEY (track_id, position)
);

CREATE TABLE track_tags (
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (track_id, tag)
);

CREATE INDEX track_tags_tag_idx ON track_tags (tag);

CREATE TABLE set_drafts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE set_draft_tracks (
  set_draft_id TEXT NOT NULL REFERENCES set_drafts (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE RESTRICT,
  transition_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (set_draft_id, position)
);

CREATE INDEX set_draft_tracks_track_idx ON set_draft_tracks (track_id);
