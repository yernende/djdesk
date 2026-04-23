import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runMigrations } from "../../db/migrations.ts";
import { backfillChordAiKeysFromReportsIntoDatabase } from "./backfill-keys.ts";

test("backfills unknown track keys from stored ChordAI reports without touching BPM", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "djdesk-chordai-key-backfill-"));
  const databasePath = join(rootPath, "test.sqlite");
  const database = new DatabaseSync(databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    insertTrack(database, {
      artist: "Fixture Artist",
      bpm: null,
      bpmConfidence: "estimated",
      id: "trk-spotify-fixture",
      keyConfidence: "estimated",
      keyUnknown: 1,
      mode: "major",
      rawKey: "unknown",
      sourceIdentity: "spotify-fixture",
      sourceKind: "spotify",
      title: "Fixture Song",
      tonic: "C",
    });
    insertTrack(database, {
      artist: "Confirmed Artist",
      bpm: 96,
      bpmConfidence: "confirmed",
      id: "trk-yandex-confirmed",
      keyConfidence: "confirmed",
      keyUnknown: 0,
      mode: "major",
      rawKey: "F",
      sourceIdentity: "yandex-confirmed",
      sourceKind: "yandex-playlist",
      title: "Confirmed Song",
      tonic: "F",
    });
    insertTrack(database, {
      artist: "Missing Report Artist",
      bpm: null,
      bpmConfidence: "estimated",
      id: "trk-spotify-missing",
      keyConfidence: "estimated",
      keyUnknown: 1,
      mode: "major",
      rawKey: "unknown",
      sourceIdentity: "spotify-missing",
      sourceKind: "spotify",
      title: "Missing Report Song",
      tonic: "C",
    });
    insertImportRun(database, "imp-fixture");
    insertChordAiReport(database, {
      importRunId: "imp-fixture",
      rawKey: "Ab",
      reportId: "rep-fixture",
      trackId: "trk-spotify-fixture",
    });
    insertChordAiReport(database, {
      importRunId: "imp-fixture",
      rawKey: "Db",
      reportId: "rep-confirmed",
      trackId: "trk-yandex-confirmed",
    });

    const result = await backfillChordAiKeysFromReportsIntoDatabase(database, {
      databasePath,
      sourceKinds: ["spotify", "yandex-playlist"],
    });

    const updated = database
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get("trk-spotify-fixture") as {
      bpm: number | null;
      key_confidence: string;
      key_unknown: number;
      mode: string;
      raw_key: string;
      tonic: string;
    };
    const confirmed = database
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get("trk-yandex-confirmed") as {
      key_confidence: string;
      mode: string;
      raw_key: string;
      tonic: string;
    };
    const stillMissing = database
      .prepare("SELECT * FROM tracks WHERE id = ?")
      .get("trk-spotify-missing") as {
      key_unknown: number;
      raw_key: string;
    };

    assert.equal(result.scannedCount, 3);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.skippedConfirmedCount, 1);
    assert.equal(result.skippedMissingReportCount, 1);
    assert.equal(result.errors.length, 0);

    assert.equal(updated.bpm, null);
    assert.equal(updated.tonic, "G#");
    assert.equal(updated.mode, "major");
    assert.equal(updated.raw_key, "Ab");
    assert.equal(updated.key_unknown, 0);
    assert.equal(updated.key_confidence, "estimated");

    assert.equal(confirmed.tonic, "F");
    assert.equal(confirmed.mode, "major");
    assert.equal(confirmed.raw_key, "F");
    assert.equal(confirmed.key_confidence, "confirmed");

    assert.equal(stillMissing.key_unknown, 1);
    assert.equal(stillMissing.raw_key, "unknown");
  } finally {
    database.close();
    await rm(rootPath, {
      force: true,
      recursive: true,
    });
  }
});

function insertTrack(
  database: DatabaseSync,
  input: {
    artist: string;
    bpm: number | null;
    bpmConfidence: string;
    id: string;
    keyConfidence: string;
    keyUnknown: 0 | 1;
    mode: string;
    rawKey: string;
    sourceIdentity: string;
    sourceKind: string;
    title: string;
    tonic: string;
  },
): void {
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
          raw_key,
          source_kind,
          source_identity,
          key_unknown
        ) VALUES (?, ?, ?, ?, ?, ?, 'diatonic', ?, ?, 'estimated', ?, ?, ?, ?)
      `,
    )
    .run(
      input.id,
      input.title,
      input.artist,
      input.bpm,
      input.tonic,
      input.mode,
      input.keyConfidence,
      input.bpmConfidence,
      input.rawKey,
      input.sourceKind,
      input.sourceIdentity,
      input.keyUnknown,
    );
}

function insertImportRun(database: DatabaseSync, importRunId: string): void {
  database
    .prepare(
      `
        INSERT INTO import_runs (id, source_kind, source_root)
        VALUES (?, 'chordai-chords-only', 'fixture')
      `,
    )
    .run(importRunId);
}

function insertChordAiReport(
  database: DatabaseSync,
  input: {
    importRunId: string;
    rawKey: string;
    reportId: string;
    trackId: string;
  },
): void {
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
          raw_key
        ) VALUES (?, ?, ?, '/tmp/report', 'report', 'Fixture Song', ?)
      `,
    )
    .run(input.reportId, input.importRunId, input.trackId, input.rawKey);
}
