import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runMigrations } from "./migrations.ts";

test("production editing migration removes only debug fixtures and makes BPM nullable", async () => {
  const fixture = await createMigrationFixture();
  const database = new DatabaseSync(":memory:");

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database, pathToFileURL(`${fixture.preProductionMigrationsPath}/`));

    insertTrack(database, {
      bpmConfidence: "estimated",
      id: "demo-fake-a-dorian-mixture",
      keyConfidence: "estimated",
      sourceKind: "debug-fixture",
      title: "Debug fixture",
    });
    insertTrack(database, {
      audioPath: "/music/real.flac",
      bpmConfidence: "confirmed",
      id: "trk-real",
      keyConfidence: "confirmed",
      sourceKind: "rekordbox",
      title: "Real track",
    });
    insertTrack(database, {
      bpmConfidence: "confirmed",
      id: "trk-manual",
      keyConfidence: "confirmed",
      sourceKind: "manual",
      title: "Manual track",
    });
    insertTrack(database, {
      bpmConfidence: "rejected",
      id: "trk-old-rejected",
      keyConfidence: "rejected",
      sourceKind: "manual",
      title: "Old rejected track",
    });
    database
      .prepare("INSERT INTO set_drafts (id, name) VALUES ('set-fixture', 'Fixture set')")
      .run();
    database
      .prepare(
        `
          INSERT INTO set_draft_tracks (set_draft_id, position, track_id)
          VALUES
            ('set-fixture', 0, 'demo-fake-a-dorian-mixture'),
            ('set-fixture', 1, 'trk-real')
        `,
      )
      .run();

    await runMigrations(database);

    assert.equal(countRows(database, "tracks", "source_kind = 'debug-fixture'"), 0);
    assert.equal(countRows(database, "tracks", "id = 'trk-real'"), 1);
    assert.equal(countRows(database, "tracks", "id = 'trk-manual'"), 1);
    assert.equal(countRows(database, "tracks", "id = 'trk-old-rejected'"), 1);
    assert.equal(countRows(database, "set_draft_tracks", "track_id = 'trk-real'"), 1);
    assert.equal(countRows(database, "set_draft_tracks", "track_id LIKE 'demo-fake-%'"), 0);

    const realTrack = database.prepare("SELECT * FROM tracks WHERE id = 'trk-real'").get() as {
      audio_path: string;
      bpm_confidence: string;
      key_confidence: string;
    };

    assert.equal(realTrack.audio_path, "/music/real.flac");
    assert.equal(realTrack.bpm_confidence, "confirmed");
    assert.equal(realTrack.key_confidence, "confirmed");

    const oldRejectedTrack = database
      .prepare(
        "SELECT bpm_confidence, key_confidence, non_standard_tuning FROM tracks WHERE id = 'trk-old-rejected'",
      )
      .get() as {
      bpm_confidence: string;
      key_confidence: string;
      non_standard_tuning: number;
    };

    assert.equal(oldRejectedTrack.bpm_confidence, "estimated");
    assert.equal(oldRejectedTrack.key_confidence, "estimated");
    assert.equal(oldRejectedTrack.non_standard_tuning, 0);

    database.prepare("UPDATE tracks SET bpm = NULL WHERE id = 'trk-manual'").run();

    const manualTrack = database
      .prepare("SELECT bpm FROM tracks WHERE id = 'trk-manual'")
      .get() as {
      bpm: number | null;
    };

    assert.equal(manualTrack.bpm, null);
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

async function createMigrationFixture(): Promise<{
  preProductionMigrationsPath: string;
  rootPath: string;
}> {
  const rootPath = await mkdtemp(join(tmpdir(), "djdesk-migrations-"));
  const preProductionMigrationsPath = join(rootPath, "migrations");

  await mkdir(preProductionMigrationsPath);

  for (let version = 1; version <= 6; version += 1) {
    const prefix = String(version).padStart(4, "0");

    await cp(
      new URL(`../../migrations/${prefix}_${getMigrationName(version)}.sql`, import.meta.url),
      join(preProductionMigrationsPath, `${prefix}_${getMigrationName(version)}.sql`),
    );
  }

  return {
    preProductionMigrationsPath,
    rootPath,
  };
}

function getMigrationName(version: number): string {
  switch (version) {
    case 1:
      return "initial_schema";
    case 2:
      return "chordai_import";
    case 3:
      return "rekordbox_import";
    case 4:
      return "unknown_key";
    case 5:
      return "does_not_fit";
    case 6:
      return "audio_sources";
    default:
      throw new Error(`Unexpected migration version: ${version}`);
  }
}

function insertTrack(
  database: DatabaseSync,
  input: {
    audioPath?: string;
    bpmConfidence: string;
    id: string;
    keyConfidence: string;
    sourceKind: string;
    title: string;
  },
): void {
  database
    .prepare(
      `
        INSERT INTO tracks (
          id,
          title,
          bpm,
          tonic,
          mode,
          modal_variant,
          key_confidence,
          bpm_confidence,
          chords_confidence,
          source_kind,
          source_identity,
          audio_path
        ) VALUES (?, ?, 120, 'A', 'natural-minor', 'diatonic', ?, ?, 'estimated', ?, ?, ?)
      `,
    )
    .run(
      input.id,
      input.title,
      input.keyConfidence,
      input.bpmConfidence,
      input.sourceKind,
      `${input.sourceKind}:${input.id}`,
      input.audioPath ?? null,
    );
}

function countRows(database: DatabaseSync, table: string, where: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as {
    count: number;
  };

  return row.count;
}
