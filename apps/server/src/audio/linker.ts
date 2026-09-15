import { readdir } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../db/database.ts";
import { runMigrations } from "../db/migrations.ts";
import { analyzeAudioQuality } from "./quality.ts";
import { writeTrackAudioQuality } from "./quality-backfill.ts";

export interface AudioLinkOptions {
  databasePath: string;
  roots: string[];
}

export interface AudioLinkResult {
  filesScanned: number;
  linked: AudioLinkMatch[];
  roots: string[];
  unmatched: AudioLinkTrack[];
}

export interface AudioLinkMatch {
  audioPath: string;
  trackId: string;
  title: string;
}

export interface AudioLinkTrack {
  artist: string | null;
  audioFileName: string | null;
  id: string;
  title: string;
}

export interface AudioFileCandidate {
  audioPath: string;
  extensionRank: number;
  name: string;
  normalizedName: string;
  rootIndex: number;
}

const audioExtensions = new Set([".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".wav"]);
const preferredExtensions = [".flac", ".wav", ".aiff", ".aif", ".m4a", ".mp3", ".aac"];

export async function linkAudioFiles(options: AudioLinkOptions): Promise<AudioLinkResult> {
  const database = await openDatabase(options.databasePath);

  try {
    await runMigrations(database);

    return await linkAudioFilesIntoDatabase(database, options);
  } finally {
    database.close();
  }
}

export async function linkAudioFilesIntoDatabase(
  database: DatabaseSync,
  options: AudioLinkOptions,
): Promise<AudioLinkResult> {
  const roots = options.roots.map((root) => resolve(root));
  const candidates = await collectAudioFiles(roots);
  const tracks = readLinkableTracks(database);
  const linked: AudioLinkMatch[] = [];
  const unmatched: AudioLinkTrack[] = [];
  const updateTrack = database.prepare(`
    UPDATE tracks
    SET
      audio_path = ?,
      audio_codec = NULL,
      audio_container = NULL,
      audio_sample_rate_hz = NULL,
      audio_bit_depth = NULL,
      audio_bitrate_kbps = NULL,
      audio_bitrate_mode = 'unknown',
      audio_quality_status = 'unknown',
      audio_lossy_high_bitrate = 0,
      audio_quality_analyzed_at = NULL,
      audio_quality_probe_error = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  database.exec("BEGIN IMMEDIATE");

  try {
    for (const track of tracks) {
      const audioFile = findBestAudioFileForTrack(track, candidates);

      if (!audioFile) {
        unmatched.push(track);
        continue;
      }

      updateTrack.run(audioFile.audioPath, track.id);
      linked.push({
        audioPath: audioFile.audioPath,
        title: track.title,
        trackId: track.id,
      });
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  await updateLinkedAudioQuality(database, linked);

  return {
    filesScanned: candidates.length,
    linked,
    roots,
    unmatched,
  };
}

async function updateLinkedAudioQuality(
  database: DatabaseSync,
  linked: readonly AudioLinkMatch[],
): Promise<void> {
  for (const match of linked) {
    const quality = await analyzeAudioQuality(match.audioPath);

    writeTrackAudioQuality(database, match.trackId, quality);
  }
}

export function findBestAudioFileForTrack(
  track: AudioLinkTrack,
  candidates: readonly AudioFileCandidate[],
): AudioFileCandidate | null {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: getAudioMatchScore(track, candidate),
    }))
    .filter((entry) => entry.score > 0)
    .sort((first, second) => {
      if (first.score !== second.score) {
        return second.score - first.score;
      }

      if (first.candidate.rootIndex !== second.candidate.rootIndex) {
        return first.candidate.rootIndex - second.candidate.rootIndex;
      }

      if (first.candidate.extensionRank !== second.candidate.extensionRank) {
        return first.candidate.extensionRank - second.candidate.extensionRank;
      }

      return first.candidate.audioPath.localeCompare(second.candidate.audioPath);
    });

  return scored[0]?.candidate ?? null;
}

export function normalizeAudioLookupText(value: string): string {
  return value
    .trim()
    .replace(/\.(aac|aiff?|flac|m4a|mp3|wav)$/iu, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[–—-]/g, " ")
    .replace(/_/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function collectAudioFiles(roots: readonly string[]): Promise<AudioFileCandidate[]> {
  const candidates: AudioFileCandidate[] = [];

  await Promise.all(
    roots.map(async (root, rootIndex) => {
      await collectAudioFilesFromDirectory(root, rootIndex, candidates).catch(() => undefined);
    }),
  );

  return candidates;
}

async function collectAudioFilesFromDirectory(
  directory: string,
  rootIndex: number,
  candidates: AudioFileCandidate[],
): Promise<void> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        await collectAudioFilesFromDirectory(path, rootIndex, candidates);
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      const extension = extname(entry.name).toLocaleLowerCase();

      if (!audioExtensions.has(extension)) {
        return;
      }

      const name = basename(entry.name, extension);

      candidates.push({
        audioPath: path,
        extensionRank: getExtensionRank(extension),
        name,
        normalizedName: normalizeAudioLookupText(name),
        rootIndex,
      });
    }),
  );
}

function readLinkableTracks(database: DatabaseSync): AudioLinkTrack[] {
  return database
    .prepare(
      `
        SELECT
          t.id,
          t.title,
          t.artist,
          (
            SELECT cr.audio_file_name
            FROM chordai_reports cr
            WHERE cr.track_id = t.id
            ORDER BY cr.created_at DESC
            LIMIT 1
          ) AS audioFileName
        FROM tracks t
        ORDER BY t.title COLLATE NOCASE
      `,
    )
    .all() as unknown as AudioLinkTrack[];
}

function getAudioMatchScore(track: AudioLinkTrack, candidate: AudioFileCandidate): number {
  const keys = getTrackLookupKeys(track);
  const fileKey = candidate.normalizedName;
  let bestScore = 0;

  for (const key of keys) {
    if (!key) {
      continue;
    }

    if (fileKey === key.value) {
      bestScore = Math.max(bestScore, key.score);
      continue;
    }

    if (key.allowSuffix && key.value.length >= 5 && fileKey.endsWith(` ${key.value}`)) {
      bestScore = Math.max(bestScore, key.score - 20);
    }
  }

  return bestScore;
}

function getTrackLookupKeys(
  track: AudioLinkTrack,
): { allowSuffix: boolean; score: number; value: string }[] {
  const title = normalizeAudioLookupText(stripWrappingQuotes(track.title));
  const audioFileName = track.audioFileName
    ? normalizeAudioLookupText(stripWrappingQuotes(track.audioFileName))
    : "";
  const artist = track.artist ? normalizeAudioLookupText(track.artist) : "";
  const keys = [
    {
      allowSuffix: true,
      score: 120,
      value: audioFileName,
    },
    {
      allowSuffix: true,
      score: 110,
      value: title,
    },
  ];

  if (artist && title) {
    keys.push({
      allowSuffix: false,
      score: 130,
      value: `${artist} ${title}`,
    });
  }

  return dedupeLookupKeys(addSoftJoinWordVariants(keys));
}

function addSoftJoinWordVariants(
  keys: { allowSuffix: boolean; score: number; value: string }[],
): { allowSuffix: boolean; score: number; value: string }[] {
  return keys.flatMap((key) => {
    const valueWithoutSoftJoinWords = removeSoftJoinWords(key.value);

    if (valueWithoutSoftJoinWords === key.value) {
      return [key];
    }

    return [
      key,
      {
        ...key,
        score: key.score - 8,
        value: valueWithoutSoftJoinWords,
      },
    ];
  });
}

function removeSoftJoinWords(value: string): string {
  return value
    .split(" ")
    .filter((part) => part !== "and")
    .join(" ");
}

function dedupeLookupKeys(
  keys: { allowSuffix: boolean; score: number; value: string }[],
): { allowSuffix: boolean; score: number; value: string }[] {
  const deduped = new Map<string, { allowSuffix: boolean; score: number; value: string }>();

  for (const key of keys) {
    if (!key.value) {
      continue;
    }

    const existing = deduped.get(key.value);

    if (!existing || key.score > existing.score) {
      deduped.set(key.value, key);
    }
  }

  return [...deduped.values()];
}

function getExtensionRank(extension: string): number {
  const index = preferredExtensions.indexOf(extension);

  return index === -1 ? preferredExtensions.length : index;
}

function stripWrappingQuotes(value: string): string {
  return value.trim().replace(/^["'“”]+|["'“”]+$/g, "");
}
