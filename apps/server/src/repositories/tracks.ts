import type { DatabaseSync } from "node:sqlite";

import { sampleTracks, type Track, type TrackKey } from "@djdesk/domain";

export interface TrackRepository {
  getTrackHarmony(trackId: string): Promise<TrackHarmony | null>;
  listTracks(): Promise<readonly Track[]>;
}

export interface TrackHarmony {
  chordSegments: TrackChordSegment[];
  trackId: string;
  usedChords: string[];
}

export interface TrackChordSegment {
  bass: string | null;
  basicLabel: string | null;
  chord: string;
  degree: string | null;
  durationS: number;
  endS: number;
  index: number;
  label: string;
  midiNotes: string | null;
  startS: number;
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
  key_unknown: 0 | 1;
  modal_variant: TrackKey["variant"];
  mode: TrackKey["mode"];
  title: string;
  tonic: TrackKey["tonic"];
}

interface ChordRow {
  symbol: string;
  track_id: string;
}

interface TagRow {
  tag: string;
  track_id: string;
}

interface ChordSegmentRow {
  bass: string | null;
  basic_label: string | null;
  chord: string;
  degree: string | null;
  duration_s: number;
  end_s: number;
  label: string;
  midi_notes: string | null;
  segment_index: number;
  start_s: number;
}

export function createInMemoryTrackRepository(
  seed: readonly Track[] = sampleTracks,
): TrackRepository {
  const tracks = [...seed];

  return {
    async getTrackHarmony(trackId) {
      const track = tracks.find((candidate) => candidate.id === trackId);

      if (!track) {
        return null;
      }

      return {
        chordSegments: track.chordProgression.map((symbol, index) => ({
          bass: null,
          basicLabel: symbol,
          chord: symbol,
          degree: null,
          durationS: 0,
          endS: 0,
          index: index + 1,
          label: symbol,
          midiNotes: null,
          startS: 0,
        })),
        trackId,
        usedChords: [...new Set(track.chordProgression)],
      };
    },
    async listTracks() {
      return tracks;
    },
  };
}

export function createSqliteTrackRepository(database: DatabaseSync): TrackRepository {
  return {
    async getTrackHarmony(trackId) {
      const trackExists = database.prepare("SELECT 1 FROM tracks WHERE id = ?").get(trackId);

      if (!trackExists) {
        return null;
      }

      const rows = database
        .prepare(
          `
            SELECT
              segment_index,
              start_s,
              end_s,
              duration_s,
              chord,
              bass,
              label,
              basic_label,
              degree,
              midi_notes
            FROM chordai_chord_segments
            WHERE report_id = (
              SELECT id
              FROM chordai_reports
              WHERE track_id = ?
              ORDER BY created_at DESC
              LIMIT 1
            )
            ORDER BY segment_index
          `,
        )
        .all(trackId) as unknown as ChordSegmentRow[];

      if (rows.length === 0) {
        return {
          chordSegments: fallbackCompactChordSegments(database, trackId),
          trackId,
          usedChords: getCompactUsedChords(database, trackId),
        };
      }

      const chordSegments = rows.map(toChordSegment);

      return {
        chordSegments,
        trackId,
        usedChords: getUsedChords(chordSegments),
      };
    },
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
              key_unknown,
              harmony_notes,
              comment,
              duration_seconds
            FROM tracks
            WHERE does_not_fit = 0
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

function fallbackCompactChordSegments(
  database: DatabaseSync,
  trackId: string,
): TrackChordSegment[] {
  return (
    database
      .prepare(
        `
          SELECT symbol
          FROM track_chords
          WHERE track_id = ?
          ORDER BY position
        `,
      )
      .all(trackId) as unknown as { symbol: string }[]
  ).map((row, index) => ({
    bass: null,
    basicLabel: row.symbol,
    chord: row.symbol,
    degree: null,
    durationS: 0,
    endS: 0,
    index: index + 1,
    label: row.symbol,
    midiNotes: null,
    startS: 0,
  }));
}

function getCompactUsedChords(database: DatabaseSync, trackId: string): string[] {
  const rows = database
    .prepare(
      `
        SELECT symbol
        FROM track_chords
        WHERE track_id = ?
        ORDER BY position
      `,
    )
    .all(trackId) as unknown as { symbol: string }[];

  return [...new Set(rows.map((row) => row.symbol))];
}

function toChordSegment(row: ChordSegmentRow): TrackChordSegment {
  return {
    bass: row.bass,
    basicLabel: row.basic_label,
    chord: row.chord,
    degree: row.degree,
    durationS: row.duration_s,
    endS: row.end_s,
    index: row.segment_index,
    label: row.label,
    midiNotes: row.midi_notes,
    startS: row.start_s,
  };
}

function getUsedChords(segments: readonly TrackChordSegment[]): string[] {
  const used = new Set<string>();

  for (const segment of segments) {
    if (segment.label && segment.label !== "N") {
      used.add(segment.label);
    }
  }

  return [...used];
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
      if (!track.key) {
        throw new Error(`Cannot seed track without key: ${track.id}`);
      }

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
  const key: TrackKey | null =
    row.key_unknown === 1
      ? null
      : {
          mode: row.mode,
          tonic: row.tonic,
          variant: row.modal_variant,
        };

  return {
    id: row.id,
    title: row.title,
    ...(row.artist ? { artist: row.artist } : {}),
    bpm: row.bpm,
    key,
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
