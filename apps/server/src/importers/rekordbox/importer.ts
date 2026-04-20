import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../../db/database.ts";
import { runMigrations } from "../../db/migrations.ts";
import { decodeRekordboxPlaylist, parseRekordboxPlaylist } from "./parse.ts";
import {
  rekordboxSourceKind,
  type ExistingRekordboxTrackState,
  type RekordboxImportOptions,
  type RekordboxImportResult,
  type RekordboxPlaylistEntry,
} from "./types.ts";

export async function importRekordboxPlaylist(
  options: RekordboxImportOptions,
): Promise<RekordboxImportResult> {
  const database = await openDatabase(options.databasePath);

  try {
    await runMigrations(database);

    return await importRekordboxPlaylistIntoDatabase(database, options);
  } finally {
    database.close();
  }
}

export async function importRekordboxPlaylistIntoDatabase(
  database: DatabaseSync,
  options: RekordboxImportOptions,
): Promise<RekordboxImportResult> {
  const playlistPath = resolve(options.playlistPath);
  const importRunId = `imp-${randomUUID()}`;
  const parsed = parseRekordboxPlaylist(decodeRekordboxPlaylist(await readFile(playlistPath)), {
    fromPosition: options.fromPosition,
    toPosition: options.toPosition,
  });
  const errors: RekordboxImportResult["errors"] = [];
  let importedCount = 0;

  insertImportRun(database, importRunId, playlistPath);

  for (const record of parsed.records) {
    try {
      upsertPlaylistEntry(database, importRunId, playlistPath, record);
      importedCount += 1;
    } catch (error) {
      errors.push({
        error: error instanceof Error ? error.message : String(error),
        playlistPosition: record.playlistPosition,
        title: record.title,
      });
    }
  }

  finishImportRun(database, {
    errorCount: errors.length,
    importRunId,
    importedCount,
    rowCount: parsed.rowCount,
    skippedCount: parsed.skipped.length,
  });

  return {
    errors,
    importedCount,
    importRunId,
    rowCount: parsed.rowCount,
    skipped: parsed.skipped,
  };
}

function insertImportRun(database: DatabaseSync, importRunId: string, playlistPath: string): void {
  database
    .prepare(
      `
        INSERT INTO import_runs (id, source_kind, source_root)
        VALUES (?, ?, ?)
      `,
    )
    .run(importRunId, rekordboxSourceKind, playlistPath);
}

function finishImportRun(
  database: DatabaseSync,
  input: {
    errorCount: number;
    importRunId: string;
    importedCount: number;
    rowCount: number;
    skippedCount: number;
  },
): void {
  database
    .prepare(
      `
        UPDATE import_runs
        SET
          finished_at = datetime('now'),
          report_count = ?,
          imported_count = ?,
          skipped_count = ?,
          error_count = ?
        WHERE id = ?
      `,
    )
    .run(
      input.rowCount,
      input.importedCount,
      input.skippedCount,
      input.errorCount,
      input.importRunId,
    );
}

