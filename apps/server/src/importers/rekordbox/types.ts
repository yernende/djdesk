import type { Track } from "@djdesk/domain";

import type { ImportedKey } from "../shared/keys.ts";

export const rekordboxSourceKind = "rekordbox";

export type RekordboxKeySource = "comments" | "key-column" | "missing";

export interface RekordboxPlaylistEntry {
  artist: string | null;
  bpm: number;
  comment: string | null;
  comments: string | null;
  doesNotFit: boolean;
  harmonyNotes: string | null;
  key: ImportedKey | null;
  keySource: RekordboxKeySource;
  meter: string | null;
  playlistPosition: number;
  rawKey: string | null;
  sourceIdentity: string;
  title: string;
  trackId: string;
}

export interface RekordboxImportOptions {
  databasePath: string;
  fromPosition: number;
  playlistPath: string;
  toPosition: number;
}

export interface RekordboxImportResult {
  errors: RekordboxImportError[];
  importedCount: number;
  importRunId: string;
  rowCount: number;
  skipped: RekordboxSkippedEntry[];
}

export interface RekordboxImportError {
  error: string;
  playlistPosition: number;
  title: string;
}

export interface RekordboxSkippedEntry {
  playlistPosition: number | null;
  reason: string;
  title: string | null;
}

export interface ExistingRekordboxTrackState {
  bpmConfidence: Track["confidence"]["bpm"];
  id: string;
  keyConfidence: Track["confidence"]["key"];
}
