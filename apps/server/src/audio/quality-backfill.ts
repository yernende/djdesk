import type { DatabaseSync } from "node:sqlite";

import type { TrackAudioQuality } from "@djdesk/domain";

import { analyzeAudioQuality, type AnalyzeAudioQualityOptions } from "./quality.ts";

export interface AudioQualityBackfillOptions extends AnalyzeAudioQualityOptions {
  concurrency?: number;
  dryRun?: boolean;
  force?: boolean;
  limit?: number | null;
  trackIds?: readonly string[];
}

export interface AudioQualityBackfillItem {
  audioPath: string;
  quality: TrackAudioQuality;
  title: string;
  trackId: string;
}

export interface AudioQualityBackfillResult {
  analyzed: AudioQualityBackfillItem[];
  dryRun: boolean;
  totalCandidates: number;
}

interface AudioQualityCandidateRow {
  audio_path: string;
  id: string;
  title: string;
}

interface IndexedBackfillItem extends AudioQualityBackfillItem {
  index: number;
}

export async function backfillAudioQuality(
  database: DatabaseSync,
  options: AudioQualityBackfillOptions = {},
): Promise<AudioQualityBackfillResult> {
  const rows = readAudioQualityCandidates(database, options);
  const concurrency = normalizeConcurrency(options.concurrency);
  const results: IndexedBackfillItem[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < rows.length) {
      const index = nextIndex;
      nextIndex += 1;

      const row = rows[index];

      if (!row) {
        continue;
      }

      const quality = await analyzeAudioQuality(row.audio_path, options);

      if (!options.dryRun) {
        writeTrackAudioQuality(database, row.id, quality);
      }

      results.push({
        audioPath: row.audio_path,
        index,
        quality,
        title: row.title,
        trackId: row.id,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, async () => runWorker()),
  );

  return {
    analyzed: results.sort((first, second) => first.index - second.index).map(toBackfillItem),
    dryRun: Boolean(options.dryRun),
    totalCandidates: rows.length,
  };
}

export function writeTrackAudioQuality(
  database: DatabaseSync,
  trackId: string,
  quality: TrackAudioQuality,
): void {
  database
    .prepare(
      `
        UPDATE tracks
        SET
          audio_codec = ?,
          audio_container = ?,
          audio_sample_rate_hz = ?,
          audio_bit_depth = ?,
          audio_bitrate_kbps = ?,
          audio_bitrate_mode = ?,
          audio_quality_status = ?,
          audio_lossy_high_bitrate = ?,
          audio_quality_analyzed_at = ?,
          audio_quality_probe_error = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `,
    )
    .run(
      quality.codec,
      quality.container,
      quality.sampleRateHz,
      quality.bitDepth,
      quality.bitrateKbps,
      quality.bitrateMode,
      quality.status,
      quality.isHighBitrateLossy ? 1 : 0,
      quality.analyzedAt,
      quality.probeError,
      trackId,
    );
}

function readAudioQualityCandidates(
  database: DatabaseSync,
  options: AudioQualityBackfillOptions,
): AudioQualityCandidateRow[] {
  const conditions = ["audio_path IS NOT NULL"];
  const params: (number | string)[] = [];

  if (!options.force) {
    conditions.push("audio_quality_analyzed_at IS NULL");
  }

  if (options.trackIds && options.trackIds.length > 0) {
    const uniqueTrackIds = [...new Set(options.trackIds)];
    const placeholders = uniqueTrackIds.map(() => "?").join(", ");

    conditions.push(`id IN (${placeholders})`);
    params.push(...uniqueTrackIds);
  }

  const limitClause = options.limit === null || options.limit === undefined ? "" : "LIMIT ?";

  if (limitClause) {
    params.push(options.limit ?? 0);
  }

  return database
    .prepare(
      `
        SELECT id, title, audio_path
        FROM tracks
        WHERE ${conditions.join(" AND ")}
        ORDER BY title COLLATE NOCASE
        ${limitClause}
      `,
    )
    .all(...params) as unknown as AudioQualityCandidateRow[];
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 4;
  }

  return Math.max(1, Math.min(16, Math.floor(value)));
}

function toBackfillItem(item: IndexedBackfillItem): AudioQualityBackfillItem {
  return {
    audioPath: item.audioPath,
    quality: item.quality,
    title: item.title,
    trackId: item.trackId,
  };
}
