import type { Track, TrackKey } from "@djdesk/domain";
import type { DatabaseSync } from "node:sqlite";

export interface TrackKeyUpdate {
  mode: TrackKey["mode"];
  rawKey: string;
  tonic: TrackKey["tonic"];
  variant?: TrackKey["variant"];
}

export interface TrackKeySyncState {
  keyConfidence: Track["confidence"]["key"];
}

export function shouldUpdateTrackKeyFromReport(state: TrackKeySyncState): boolean {
  return state.keyConfidence !== "confirmed";
}

export function applyReportKeyToTrack(
  database: DatabaseSync,
  trackId: string,
  key: TrackKeyUpdate,
): void {
  database
    .prepare(
      `
        UPDATE tracks
        SET
          tonic = ?,
          mode = ?,
          modal_variant = ?,
          raw_key = ?,
          key_unknown = 0,
          key_confidence = 'estimated',
          updated_at = datetime('now')
        WHERE id = ?
      `,
    )
    .run(key.tonic, key.mode, key.variant ?? "diatonic", key.rawKey, trackId);
}
