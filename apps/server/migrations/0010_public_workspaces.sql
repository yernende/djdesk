CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  access_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE set_drafts ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE set_drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE INDEX set_drafts_workspace_idx ON set_drafts(workspace_id);

CREATE TABLE workspace_sessions (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  access_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX workspace_sessions_expiry_idx ON workspace_sessions(expires_at);

-- Publication is opt-in. Existing private catalogues are never exposed by migration.
CREATE TABLE public_catalog (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  audio_enabled INTEGER NOT NULL DEFAULT 0 CHECK (audio_enabled IN (0, 1))
);

CREATE TABLE public_rate_limits (
  bucket TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, subject_hash)
);
