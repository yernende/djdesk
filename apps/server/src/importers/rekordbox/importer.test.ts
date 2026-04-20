import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runMigrations } from "../../db/migrations.ts";
import { importRekordboxPlaylistIntoDatabase } from "./importer.ts";

test("imports Rekordbox playlist rows and stays idempotent", async () => {
  const fixture = await createImportFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);

    const first = await importRekordboxPlaylistIntoDatabase(database, {
      databasePath: fixture.databasePath,
      fromPosition: 1,
      playlistPath: fixture.playlistPath,
      toPosition: 4,
    });

    assert.equal(first.rowCount, 4);
    assert.equal(first.importedCount, 4);
    assert.equal(first.skipped.length, 0);
    assert.equal(first.errors.length, 0);
    assert.equal(countRows(database, "tracks"), 4);
    assert.equal(countRows(database, "rekordbox_playlist_entries"), 4);

    const importedTrack = database
      .prepare(
        `
          SELECT
            title,
            artist,
            bpm,
            tonic,
            mode,
            raw_key,
            harmony_notes,
            key_confidence,
            bpm_confidence,
            source_kind
          FROM tracks
          WHERE title = 'Fixture Song'
        `,
      )
      .get() as {
      artist: string;
      bpm: number;
      bpm_confidence: string;
      harmony_notes: string;
      key_confidence: string;
      mode: string;
      raw_key: string;
      source_kind: string;
      tonic: string;
    };

    assert.equal(importedTrack.artist, "Fixture Artist");
    assert.equal(importedTrack.bpm, 94);
    assert.equal(importedTrack.tonic, "G#");
    assert.equal(importedTrack.mode, "natural-minor");
    assert.equal(importedTrack.raw_key, "Abm");
    assert.equal(importedTrack.harmony_notes, "Harm");
    assert.equal(importedTrack.key_confidence, "estimated");
    assert.equal(importedTrack.bpm_confidence, "estimated");
    assert.equal(importedTrack.source_kind, "rekordbox");

    const second = await importRekordboxPlaylistIntoDatabase(database, {
      databasePath: fixture.databasePath,
      fromPosition: 1,
      playlistPath: fixture.playlistPath,
      toPosition: 4,
    });

    assert.equal(second.importedCount, 4);
    assert.equal(second.skipped.length, 0);
    assert.equal(countRows(database, "tracks"), 4);
    assert.equal(countRows(database, "rekordbox_playlist_entries"), 4);

    const unknownKeyTrack = database
      .prepare("SELECT key_unknown, raw_key FROM tracks WHERE title = 'Missing Key Song'")
      .get() as {
      key_unknown: number;
      raw_key: string | null;
    };

    assert.equal(unknownKeyTrack.key_unknown, 1);
    assert.equal(unknownKeyTrack.raw_key, null);
  } finally {
    database.close();
    await rm(fixture.rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("reimport preserves separately confirmed Rekordbox key and BPM", async () => {
  const fixture = await createImportFixture();
  const database = new DatabaseSync(fixture.databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await runMigrations(database);

    await importRekordboxPlaylistIntoDatabase(database, {
      databasePath: fixture.databasePath,
      fromPosition: 1,
      playlistPath: fixture.playlistPath,
      toPosition: 1,
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
            bpm_confidence = 'confirmed'
          WHERE id = ?
        `,
      )
      .run(track.id);

    await writePlaylist(fixture.playlistPath, [
      "#\tArtwork\tTrack Title\tArtist\tBPM\tKey\tComments",
      "1\t\tFixture Song\tFixture Artist\t130.00\tDbm\tUpdated note",
    ]);

    await importRekordboxPlaylistIntoDatabase(database, {
      databasePath: fixture.databasePath,
      fromPosition: 1,
      playlistPath: fixture.playlistPath,
      toPosition: 1,
    });

    const updated = database.prepare("SELECT * FROM tracks WHERE id = ?").get(track.id) as {
      bpm: number;
      harmony_notes: string;
      raw_key: string;
      tonic: string;
    };
    const rawEntry = database
      .prepare(
        "SELECT bpm, parsed_key, comments FROM rekordbox_playlist_entries WHERE track_id = ?",
      )
      .get(track.id) as {
      bpm: number;
      comments: string;
      parsed_key: string;
    };

    assert.equal(updated.bpm, 77);
    assert.equal(updated.tonic, "F");
    assert.equal(updated.raw_key, "Dbm");
    assert.equal(updated.harmony_notes, "Updated note");
    assert.equal(rawEntry.bpm, 130);
    assert.equal(rawEntry.parsed_key, "Dbm");
    assert.equal(rawEntry.comments, "Updated note");
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
  playlistPath: string;
  rootPath: string;
}> {
  const rootPath = await mkdtemp(join(tmpdir(), "djdesk-rekordbox-"));
  const playlistPath = join(rootPath, "playlist.txt");

  await writePlaylist(playlistPath, [
    "#\tArtwork\tTrack Title\tArtist\tBPM\tKey\tComments",
    "1\t\tFixture Song\tFixture Artist\t94.00\tAbm\tHarm",
    "2\t\tComment Key Song\tArtist B\t75.00\t\tBbm, no ne stroit",
    "3\t\tCyrillic Key Song\tArtist C\t86.00\tС\t",
    "4\t\tMissing Key Song\tArtist D\t80.00\t\t",
  ]);

  return {
    databasePath: join(rootPath, "test.sqlite"),
    playlistPath,
    rootPath,
  };
}

async function writePlaylist(playlistPath: string, lines: readonly string[]): Promise<void> {
  await writeFile(playlistPath, `\uFEFF${lines.join("\n")}`, "utf16le");
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };

  return row.count;
}
