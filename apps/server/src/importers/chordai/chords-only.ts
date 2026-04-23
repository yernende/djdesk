import { createHash, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../../db/database.ts";
import { runMigrations } from "../../db/migrations.ts";
import { parseCsv } from "./csv.ts";
import { applyReportKeyToTrack, shouldUpdateTrackKeyFromReport } from "./key-sync.ts";
import { compactChordProgression, parseChordAiReport } from "./parse.ts";
import type { ChordAiBar, ChordAiChordSegment, ChordAiReport } from "./types.ts";
import type { Track } from "@djdesk/domain";

export interface ChordAiChordsOnlyOptions {
  databasePath: string;
  manifestPath: string;
  statePath: string;
}

export interface ChordAiChordsOnlyResult {
  errors: ChordAiChordsOnlyError[];
  importedCount: number;
  importRunId: string;
  reportCount: number;
  skipped: ChordAiChordsOnlySkipped[];
}

export interface ChordAiChordsOnlyError {
  error: string;
  reportPath: string | null;
  trackId: string;
}

export interface ChordAiChordsOnlySkipped {
  reason: string;
  reportPath: string | null;
  trackId: string;
}

interface ManifestRow {
  localAudioPath: string;
  phonePath: string;
  playlistPosition: number;
  title: string;
  trackId: string;
}

interface StateRow {
  localReportDir: string;
  status: string;
  trackPath: string;
}

interface TrackImportState {
  chordCount: number;
  id: string;
  keyConfidence: Track["confidence"]["key"];
}

const expectedReportFiles = [
  "summary.md",
  "transcription.json",
  "chord_segments.csv",
  "bar_grid.csv",
  "android_meta_data.json",
] as const;

const importSourceKind = "chordai-chords-only";

export async function importChordAiChordsOnly(
  options: ChordAiChordsOnlyOptions,
): Promise<ChordAiChordsOnlyResult> {
  const database = await openDatabase(options.databasePath);

  try {
    await runMigrations(database);

    return await importChordAiChordsOnlyIntoDatabase(database, options);
  } finally {
    database.close();
  }
}

export async function importChordAiChordsOnlyIntoDatabase(
  database: DatabaseSync,
  options: ChordAiChordsOnlyOptions,
): Promise<ChordAiChordsOnlyResult> {
  const manifestPath = resolve(options.manifestPath);
  const statePath = resolve(options.statePath);
  const manifest = await readManifest(manifestPath);
  const state = await readState(statePath);
  const stateByPhonePath = new Map(state.map((row) => [row.trackPath, row]));
  const importRunId = `imp-${randomUUID()}`;
  const skipped: ChordAiChordsOnlySkipped[] = [];
  const errors: ChordAiChordsOnlyError[] = [];
  let importedCount = 0;
  let reportCount = 0;

  insertImportRun(database, importRunId, `${manifestPath}\n${statePath}`);

  for (const row of manifest) {
    const stateRow = stateByPhonePath.get(row.phonePath);

    if (!stateRow) {
      skipped.push({
        reason: "Missing batch state row",
        reportPath: null,
        trackId: row.trackId,
      });
      continue;
    }

    if (stateRow.status !== "extracted") {
      skipped.push({
        reason: `Batch state is ${stateRow.status || "empty"}, not extracted`,
        reportPath: stateRow.localReportDir || null,
        trackId: row.trackId,
      });
      continue;
    }

    const reportPath = stateRow.localReportDir;

    if (!reportPath) {
      skipped.push({
        reason: "Missing local_report_dir in batch state",
        reportPath: null,
        trackId: row.trackId,
      });
      continue;
    }

    const track = readTrackImportState(database, row.trackId);

    if (!track) {
      errors.push({
        error: "Track is not present in the planner database",
        reportPath,
        trackId: row.trackId,
      });
      continue;
    }

    const shouldImportChords = track.chordCount === 0;
    const shouldUpdateKey = shouldUpdateTrackKeyFromReport(track);

    if (!shouldImportChords && !shouldUpdateKey) {
      skipped.push({
        reason: `Track already has ${track.chordCount} compact chord rows and a confirmed key`,
        reportPath,
        trackId: row.trackId,
      });
      continue;
    }

    const missingFiles = await findMissingFiles(reportPath);

    if (missingFiles.length > 0) {
      skipped.push({
        reason: `Missing files: ${missingFiles.join(", ")}`,
        reportPath,
        trackId: row.trackId,
      });
      continue;
    }

    reportCount += 1;

    try {
      const report = await readReport(reportPath);

      if (
        importReportForTrack(database, importRunId, row.trackId, report, {
          shouldImportChords,
          shouldUpdateKey,
        })
      ) {
        importedCount += 1;
      } else {
        skipped.push({
          reason: "Report has no compact chord progression",
          reportPath,
          trackId: row.trackId,
        });
      }
    } catch (error) {
      errors.push({
        error: error instanceof Error ? error.message : String(error),
        reportPath,
        trackId: row.trackId,
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

async function readManifest(manifestPath: string): Promise<ManifestRow[]> {
  return parseCsv(await readFile(manifestPath, "utf8")).map((row, index) => ({
    localAudioPath: requiredString(row.local_audio_path, "local_audio_path", index),
    phonePath: requiredString(row.phone_path, "phone_path", index),
    playlistPosition: requiredInteger(row.playlist_position, "playlist_position", index),
    title: requiredString(row.title, "title", index),
    trackId: requiredString(row.track_id, "track_id", index),
  }));
}

async function readState(statePath: string): Promise<StateRow[]> {
  return parseCsv(await readFile(statePath, "utf8")).map((row, index) => ({
    localReportDir: row.local_report_dir?.trim() ?? "",
    status: row.status?.trim() ?? "",
    trackPath: requiredString(row.track_path, "track_path", index),
  }));
}

async function readReport(reportPath: string): Promise<ChordAiReport> {
  return parseChordAiReport({
    androidMetaData: await readFile(resolve(reportPath, "android_meta_data.json"), "utf8"),
    barGridCsv: await readFile(resolve(reportPath, "bar_grid.csv"), "utf8"),
    chordSegmentsCsv: await readFile(resolve(reportPath, "chord_segments.csv"), "utf8"),
    reportPath,
    summaryMarkdown: await readFile(resolve(reportPath, "summary.md"), "utf8"),
    transcriptionJson: await readFile(resolve(reportPath, "transcription.json"), "utf8"),
  });
}

async function findMissingFiles(reportPath: string): Promise<string[]> {
  const missing: string[] = [];

  for (const fileName of expectedReportFiles) {
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
    .run(importRunId, importSourceKind, sourceRoot);
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

function readTrackImportState(database: DatabaseSync, trackId: string): TrackImportState | null {
  const row = database
    .prepare(
      `
        SELECT
          t.id,
          t.key_confidence AS keyConfidence,
          COUNT(c.symbol) AS chordCount
        FROM tracks t
        LEFT JOIN track_chords c ON c.track_id = t.id
        WHERE t.id = ?
        GROUP BY t.id
      `,
    )
    .get(trackId) as unknown as TrackImportState | undefined;

  return row ?? null;
}

function importReportForTrack(
  database: DatabaseSync,
  importRunId: string,
  trackId: string,
  report: ChordAiReport,
  flags: {
    shouldImportChords: boolean;
    shouldUpdateKey: boolean;
  },
): boolean {
  const compactProgression = compactChordProgression(report.chordSegments);
  const shouldReplaceChords = flags.shouldImportChords && compactProgression.length > 0;

  if (!shouldReplaceChords && !flags.shouldUpdateKey) {
    return false;
  }

  database.exec("BEGIN IMMEDIATE");

  try {
    if (shouldReplaceChords) {
      replaceCompactChords(database, trackId, compactProgression);
    }

    replaceRawReport(database, importRunId, trackId, report);

    if (shouldReplaceChords) {
      markTrackChordsImported(database, trackId);
    }

    if (flags.shouldUpdateKey) {
      applyReportKeyToTrack(database, trackId, report.key);
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return true;
}

function markTrackChordsImported(database: DatabaseSync, trackId: string): void {
  database
    .prepare(
      `
        UPDATE tracks
        SET
          chords_confidence = 'estimated',
          updated_at = datetime('now')
        WHERE id = ?
      `,
    )
    .run(trackId);
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
  const reportId = createReportId(trackId, report);

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

function createReportId(trackId: string, report: ChordAiReport): string {
  const hash = createHash("sha256")
    .update(`${trackId}|${report.sourceIdentity}|${basename(report.reportPath)}`)
    .digest("hex");

  return `rep-ch-${hash.slice(0, 16)}`;
}

function requiredString(value: string | undefined, field: string, index: number): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`Missing ${field} in CSV row ${index + 2}`);
  }

  return trimmed;
}

function requiredInteger(value: string | undefined, field: string, index: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${field} in CSV row ${index + 2}: ${value ?? ""}`);
  }

  return parsed;
}
