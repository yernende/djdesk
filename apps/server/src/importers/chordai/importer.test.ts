import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runMigrations } from "../../db/migrations.ts";
import { seedTracksIfEmpty } from "../../repositories/tracks.ts";
import { importChordAiReportsIntoDatabase } from "./importer.ts";

test("imports ChordAI report, removes samples, and stays idempotent", async () => {
  const fixture = await createImportFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    seedTracksIfEmpty(database);

    const first = await importChordAiReportsIntoDatabase(database, {
      databasePath: fixture.databasePath,
      removeSamples: true,
      reportsPath: fixture.reportsPath,
    });

    assert.equal(first.reportCount, 1);
    assert.equal(first.importedCount, 1);
    assert.equal(first.errors.length, 0);
    assert.equal(countRows(database, "tracks"), 1);
    assert.equal(countRows(database, "chordai_reports"), 1);
    assert.equal(countRows(database, "chordai_chord_segments"), 2);
    assert.equal(countRows(database, "chordai_bars"), 2);

    const importedTrack = database.prepare("SELECT * FROM tracks").get() as {
      app_version?: string;
      bpm: number;
      bpm_confidence: string;
      key_confidence: string;
      raw_key: string;
      source_kind: string;
      tonic: string;
    };

    assert.equal(importedTrack.raw_key, "Ebm");
    assert.equal(importedTrack.tonic, "D#");
    assert.equal(importedTrack.key_confidence, "estimated");
    assert.equal(importedTrack.bpm_confidence, "estimated");
    assert.equal(importedTrack.source_kind, "chordai");
    assert.equal(Object.hasOwn(importedTrack, "app_version"), false);

    const second = await importChordAiReportsIntoDatabase(database, {
      databasePath: fixture.databasePath,
      removeSamples: false,
      reportsPath: fixture.reportsPath,
    });

    assert.equal(second.importedCount, 1);
    assert.equal(countRows(database, "tracks"), 1);
    assert.equal(countRows(database, "chordai_reports"), 1);
    assert.equal(countRows(database, "chordai_chord_segments"), 2);
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("reimport preserves confirmed key, BPM, and compact chords", async () => {
  const fixture = await createImportFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);

    await importChordAiReportsIntoDatabase(database, {
      databasePath: fixture.databasePath,
      removeSamples: false,
      reportsPath: fixture.reportsPath,
    });

    const track = database.prepare("SELECT id FROM tracks").get() as { id: string };

    database
      .prepare(
        `
          UPDATE tracks
          SET
            bpm = 77,
            tonic = 'F',
            mode = 'major',
            key_confidence = 'confirmed',
            bpm_confidence = 'confirmed',
            chords_confidence = 'confirmed'
          WHERE id = ?
        `,
      )
      .run(track.id);
    database.prepare("DELETE FROM track_chords WHERE track_id = ?").run(track.id);
    database
      .prepare("INSERT INTO track_chords (track_id, position, symbol) VALUES (?, 0, 'Manual')")
      .run(track.id);

    await writeFixtureReport(fixture.reportPath, {
      bpm: 130,
      key: "Ab",
      title: "Fixture Song",
    });

    await importChordAiReportsIntoDatabase(database, {
      databasePath: fixture.databasePath,
      removeSamples: false,
      reportsPath: fixture.reportsPath,
    });

    const updated = database.prepare("SELECT * FROM tracks WHERE id = ?").get(track.id) as {
      bpm: number;
      raw_key: string;
      tonic: string;
    };
    const chord = database
      .prepare("SELECT symbol FROM track_chords WHERE track_id = ?")
      .get(track.id) as { symbol: string };

    assert.equal(updated.bpm, 77);
    assert.equal(updated.tonic, "F");
    assert.equal(updated.raw_key, "Ab");
    assert.equal(chord.symbol, "Manual");
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

async function createImportFixture(): Promise<{
  databasePath: string;
  reportPath: string;
  reportsPath: string;
  rootPath: string;
}> {
  const rootPath = await mkdtemp(join(tmpdir(), "djdesk-chordai-"));
  const reportsPath = join(rootPath, "reports");
  const reportPath = join(reportsPath, "Fixture_Song_2026-04-20T00-00-00");

  await writeFixtureReport(reportPath, {
    bpm: 101,
    key: "Ebm",
    title: "Fixture Song",
  });

  return {
    databasePath: join(rootPath, "test.sqlite"),
    reportPath,
    reportsPath,
    rootPath,
  };
}

async function writeFixtureReport(
  reportPath: string,
  input: {
    bpm: number;
    key: string;
    title: string;
  },
): Promise<void> {
  await mkdir(reportPath, {
    recursive: true,
  });
  await writeFile(
    join(reportPath, "summary.md"),
    [
      `# ${input.title}`,
      "",
      "- Source export: `fixture.chordai`",
      "- Duration: 0:10.00",
      `- BPM: ${input.bpm}`,
      "- Meter: 4/4",
      `- Key: ${input.key}`,
      "- Bars: 2",
      "- Chord segments: 2",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(reportPath, "android_meta_data.json"),
    JSON.stringify({
      app_version: "2.7.73",
      audio_file_name: input.title,
      creation_date: "2026-04-20T00:00:00.000",
      device_model: "Google Pixel 7",
      duration: 10,
      last_edit_date: "2026-04-20T00:01:00.000",
      title: input.title,
      uri_string: "file:///sdcard/Music/fixture.mp3",
    }),
    "utf8",
  );
  await writeFile(
    join(reportPath, "transcription.json"),
    JSON.stringify({
      global_bpm_avg: input.bpm,
      global_bpm_std: 0.25,
      global_metric_string: "4/4",
    }),
    "utf8",
  );
  await writeFile(
    join(reportPath, "chord_segments.csv"),
    [
      "index,start_s,end_s,duration_s,chord,bass,label,basic_label,degree,midi_notes",
      "1,0,5,5,Ebm,D#,Ebm,Ebm,,63 66 70",
      "2,5,10,5,Ab,G#,Ab/G#,Ab,,68 72 75",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(reportPath, "bar_grid.csv"),
    [
      "bar,start_s,duration_s,bpm,basic_progression,slash_bass_progression,beat_1,beat_2,beat_3,beat_4",
      `1,0,5,${input.bpm},Ebm Ebm,Ebm Ebm,Ebm,Ebm,,`,
      `2,5,5,${input.bpm},Ab Ab,Ab/G# Ab/G#,Ab,Ab,,`,
    ].join("\n"),
    "utf8",
  );
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };

  return row.count;
}
