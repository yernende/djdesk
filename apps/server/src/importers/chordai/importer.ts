import { randomUUID } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { sampleTracks } from "@djdesk/domain";

import { openDatabase } from "../../db/database.ts";
import { runMigrations } from "../../db/migrations.ts";
import { compactChordProgression, parseChordAiReport } from "./parse.ts";
import {
  chordAiSourceKind,
  type ChordAiBar,
  type ChordAiChordSegment,
  type ChordAiImportOptions,
  type ChordAiImportResult,
  type ChordAiReport,
  type ExistingTrackState,
} from "./types.ts";

const expectedFiles = [
  "summary.md",
  "transcription.json",
  "chord_segments.csv",
  "bar_grid.csv",
  "android_meta_data.json",
] as const;

export async function importChordAiReports(
  options: ChordAiImportOptions,
): Promise<ChordAiImportResult> {
  const database = await openDatabase(options.databasePath);

  try {
    await runMigrations(database);

    return await importChordAiReportsIntoDatabase(database, options);
  } finally {
    database.close();
  }
}

export async function importChordAiReportsIntoDatabase(
  database: DatabaseSync,
  options: ChordAiImportOptions,
): Promise<ChordAiImportResult> {
  const reportsRoot = resolve(options.reportsPath);
  const importRunId = `imp-${randomUUID()}`;
  const skipped: ChordAiImportResult["skipped"] = [];
  const errors: ChordAiImportResult["errors"] = [];
  let importedCount = 0;
  let reportCount = 0;

  insertImportRun(database, importRunId, reportsRoot);

  if (options.removeSamples) {
    removeSampleTracks(database);
  }

  const folders = await readReportFolders(reportsRoot);

  for (const folder of folders) {
    const missingFiles = await findMissingFiles(folder);

    if (missingFiles.length > 0) {
      skipped.push({
        reason: `Missing files: ${missingFiles.join(", ")}`,
        reportPath: folder,
      });
      continue;
    }

    reportCount += 1;

    try {
      const report = parseChordAiReport({
        androidMetaData: await readFile(resolve(folder, "android_meta_data.json"), "utf8"),
        barGridCsv: await readFile(resolve(folder, "bar_grid.csv"), "utf8"),
        chordSegmentsCsv: await readFile(resolve(folder, "chord_segments.csv"), "utf8"),
        reportPath: folder,
        summaryMarkdown: await readFile(resolve(folder, "summary.md"), "utf8"),
        transcriptionJson: await readFile(resolve(folder, "transcription.json"), "utf8"),
      });

      upsertReport(database, importRunId, report);
      importedCount += 1;
    } catch (error) {
      errors.push({
        error: error instanceof Error ? error.message : String(error),
        reportPath: folder,
      });
    }
  }

  finishImportRun(database, {
    errorCount: errors.length,
    importRunId,
    importedCount,
    reportCount,
    skippedCount: skipped.length,
  });

  return {
    errors,
    importedCount,
    importRunId,
    reportCount,
    skipped,
  };
}

