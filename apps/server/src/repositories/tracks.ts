import type { DatabaseSync } from "node:sqlite";

import { sampleTracks, type Track } from "@djdesk/domain";

export interface TrackRepository {
  listTracks(): Promise<readonly Track[]>;
}

interface TrackRow {
  artist: string | null;
  bpm: number;
  bpm_confidence: Track["confidence"]["bpm"];
  chords_confidence: Track["confidence"]["chords"];
  comment: string | null;
  duration_seconds: number | null;
  harmony_notes: string | null;
  id: string;
  key_confidence: Track["confidence"]["key"];
  modal_variant: Track["key"]["variant"];
  mode: Track["key"]["mode"];
  title: string;
  tonic: Track["key"]["tonic"];
}

interface ChordRow {
  symbol: string;
  track_id: string;
}

interface TagRow {
  tag: string;
  track_id: string;
}

export function createInMemoryTrackRepository(
  seed: readonly Track[] = sampleTracks,
): TrackRepository {
  const tracks = [...seed];

  return {
    async listTracks() {
      return tracks;
    },
  };
}

export function createSqliteTrackRepository(database: DatabaseSync): TrackRepository {
  return {
    async listTracks() {
      const trackRows = database
        .prepare(
          `
            SELECT
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
              harmony_notes,
              comment,
              duration_seconds
            FROM tracks
            ORDER BY title COLLATE NOCASE
          `,
        )
        .all() as unknown as TrackRow[];
      const chords = groupRows(
        database
          .prepare(
            `
              SELECT track_id, symbol
              FROM track_chords
              ORDER BY track_id, position
            `,
          )
          .all() as unknown as ChordRow[],
        "symbol",
      );
      const tags = groupRows(
        database
          .prepare(
            `
              SELECT track_id, tag
              FROM track_tags
              ORDER BY track_id, tag COLLATE NOCASE
            `,
          )
          .all() as unknown as TagRow[],
        "tag",
      );

      return trackRows.map((row) => toTrack(row, chords, tags));
    },
  };
}

export function seedTracksIfEmpty(
  database: DatabaseSync,
  seed: readonly Track[] = sampleTracks,
): boolean {
  const row = database.prepare("SELECT COUNT(*) AS count FROM tracks").get() as {
    count: number;
  };

  if (row.count > 0) {
    return false;
  }

  const insertTrack = database.prepare(`
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
      harmony_notes,
      comment,
      duration_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChord = database.prepare(`
    INSERT INTO track_chords (track_id, position, symbol)
    VALUES (?, ?, ?)
  `);
  const insertTag = database.prepare(`
    INSERT INTO track_tags (track_id, tag)
    VALUES (?, ?)
  `);

  database.exec("BEGIN IMMEDIATE");

  try {
    for (const track of seed) {
      insertTrack.run(
        track.id,
        track.title,
        track.artist ?? null,
        track.bpm,
        track.key.tonic,
        track.key.mode,
        track.key.variant,
        track.confidence.key,
        track.confidence.bpm,
        track.confidence.chords,
        track.harmonyNotes ?? null,
        track.comment ?? null,
        track.durationSeconds ?? null,
      );

      track.chordProgression.forEach((symbol, index) => {
        insertChord.run(track.id, index, symbol);
      });

      for (const tag of track.tags) {
        insertTag.run(track.id, tag);
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return true;
}

function groupRows<Row extends { track_id: string }, Field extends keyof Row>(
  rows: readonly Row[],
  field: Field,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const row of rows) {
    const values = grouped.get(row.track_id) ?? [];

    values.push(String(row[field]));
    grouped.set(row.track_id, values);
  }

  return grouped;
}

function toTrack(
  row: TrackRow,
  chords: ReadonlyMap<string, readonly string[]>,
  tags: ReadonlyMap<string, readonly string[]>,
): Track {
  return {
    id: row.id,
    title: row.title,
    ...(row.artist ? { artist: row.artist } : {}),
    bpm: row.bpm,
    key: {
      tonic: row.tonic,
      mode: row.mode,
      variant: row.modal_variant,
    },
    chordProgression: chords.get(row.id) ?? [],
    confidence: {
      bpm: row.bpm_confidence,
      chords: row.chords_confidence,
      key: row.key_confidence,
    },
    ...(row.harmony_notes ? { harmonyNotes: row.harmony_notes } : {}),
    ...(row.comment ? { comment: row.comment } : {}),
    ...(row.duration_seconds ? { durationSeconds: row.duration_seconds } : {}),
    tags: tags.get(row.id) ?? [],
  };
}
