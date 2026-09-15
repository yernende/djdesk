import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { runMigrations } from "../db/migrations.ts";
import { createSqliteTrackRepository } from "../repositories/tracks.ts";
import { analyzeAudioQuality } from "../audio/quality.ts";
import { readPublicConfig } from "./config.ts";
import { WorkspaceStore } from "./store.ts";

export interface PublicationManifest {
  version: 1;
  tracks: {
    id: string;
    title?: string;
    artist?: string | null;
    publish: boolean;
    audio: boolean;
  }[];
}

export async function readManifest(path: string): Promise<PublicationManifest> {
  const value = JSON.parse(await readFile(path, "utf8")) as PublicationManifest;
  if (value?.version !== 1 || !Array.isArray(value.tracks))
    throw new Error("Expected publication manifest version 1");
  const ids = new Set<string>();
  for (const item of value.tracks) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.publish !== "boolean" ||
      typeof item.audio !== "boolean" ||
      (item.audio && !item.publish)
    ) {
      throw new Error("Invalid or duplicate manifest entry; audio requires publish=true");
    }
    ids.add(item.id);
  }
  return value;
}

export function exportManifest(db: DatabaseSync): PublicationManifest {
  const rows = db
    .prepare(
      "SELECT id, title, artist FROM tracks WHERE does_not_fit = 0 ORDER BY artist, title, id",
    )
    .all() as { id: string; title: string; artist: string | null }[];
  return { version: 1, tracks: rows.map((row) => ({ ...row, publish: false, audio: false })) };
}

export function applyPublication(db: DatabaseSync, manifest: PublicationManifest): void {
  const exists = db.prepare("SELECT audio_path, does_not_fit FROM tracks WHERE id = ?");
  for (const item of manifest.tracks) {
    const row = exists.get(item.id) as
      | { audio_path: string | null; does_not_fit: number }
      | undefined;
    if (!row) throw new Error(`Unknown track ID: ${item.id}`);
    if (item.publish && row.does_not_fit)
      throw new Error(`Track is excluded from planning: ${item.id}`);
    if (item.audio && !row.audio_path) throw new Error(`Track has no audio: ${item.id}`);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM public_catalog").run();
    const insert = db.prepare("INSERT INTO public_catalog (track_id, audio_enabled) VALUES (?, ?)");
    for (const item of manifest.tracks) if (item.publish) insert.run(item.id, Number(item.audio));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function backupDatabase(source: DatabaseSync, output: string): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  // Reserve the destination without overwriting any existing backup.
  await writeFile(output, "", { flag: "wx", mode: 0o600 });
  await backup(source, output);
  const verification = new DatabaseSync(output, { readOnly: true });
  try {
    verifyDatabase(verification);
  } finally {
    verification.close();
  }
}

export function verifyDatabase(db: DatabaseSync): void {
  const integrity = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok")
    throw new Error("SQLite integrity check failed");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("SQLite foreign key check failed");
}

export async function claimLegacySets(
  db: DatabaseSync,
  origin: string,
  output: string,
): Promise<number> {
  const config = readPublicConfig({ APP_MODE: "public", PUBLIC_ORIGIN: origin })!;
  const row = db
    .prepare("SELECT count(*) AS count FROM set_drafts WHERE workspace_id IS NULL")
    .get() as { count: number };
  if (!row.count) return 0;
  const store = new WorkspaceStore(db, config);
  db.exec("BEGIN IMMEDIATE");
  try {
    const access = store.createWorkspace();
    db.prepare("UPDATE set_drafts SET workspace_id = ? WHERE workspace_id IS NULL").run(
      access.workspaceId,
    );
    await writeFile(output, `${config.origin}/w/${access.workspaceId}#key=${access.secret}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return row.count;
}

export async function preparePublicData(
  sourcePath: string,
  outputPath: string,
  manifest: PublicationManifest,
  origin: string,
  deployedAudioRoot?: string,
): Promise<{ tracks: number; audio: number; legacySets: number }> {
  const output = resolve(outputPath);
  // Preparing data always creates a new directory, never replaces a live database.
  await mkdir(output, { mode: 0o700 });
  const data = join(output, "data");
  const audio = join(output, "audio");
  await mkdir(data);
  await mkdir(audio);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const destination = join(data, "djdesk.sqlite");
  try {
    await backupDatabase(source, destination);
  } finally {
    source.close();
  }
  const db = new DatabaseSync(destination);
  const copied: { trackId: string; file: string; sha256: string; bytes: number }[] = [];
  try {
    db.exec("PRAGMA foreign_keys = ON");
    await runMigrations(db);
    // Validate the complete selection before copying; no external process sees this directory yet.
    applyPublication(db, manifest);
    const repo = createSqliteTrackRepository(db);
    for (const item of manifest.tracks.filter((track) => track.audio)) {
      const track = await repo.getTrackAudioSource(item.id);
      if (!track) throw new Error(`No source audio for ${item.id}`);
      const extension = extname(track.audioPath).toLowerCase();
      if (![".mp3", ".flac", ".aac", ".m4a", ".wav", ".aif", ".aiff"].includes(extension))
        throw new Error(`Unsupported audio extension for ${item.id}`);
      const file = `${createHash("sha256").update(item.id).digest("hex")}${extension}`;
      const localPath = join(audio, file);
      const before = await fileDigest(track.audioPath);
      await copyFile(track.audioPath, localPath);
      const after = await fileDigest(localPath);
      if (before.sha256 !== after.sha256 || before.bytes !== after.bytes)
        throw new Error(`Audio copy verification failed for ${item.id}`);
      const quality = await analyzeAudioQuality(localPath);
      if (quality.status === "unknown")
        throw new Error(`Audio analysis failed for ${item.id}; preparation remains incomplete`);
      // Quality belongs to the byte-identical deployed source file; cache is cleared by the canonical path update.
      await repo.updateTrackAudioPath(item.id, join(deployedAudioRoot ?? audio, file));
      await repo.updateTrackAudioQuality(item.id, quality);
      copied.push({ trackId: item.id, file, ...after });
    }
    const legacySets = await claimLegacySets(db, origin, join(output, "owner-access-link.txt"));
    verifyDatabase(db);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await writeFile(join(output, "audio-manifest.json"), `${JSON.stringify(copied, null, 2)}\n`, {
      mode: 0o600,
    });
    await writeFile(join(output, "publication.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    await writeFile(
      join(output, "READY"),
      "Verified SQLite and selected audio. Import into a fresh deployment only.\n",
      { mode: 0o600 },
    );
    await chmod(destination, 0o600);
    return {
      tracks: manifest.tracks.filter((track) => track.publish).length,
      audio: copied.length,
      legacySets,
    };
  } finally {
    db.close();
  }
}

async function fileDigest(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}