async function readReportFolders(reportsRoot: string): Promise<string[]> {
  const entries = await readdir(reportsRoot, {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(reportsRoot, entry.name))
    .sort((first, second) => basename(first).localeCompare(basename(second)));
}

async function findMissingFiles(reportPath: string): Promise<string[]> {
  const missing: string[] = [];

  for (const fileName of expectedFiles) {
    try {
      await access(resolve(reportPath, fileName));
    } catch {
      missing.push(fileName);
    }
  }

  return missing;
}

function insertImportRun(database: DatabaseSync, importRunId: string, sourceRoot: string): void {
  database
    .prepare(
      `
        INSERT INTO import_runs (id, source_kind, source_root)
        VALUES (?, ?, ?)
      `,
    )
    .run(importRunId, chordAiSourceKind, sourceRoot);
}

function finishImportRun(
  database: DatabaseSync,
  input: {
    errorCount: number;
    importRunId: string;
    importedCount: number;
    reportCount: number;
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
      input.reportCount,
      input.importedCount,
      input.skippedCount,
      input.errorCount,
      input.importRunId,
    );
}

function removeSampleTracks(database: DatabaseSync): void {
  const sampleIds = sampleTracks.map((track) => track.id);

  if (sampleIds.length === 0) {
    return;
  }

  const placeholders = sampleIds.map(() => "?").join(", ");

  database.exec("BEGIN IMMEDIATE");

  try {
    database
      .prepare(`DELETE FROM set_draft_tracks WHERE track_id IN (${placeholders})`)
      .run(...sampleIds);
    database.prepare(`DELETE FROM tracks WHERE id IN (${placeholders})`).run(...sampleIds);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function upsertReport(database: DatabaseSync, importRunId: string, report: ChordAiReport): void {
  const existing = findExistingTrack(database, report.sourceIdentity);
  const trackId = existing?.id ?? report.trackId;
  const compactProgression = compactChordProgression(report.chordSegments);
  const shouldUpdateKey = !existing || existing.keyConfidence === "estimated";
  const shouldUpdateBpm = !existing || existing.bpmConfidence === "estimated";
  const shouldUpdateChords = !existing || existing.chordsConfidence === "estimated";

  database.exec("BEGIN IMMEDIATE");

  try {
    if (existing) {
      updateImportedTrack(database, report, existing, {
        shouldUpdateBpm,
        shouldUpdateChords,
        shouldUpdateKey,
      });
    } else {
      insertImportedTrack(database, report);
    }

    if (shouldUpdateChords) {
      replaceCompactChords(database, trackId, compactProgression);
    }

    replaceRawReport(database, importRunId, trackId, report);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function findExistingTrack(
  database: DatabaseSync,
  sourceIdentity: string,
): ExistingTrackState | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          key_confidence AS keyConfidence,
          bpm_confidence AS bpmConfidence,
          chords_confidence AS chordsConfidence
        FROM tracks
        WHERE source_kind = ? AND source_identity = ?
      `,
    )
    .get(chordAiSourceKind, sourceIdentity) as unknown as ExistingTrackState | undefined;

  return row ?? null;
}

function insertImportedTrack(database: DatabaseSync, report: ChordAiReport): void {
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
          imported_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'diatonic', 'estimated', 'estimated', 'estimated', NULL, NULL, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    )
    .run(
      report.trackId,
      report.title,
      report.bpm,
      report.key.tonic,
      report.key.mode,
      Math.round(report.durationSeconds),
      report.key.rawKey,
      report.meter,
      report.bpmStd,
      chordAiSourceKind,
      report.sourceIdentity,
    );
}

function updateImportedTrack(
  database: DatabaseSync,
  report: ChordAiReport,
  existing: ExistingTrackState,
  flags: {
    shouldUpdateBpm: boolean;
    shouldUpdateChords: boolean;
    shouldUpdateKey: boolean;
  },
): void {
  database
    .prepare(
      `
        UPDATE tracks
        SET
          title = ?,
          bpm = CASE WHEN ? THEN ? ELSE bpm END,
          tonic = CASE WHEN ? THEN ? ELSE tonic END,
          mode = CASE WHEN ? THEN ? ELSE mode END,
          modal_variant = CASE WHEN ? THEN 'diatonic' ELSE modal_variant END,
          chords_confidence = CASE WHEN ? THEN 'estimated' ELSE chords_confidence END,
          duration_seconds = ?,
          raw_key = ?,
          meter = ?,
          bpm_std = ?,
          source_kind = ?,
          source_identity = ?,
          imported_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `,
    )
    .run(
      report.title,
      flags.shouldUpdateBpm ? 1 : 0,
      report.bpm,
      flags.shouldUpdateKey ? 1 : 0,
      report.key.tonic,
      flags.shouldUpdateKey ? 1 : 0,
      report.key.mode,
      flags.shouldUpdateKey ? 1 : 0,
      flags.shouldUpdateChords ? 1 : 0,
      Math.round(report.durationSeconds),
      report.key.rawKey,
      report.meter,
      report.bpmStd,
      chordAiSourceKind,
      report.sourceIdentity,
      existing.id,
    );
}

function replaceCompactChords(
  database: DatabaseSync,
  trackId: string,
  chordProgression: readonly string[],
): void {
  const insertChord = database.prepare(`
    INSERT INTO track_chords (track_id, position, symbol)
    VALUES (?, ?, ?)
  `);

  database.prepare("DELETE FROM track_chords WHERE track_id = ?").run(trackId);

  chordProgression.forEach((symbol, index) => {
    insertChord.run(trackId, index, symbol);
  });
}

function replaceRawReport(
  database: DatabaseSync,
  importRunId: string,
  trackId: string,
  report: ChordAiReport,
): void {
  const reportId = `rep-${report.sourceIdentity.slice(0, 16)}`;

  database.prepare("DELETE FROM chordai_reports WHERE track_id = ?").run(trackId);
  database
    .prepare(
      `
        INSERT INTO chordai_reports (
          id,
          import_run_id,
          track_id,
          report_path,
          report_folder_name,
          title,
          audio_file_name,
          source_export,
          duration_seconds,
          bpm,
          bpm_std,
          meter,
          raw_key,
          bars_count,
          chord_segments_count,
          creation_date,
          last_edit_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      reportId,
      importRunId,
      trackId,
      report.reportPath,
      report.folderName,
      report.title,
      report.audioFileName,
      report.sourceExport,
      report.durationSeconds,
      report.bpm,
      report.bpmStd,
      report.meter,
      report.key.rawKey,
      report.bars.length,
      report.chordSegments.length,
      report.creationDate,
      report.lastEditDate,
    );

  insertChordSegments(database, reportId, report.chordSegments);
  insertBars(database, reportId, report.bars);
}

function insertChordSegments(
  database: DatabaseSync,
  reportId: string,
  segments: readonly ChordAiChordSegment[],
): void {
  const insertSegment = database.prepare(`
    INSERT INTO chordai_chord_segments (
      report_id,
      segment_index,
      start_s,
      end_s,
      duration_s,
      chord,
      bass,
      label,
      basic_label,
      degree,
      midi_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const segment of segments) {
    insertSegment.run(
      reportId,
      segment.index,
      segment.startS,
      segment.endS,
      segment.durationS,
      segment.chord,
      segment.bass,
      segment.label,
      segment.basicLabel,
      segment.degree,
      segment.midiNotes,
    );
  }
}

function insertBars(database: DatabaseSync, reportId: string, bars: readonly ChordAiBar[]): void {
  const insertBar = database.prepare(`
    INSERT INTO chordai_bars (
      report_id,
      bar,
      start_s,
      duration_s,
      bpm,
      basic_progression,
      slash_bass_progression,
      beat_1,
      beat_2,
      beat_3,
      beat_4
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const bar of bars) {
    insertBar.run(
      reportId,
      bar.bar,
      bar.startS,
      bar.durationS,
      bar.bpm,
      bar.basicProgression,
      bar.slashBassProgression,
      bar.beat1,
      bar.beat2,
      bar.beat3,
      bar.beat4,
    );
  }
}
