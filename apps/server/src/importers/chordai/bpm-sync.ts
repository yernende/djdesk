import type { Track } from "@djdesk/domain";
import type { DatabaseSync } from "node:sqlite";

export interface TrackBpmSyncState {
  bpmConfidence: Track["confidence"]["bpm"];
}

export function shouldUpdateTrackBpmFromReport(state: TrackBpmSyncState): boolean {
  return state.bpmConfidence !== "confirmed";
}

export function applyReportBpmToTrack(database: DatabaseSync, trackId: string, bpm: number): void {
  database
    .prepare(
      `
        UPDATE tracks
        SET
          bpm = ?,
          bpm_confidence = 'estimated',
          updated_at = datetime('now')
        WHERE id = ?
      `,
    )
    .run(bpm, trackId);
}