function upsertPlaylistEntry(
  database: DatabaseSync,
  importRunId: string,
  playlistPath: string,
  record: RekordboxPlaylistEntry,
): void {
  const existing = findExistingTrack(database, record.sourceIdentity);
  const trackId = existing?.id ?? record.trackId;
  const shouldUpdateKey =
    Boolean(record.key) && (!existing || existing.keyConfidence === "estimated");
  const shouldUpdateBpm = !existing || existing.bpmConfidence === "estimated";

  database.exec("BEGIN IMMEDIATE");

  try {
    if (existing) {
      updateImportedTrack(database, record, existing, {
        shouldUpdateBpm,
        shouldUpdateKey,
      });
    } else {
      insertImportedTrack(database, record);
    }

    replaceRawPlaylistEntry(database, importRunId, playlistPath, trackId, record);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function findExistingTrack(
  database: DatabaseSync,
  sourceIdentity: string,
): ExistingRekordboxTrackState | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          key_confidence AS keyConfidence,
          bpm_confidence AS bpmConfidence
        FROM tracks
        WHERE source_kind = ? AND source_identity = ?
      `,
    )
    .get(rekordboxSourceKind, sourceIdentity) as unknown as ExistingRekordboxTrackState | undefined;

  return row ?? null;
}

function insertImportedTrack(database: DatabaseSync, record: RekordboxPlaylistEntry): void {
  const key = record.key ?? {
    mode: "major" as const,
    rawKey: "unknown",
    tonic: "C" as const,
    variant: "diatonic" as const,
  };

  database
    .prepare(
      `
        INSERT INTO tracks (
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
          raw_key,
          meter,
          bpm_std,
          source_kind,
          source_identity,
          key_unknown,
          does_not_fit,
          imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'estimated', 'estimated', 'estimated', ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, datetime('now'))
      `,
    )
    .run(
      record.trackId,
      record.title,
      record.artist,
      record.bpm,
      key.tonic,
      key.mode,
      key.variant,
      record.harmonyNotes,
      record.comment,
      record.key?.rawKey ?? null,
      record.meter,
      rekordboxSourceKind,
      record.sourceIdentity,
      record.key ? 0 : 1,
      record.doesNotFit ? 1 : 0,
    );
}

function updateImportedTrack(
  database: DatabaseSync,
  record: RekordboxPlaylistEntry,
  existing: ExistingRekordboxTrackState,
  flags: {
    shouldUpdateBpm: boolean;
    shouldUpdateKey: boolean;
  },
): void {
  database
    .prepare(
      `
        UPDATE tracks
        SET
          title = ?,
          artist = ?,
          bpm = CASE WHEN ? THEN ? ELSE bpm END,
          tonic = CASE WHEN ? THEN ? ELSE tonic END,
          mode = CASE WHEN ? THEN ? ELSE mode END,
          modal_variant = CASE WHEN ? THEN ? ELSE modal_variant END,
          key_unknown = CASE WHEN ? THEN 0 ELSE key_unknown END,
          harmony_notes = ?,
          comment = ?,
          raw_key = ?,
          meter = ?,
          does_not_fit = ?,
          source_kind = ?,
          source_identity = ?,
          imported_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `,
    )
    .run(
      record.title,
      record.artist,
      flags.shouldUpdateBpm ? 1 : 0,
      record.bpm,
      flags.shouldUpdateKey ? 1 : 0,
      record.key?.tonic ?? "C",
      flags.shouldUpdateKey ? 1 : 0,
      record.key?.mode ?? "major",
      flags.shouldUpdateKey ? 1 : 0,
      record.key?.variant ?? "diatonic",
      flags.shouldUpdateKey ? 1 : 0,
      record.harmonyNotes,
      record.comment,
      record.key?.rawKey ?? null,
      record.meter,
      record.doesNotFit ? 1 : 0,
      rekordboxSourceKind,
      record.sourceIdentity,
      existing.id,
    );
}

function replaceRawPlaylistEntry(
  database: DatabaseSync,
  importRunId: string,
  playlistPath: string,
  trackId: string,
  record: RekordboxPlaylistEntry,
): void {
  const entryId = `rbx-${record.sourceIdentity.slice(0, 16)}`;

  database.prepare("DELETE FROM rekordbox_playlist_entries WHERE track_id = ?").run(trackId);
  database
    .prepare(
      `
        INSERT INTO rekordbox_playlist_entries (
          id,
          import_run_id,
          track_id,
          playlist_path,
          playlist_position,
          title,
          artist,
          bpm,
          raw_key,
          parsed_key,
          key_source,
          comments
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      entryId,
      importRunId,
      trackId,
      playlistPath,
      record.playlistPosition,
      record.title,
      record.artist,
      record.bpm,
      record.rawKey,
      record.key?.rawKey ?? "unknown",
      record.keySource,
      record.comments,
    );
}
