import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Track } from "@djdesk/domain";

import { openDatabase } from "../../db/database.ts";
import { runMigrations } from "../../db/migrations.ts";
import { applyReportKeyToTrack, shouldUpdateTrackKeyFromReport } from "./key-sync.ts";
import { parseChordAiKey } from "./keys.ts";

export interface ChordAiKeyBackfillOptions {
  databasePath: string;
  sourceKinds?: readonly string[];
}

export interface ChordAiKeyBackfillError {
  error: string;
  sourceKind: string;
  trackId: string;
}

export interface ChordAiKeyBackfillResult {
  errors: ChordAiKeyBackfillError[];
  importRunId: string;
  scannedCount: number;
  skippedConfirmedCount: number;
  skippedMissingReportCount: number;
  updatedCount: number;
}

interface BackfillCandidate {
  keyConfidence: Track["confidence"]["key"];
  reportRawKey: string | null;
  sourceKind: string;
  trackId: string;
}

const importSourceKind = "chordai-key-backfill";

export async function backfillChordAiKeysFromReports(
  options: ChordAiKeyBackfillOptions,
): Promise<ChordAiKeyBackfillResult> {
  const database = await openDatabase(options.databasePath);

  try {
    await runMigrations(database);

    return backfillChordAiKeysFromReportsIntoDatabase(database, options);
  } finally {
    database.close();
  }
}

export async function backfillChordAiKeysFromReportsIntoDatabase(
  database: DatabaseSync,
  options: ChordAiKeyBackfillOptions,
): Promise<ChordAiKeyBackfillResult> {
  const sourceKinds = options.sourceKinds ?? [];
  const importRunId = `imp-${randomUUID()}`;
  const errors: ChordAiKeyBackfillError[] = [];
  const candidates = readBackfillCandidates(database, sourceKinds);
  let updatedCount = 0;
  let skippedConfirmedCount = 0;
  let skippedMissingReportCount = 0;

  insertImportRun(database, importRunId, sourceKinds);

  database.exec("BEGIN IMMEDIATE");

  try {
    for (const candidate of candidates) {
      if (!shouldUpdateTrackKeyFromReport(candidate)) {
        skippedConfirmedCount += 1;
        continue;
      }

      const reportRawKey = candidate.reportRawKey?.trim() ?? "";

      if (!reportRawKey) {
        skippedMissingReportCount += 1;
        continue;
      }

      try {
        applyReportKeyToTrack(database, candidate.trackId, parseChordAiKey(reportRawKey));
        updatedCount += 1;
      } catch (error) {
        errors.push({
          error: error instanceof Error ? error.message : String(error),
          sourceKind: candidate.sourceKind,
          trackId: candidate.trackId,
        });
      }
    }

    finishImportRun(database, {
      errorCount: errors.length,
      importRunId,
      reportCount: candidates.length,
      skippedCount: skippedConfirmedCount + skippedMissingReportCount,
      updatedCount,
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    errors,
    importRunId,
    scannedCount: candidates.length,
    skippedConfirmedCount,
    skippedMissingReportCount,
    updatedCount,
  };
}

function readBackfillCandidates(
  database: DatabaseSync,
  sourceKinds: readonly string[],
): BackfillCandidate[] {
  const sourceFilter =
    sourceKinds.length > 0
      ? `WHERE t.source_kind IN (${sourceKinds.map(() => "?").join(", ")})`
      : "";

  return database
    .prepare(
      `
        SELECT
          t.id AS trackId,
          t.key_confidence AS keyConfidence,
          t.source_kind AS sourceKind,
          cr.raw_key AS reportRawKey
        FROM tracks t
        LEFT JOIN chordai_reports cr ON cr.track_id = t.id
        ${sourceFilter}
        ORDER BY t.source_kind, t.artist, t.title
      `,
    )
    .all(...sourceKinds) as unknown as BackfillCandidate[];
}

function insertImportRun(
  database: DatabaseSync,
  importRunId: string,
  sourceKinds: readonly string[],
): void {
  database
    .prepare(
      `
        INSERT INTO import_runs (id, source_kind, source_root)
        VALUES (?, ?, ?)
      `,
    )
    .run(importRunId, importSourceKind, sourceKinds.length > 0 ? sourceKinds.join("\n") : "all");
}

function finishImportRun(
  database: DatabaseSync,
  input: {
    errorCount: number;
    importRunId: string;
    reportCount: number;
    skippedCount: number;
    updatedCount: number;
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
      input.reportCount,
      input.updatedCount,
      input.skippedCount,
      input.errorCount,
      input.importRunId,
    );
}
