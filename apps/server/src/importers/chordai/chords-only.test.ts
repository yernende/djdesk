import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runMigrations } from "../../db/migrations.ts";
import { importChordAiChordsOnlyIntoDatabase } from "./chords-only.ts";

test("imports only chords and report detail without changing track key or BPM", async () => {
  const fixture = await createChordsOnlyFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    insertPlannerTrack(database);

    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: fixture.databasePath,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    });

    assert.equal(result.reportCount, 1);
    assert.equal(result.importedCount, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.errors.length, 0);

    const track = database.prepare("SELECT * FROM tracks WHERE id = ?").get("trk-rbx-fixture") as {
      bpm: number;
      mode: string;
      raw_key: string;
      source_kind: string;
      tonic: string;
    };
    const chords = database
      .prepare("SELECT symbol FROM track_chords WHERE track_id = ? ORDER BY position")
      .all("trk-rbx-fixture") as { symbol: string }[];
    const report = database
      .prepare("SELECT * FROM chordai_reports WHERE track_id = ?")
      .get("trk-rbx-fixture") as {
      bpm: number;
      raw_key: string;
    };

    assert.equal(track.bpm, 77);
    assert.equal(track.tonic, "F");
    assert.equal(track.mode, "major");
    assert.equal(track.raw_key, "F");
    assert.equal(track.source_kind, "rekordbox");
    assert.deepEqual(
      chords.map((chord) => chord.symbol),
      ["Ebm", "Ab/G#"],
    );
    assert.equal(report.bpm, 130);
    assert.equal(report.raw_key, "Ab");
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("skips tracks that already have compact chords", async () => {
  const fixture = await createChordsOnlyFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    insertPlannerTrack(database);
    database
      .prepare("INSERT INTO track_chords (track_id, position, symbol) VALUES (?, 0, 'Manual')")
      .run("trk-rbx-fixture");

    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: fixture.databasePath,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    });

    const chord = database
      .prepare("SELECT symbol FROM track_chords WHERE track_id = ?")
      .get("trk-rbx-fixture") as { symbol: string };

    assert.equal(result.importedCount, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(
      result.skipped[0]?.reason,
      "Track already has 1 compact chord rows, confirmed BPM, and a confirmed key",
    );
    assert.equal(chord.symbol, "Manual");
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("imports key and BPM from report for tracks with unconfirmed analysis", async () => {
  const fixture = await createChordsOnlyFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    insertPlannerTrack(database, {
      bpm: null,
      bpmConfidence: "estimated",
      keyConfidence: "estimated",
      keyUnknown: 1,
      mode: "major",
      rawKey: "unknown",
      sourceKind: "spotify",
      sourceIdentity: "spotify-fixture",
      tonic: "C",
    });

    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: fixture.databasePath,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    });

    const track = database.prepare("SELECT * FROM tracks WHERE id = ?").get("trk-rbx-fixture") as {
      bpm: number | null;
      bpm_confidence: string;
      key_confidence: string;
      key_unknown: number;
      mode: string;
      raw_key: string;
      tonic: string;
    };
    const chords = database
      .prepare("SELECT symbol FROM track_chords WHERE track_id = ? ORDER BY position")
      .all("trk-rbx-fixture") as { symbol: string }[];

    assert.equal(result.importedCount, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(track.bpm, 130);
    assert.equal(track.bpm_confidence, "estimated");
    assert.equal(track.tonic, "G#");
    assert.equal(track.mode, "major");
    assert.equal(track.raw_key, "Ab");
    assert.equal(track.key_unknown, 0);
    assert.equal(track.key_confidence, "estimated");
    assert.deepEqual(
      chords.map((chord) => chord.symbol),
      ["Ebm", "Ab/G#"],
    );
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("updates unknown key from report even when compact chords already exist", async () => {
  const fixture = await createChordsOnlyFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    insertPlannerTrack(database, {
      bpm: null,
      bpmConfidence: "estimated",
      keyConfidence: "estimated",
      keyUnknown: 1,
      mode: "major",
      rawKey: "unknown",
      sourceKind: "spotify",
      sourceIdentity: "spotify-fixture",
      tonic: "C",
    });
    database
      .prepare("INSERT INTO track_chords (track_id, position, symbol) VALUES (?, 0, 'Manual')")
      .run("trk-rbx-fixture");

    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: fixture.databasePath,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    });

    const track = database.prepare("SELECT * FROM tracks WHERE id = ?").get("trk-rbx-fixture") as {
      bpm: number | null;
      key_unknown: number;
      raw_key: string;
      tonic: string;
    };
    const chord = database
      .prepare("SELECT symbol FROM track_chords WHERE track_id = ? ORDER BY position LIMIT 1")
      .get("trk-rbx-fixture") as { symbol: string };

    assert.equal(result.importedCount, 1);
    assert.equal(track.bpm, 130);
    assert.equal(track.key_unknown, 0);
    assert.equal(track.tonic, "G#");
    assert.equal(track.raw_key, "Ab");
    assert.equal(chord.symbol, "Manual");
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("skips reports with no compact chords without failing the import", async () => {
  const fixture = await createChordsOnlyFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    insertPlannerTrack(database);
    await writeNoChordReport(fixture.reportPath);

    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: fixture.databasePath,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    });

    const chords = database
      .prepare("SELECT symbol FROM track_chords WHERE track_id = ?")
      .all("trk-rbx-fixture");

    assert.equal(result.reportCount, 1);
    assert.equal(result.importedCount, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "Report has no compact chord progression");
    assert.deepEqual(chords, []);
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("imports BPM and key even when report has no compact chords", async () => {
  const fixture = await createChordsOnlyFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);
    insertPlannerTrack(database, {
      bpm: null,
      bpmConfidence: "estimated",
      keyConfidence: "estimated",
      keyUnknown: 1,
      mode: "major",
      rawKey: "unknown",
      sourceKind: "spotify",
      sourceIdentity: "spotify-fixture",
      tonic: "C",
    });
    await writeNoChordReport(fixture.reportPath);

    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: fixture.databasePath,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    });

    const track = database.prepare("SELECT * FROM tracks WHERE id = ?").get("trk-rbx-fixture") as {
      bpm: number | null;
      bpm_confidence: string;
      key_confidence: string;
      key_unknown: number;
      raw_key: string;
      tonic: string;
    };
    const chords = database
      .prepare("SELECT symbol FROM track_chords WHERE track_id = ?")
      .all("trk-rbx-fixture");

    assert.equal(result.reportCount, 1);
    assert.equal(result.importedCount, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.skipped.length, 0);
    assert.equal(track.bpm, 130);
    assert.equal(track.bpm_confidence, "estimated");
    assert.equal(track.tonic, "G#");
    assert.equal(track.key_unknown, 0);
    assert.equal(track.key_confidence, "estimated");
    assert.equal(track.raw_key, "Ab");
    assert.deepEqual(chords, []);
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

async function createChordsOnlyFixture(): Promise<{
  databasePath: string;
  manifestPath: string;
  reportPath: string;
  rootPath: string;
  statePath: string;
}> {
  const rootPath = await mkdtemp(join(tmpdir(), "djdesk-chordai-chords-only-"));
  const reportPath = join(rootPath, "reports", "Fixture_Song_2026-04-20T00-00-00");
  const manifestPath = join(rootPath, "manifest.csv");
  const statePath = join(rootPath, "batch_state.csv");
  const phonePath = "/sdcard/Music/djdesk/001 - Fixture Song.flac";

  await writeFixtureReport(reportPath);
  await writeFile(
    manifestPath,
    [
      "playlist_position,track_id,title,artist,local_audio_path,phone_path",
      `1,trk-rbx-fixture,Fixture Song,Fixture Artist,/music/fixture.flac,${phonePath}`,
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    statePath,
    [
      "track_path,status,attempts,started_at,finished_at,exported_phone_path,local_report_dir,error,next_action",
      `${phonePath},extracted,1,,,,${reportPath},,done`,
    ].join("\n"),
    "utf8",
  );

  return {
    databasePath: join(rootPath, "test.sqlite"),
    manifestPath,
    reportPath,
    rootPath,
    statePath,
  };
}

function insertPlannerTrack(
  database: DatabaseSync,
  overrides: {
    bpm?: number | null;
    bpmConfidence?: string;
    keyConfidence?: string;
    keyUnknown?: 0 | 1;
    mode?: string;
    rawKey?: string;
    sourceIdentity?: string;
    sourceKind?: string;
    tonic?: string;
  } = {},
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "trk-rbx-fixture",
      "Fixture Song",
      "Fixture Artist",
      overrides.bpm === undefined ? 77 : overrides.bpm,
      overrides.tonic ?? "F",
      overrides.mode ?? "major",
      "diatonic",
      overrides.keyConfidence ?? "confirmed",
      overrides.bpmConfidence ?? "confirmed",
      "estimated",
      overrides.rawKey ?? "F",
      overrides.sourceKind ?? "rekordbox",
      overrides.sourceIdentity ?? "rekordbox-fixture",
      overrides.keyUnknown ?? 0,
    );
}

async function writeFixtureReport(reportPath: string): Promise<void> {
  await mkdir(reportPath, {
    recursive: true,
  });
  await writeFile(
    join(reportPath, "summary.md"),
    [
      "# Fixture Song",
      "",
      "- Source export: `fixture.chordai`",
      "- Duration: 0:10.00",
      "- BPM: 130",
      "- Meter: 4/4",
      "- Key: Ab",
      "- Bars: 2",
      "- Chord segments: 2",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(reportPath, "android_meta_data.json"),
    JSON.stringify({
      audio_file_name: "Fixture Song.flac",
      creation_date: "2026-04-20T00:00:00.000",
      duration: 10,
      last_edit_date: "2026-04-20T00:01:00.000",
      title: "Fixture Song",
    }),
    "utf8",
  );
  await writeFile(
    join(reportPath, "transcription.json"),
    JSON.stringify({
      global_bpm_avg: 130,
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
      "1,0,5,130,Ebm Ebm,Ebm Ebm,Ebm,Ebm,,",
      "2,5,5,130,Ab Ab,Ab/G# Ab/G#,Ab,Ab,,",
    ].join("\n"),
    "utf8",
  );
}

async function writeNoChordReport(reportPath: string): Promise<void> {
  await writeFile(
    join(reportPath, "chord_segments.csv"),
    [
      "index,start_s,end_s,duration_s,chord,bass,label,basic_label,degree,midi_notes",
      "1,0,5,5,N,N,N,N,,",
      "2,5,10,5,N,N,N,N,,",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(reportPath, "bar_grid.csv"),
    [
      "bar,start_s,duration_s,bpm,basic_progression,slash_bass_progression,beat_1,beat_2,beat_3,beat_4",
      "1,0,5,130,N N,N N,N,N,,",
      "2,5,5,130,N N,N N,N,N,,",
    ].join("\n"),
    "utf8",
  );
}
