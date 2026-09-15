import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runMigrations } from "../db/migrations.ts";
import { createSqliteTrackRepository } from "../repositories/tracks.ts";
import {
  applyPublication,
  claimLegacySets,
  exportManifest,
  preparePublicData,
  readManifest,
} from "./admin.ts";
import { hashSecret } from "./store.ts";

test("publication is explicit and invalid manifests do not change the current selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "djdesk-publish-"));
  const db = new DatabaseSync(":memory:");
  try {
    await runMigrations(db);
    const track = await createSqliteTrackRepository(db).createTrack({
      title: "Private by default",
    });
    const manifest = exportManifest(db);
    assert.equal(manifest.tracks[0]?.publish, false);
    assert.equal(manifest.tracks[0]?.audio, false);
    manifest.tracks[0]!.publish = true;
    applyPublication(db, manifest);
    assert.throws(
      () =>
        applyPublication(db, {
          version: 1,
          tracks: [{ id: "missing", publish: true, audio: false }],
        }),
      /Unknown track/,
    );
    assert.equal(
      (db.prepare("SELECT track_id FROM public_catalog").get() as { track_id: string }).track_id,
      track.id,
    );
    const path = join(root, "invalid.json");
    await writeFile(
      path,
      JSON.stringify({ version: 1, tracks: [{ id: track.id, publish: false, audio: true }] }),
    );
    await assert.rejects(readManifest(path), /audio requires/);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy sets are adopted privately once and the link is a private file", async () => {
  const root = await mkdtemp(join(tmpdir(), "djdesk-owner-"));
  const db = new DatabaseSync(":memory:");
  try {
    await runMigrations(db);
    const repo = createSqliteTrackRepository(db);
    for (let i = 0; i < 4; i++) await repo.createSetDraft({ name: `Existing ${i}` });
    const output = join(root, "link.txt");
    assert.equal(await claimLegacySets(db, "https://demo.example.test", output), 4);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const link = new URL((await readFile(output, "utf8")).trim());
    const secret = new URLSearchParams(link.hash.slice(1)).get("key")!;
    const workspace = db.prepare("SELECT id, secret_hash FROM workspaces").get() as {
      id: string;
      secret_hash: string;
    };
    assert.equal(workspace.secret_hash, hashSecret(secret));
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS count FROM set_drafts WHERE workspace_id = ?")
          .get(workspace.id) as { count: number }
      ).count,
      4,
    );
    assert.equal(await claimLegacySets(db, "https://demo.example.test", output), 0);
    assert.equal(db.prepare("SELECT * FROM public_catalog").all().length, 0);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

const ffprobeAvailable =
  spawnSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
test(
  "preparation copies verified audio, recomputes quality and never mutates the source",
  { skip: !ffprobeAvailable && "FFprobe is required for the real audio preparation test" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "djdesk-prepare-"));
    const sourcePath = join(root, "source.sqlite");
    const source = new DatabaseSync(sourcePath);
    try {
      source.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
      await runMigrations(source);
      const repo = createSqliteTrackRepository(source);
      const track = await repo.createTrack({ title: "Preparation fixture" });
      const audioPath = join(root, "source.wav");
      await writeFile(audioPath, pcmFixture());
      await repo.updateTrackAudioPath(track.id, audioPath);
      const legacy = await repo.createSetDraft({ name: "Private" });
      await repo.replaceSetDraftTracks(legacy.id, [track.id, track.id]);
      const output = join(root, "prepared");
      const result = await preparePublicData(
        sourcePath,
        output,
        { version: 1, tracks: [{ id: track.id, publish: true, audio: true }] },
        "https://demo.example.test",
        "/var/lib/djdesk/audio",
      );
      assert.deepEqual(result, { tracks: 1, audio: 1, legacySets: 1 });
      const prepared = new DatabaseSync(join(output, "data/djdesk.sqlite"), { readOnly: true });
      try {
        const copied = prepared
          .prepare(
            "SELECT audio_path, audio_quality_status, audio_quality_analyzed_at FROM tracks WHERE id = ?",
          )
          .get(track.id) as {
          audio_path: string;
          audio_quality_status: string;
          audio_quality_analyzed_at: string;
        };
        assert.match(copied.audio_path, /^\/var\/lib\/djdesk\/audio\/[a-f0-9]{64}\.wav$/);
        assert.equal(copied.audio_quality_status, "hq");
        assert.ok(copied.audio_quality_analyzed_at);
        assert.equal(
          (
            prepared.prepare("SELECT count(*) AS count FROM set_draft_tracks").get() as {
              count: number;
            }
          ).count,
          2,
        );
        assert.ok(await readFile(join(output, "READY"), "utf8"));
      } finally {
        prepared.close();
      }
      assert.equal(
        (
          source.prepare("SELECT audio_path FROM tracks WHERE id = ?").get(track.id) as {
            audio_path: string;
          }
        ).audio_path,
        audioPath,
      );
      assert.equal(
        (source.prepare("SELECT workspace_id FROM set_drafts").get() as { workspace_id: null })
          .workspace_id,
        null,
      );
      await assert.rejects(
        preparePublicData(
          sourcePath,
          output,
          { version: 1, tracks: [] },
          "https://demo.example.test",
        ),
        /EEXIST/,
      );
    } finally {
      source.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

function pcmFixture(): Buffer {
  const samples = 4410;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 440) / 44100) * 500), 44 + i * 2);
  return wav;
}
