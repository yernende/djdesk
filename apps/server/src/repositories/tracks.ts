import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import {
  PITCH_CLASSES,
  sampleTracks,
  type DiatonicMode,
  type ModalVariant,
  type Track,
  type TrackAnalysisConfidence,
  type TrackAudioQuality,
  type TrackKey,
  type VerificationState,
} from "@djdesk/domain";

export interface TrackRepository {
  createSetDraft(input: CreateSetDraftInput): Promise<SetDraft>;
  createTrack(input: CreateTrackInput): Promise<Track>;
  deleteSetDraft(setId: string): Promise<boolean>;
  getTrackAudioSource(trackId: string): Promise<TrackAudioSource | null>;
  getTrackHarmony(trackId: string): Promise<TrackHarmony | null>;
  getTrackById(trackId: string): Promise<Track | null>;
  listSetDrafts(): Promise<readonly SetDraft[]>;
  listTracks(): Promise<readonly Track[]>;
  renameSetDraft(setId: string, input: RenameSetDraftInput): Promise<SetDraft | null>;
  replaceSetDraftTracks(setId: string, trackIds: readonly string[]): Promise<SetDraft | null>;
  updateTrackAnalysis(trackId: string, input: TrackAnalysisUpdateInput): Promise<Track | null>;
  updateTrackAudioPath(trackId: string, audioPath: string): Promise<Track | null>;
  updateTrackAudioQuality(trackId: string, quality: TrackAudioQuality): Promise<Track | null>;
}

export interface CreateSetDraftInput {
  name: string;
}

export interface RenameSetDraftInput {
  name: string;
}

export interface SetDraft {
  comment: string | null;
  id: string;
  name: string;
  trackIds: string[];
}

export interface CreateTrackInput {
  artist?: string | null;
  bpm?: number | null;
  chords?: readonly string[];
  comment?: string | null;
  harmonyNotes?: string | null;
  key?: TrackKey | null;
  nonStandardTuning?: boolean;
  tags?: readonly string[];
  title: string;
}

export interface TrackAnalysisUpdateInput {
  bpm?: number | null;
  chords?: readonly string[];
  comment?: string | null;
  confidence?: Partial<Pick<TrackAnalysisConfidence, "bpm" | "key">>;
  harmonyNotes?: string | null;
  key?: TrackKey | null;
  nonStandardTuning?: boolean;
  tags?: readonly string[];
}

export interface TrackAudioSource {
  audioPath: string;
  title: string;
  trackId: string;
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
  audio_bit_depth: number | null;
  audio_bitrate_kbps: number | null;
  audio_bitrate_mode: TrackAudioQuality["bitrateMode"];
  audio_codec: string | null;
  audio_container: string | null;
  audio_lossy_high_bitrate: 0 | 1;
  audio_path: string | null;
  audio_quality_analyzed_at: string | null;
  audio_quality_probe_error: string | null;
  audio_quality_status: TrackAudioQuality["status"];
  audio_sample_rate_hz: number | null;
  artist: string | null;
  bpm: number | null;
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
  non_standard_tuning: 0 | 1;
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

interface SetDraftRow {
  comment: string | null;
  id: string;
  name: string;
}

interface SetDraftTrackRow {
  set_draft_id: string;
  track_id: string;
}

export function createInMemoryTrackRepository(
  seed: readonly Track[] = sampleTracks,
): TrackRepository {
  const tracks = [...seed];
  let setDrafts: SetDraft[] = [];

  return {
    async createSetDraft(input) {
      const setDraft = {
        comment: null,
        id: `set-${randomUUID()}`,
        name: normalizeRequiredText(input.name, "Set name"),
        trackIds: [],
      };

      setDrafts = [...setDrafts, setDraft];

      return setDraft;
    },
    async createTrack(input) {
      const normalized = normalizeCreateTrackInput(input);
      const track: Track = {
        id: `trk-man-${randomUUID()}`,
        title: normalized.title,
        ...(normalized.artist ? { artist: normalized.artist } : {}),
        bpm: normalized.bpm,
        key: normalized.key,
        chordProgression: normalized.chords,
        confidence: {
          bpm: normalized.bpm === null ? "estimated" : "confirmed",
          chords: normalized.chords.length > 0 ? "confirmed" : "estimated",
          key: normalized.key ? "confirmed" : "estimated",
        },
        ...(normalized.harmonyNotes ? { harmonyNotes: normalized.harmonyNotes } : {}),
        ...(normalized.comment ? { comment: normalized.comment } : {}),
        nonStandardTuning: normalized.nonStandardTuning,
        tags: normalized.tags,
      };

      tracks.push(track);

      return track;
    },
    async deleteSetDraft(setId) {
      const previousLength = setDrafts.length;

      setDrafts = setDrafts.filter((setDraft) => setDraft.id !== setId);

      return setDrafts.length !== previousLength;
    },
    async getTrackAudioSource(trackId) {
      const track = tracks.find((candidate) => candidate.id === trackId);

      return track?.audioPath
        ? {
            audioPath: track.audioPath,
            title: track.title,
            trackId,
          }
        : null;
    },
    async getTrackById(trackId) {
      return tracks.find((track) => track.id === trackId) ?? null;
    },
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
    async listSetDrafts() {
      return setDrafts;
    },
    async renameSetDraft(setId, input) {
      const nextName = normalizeRequiredText(input.name, "Set name");
      const setDraft = setDrafts.find((candidate) => candidate.id === setId);

      if (!setDraft) {
        return null;
      }

      setDraft.name = nextName;

      return setDraft;
    },
    async replaceSetDraftTracks(setId, trackIds) {
      const setDraft = setDrafts.find((candidate) => candidate.id === setId);

      if (!setDraft) {
        return null;
      }

      const knownTrackIds = new Set(tracks.map((track) => track.id));
      const missingTrackId = trackIds.find((trackId) => !knownTrackIds.has(trackId));

      if (missingTrackId) {
        throw new TrackRepositoryValidationError(`Track not found: ${missingTrackId}`);
      }

      setDraft.trackIds = [...trackIds];

      return setDraft;
    },
    async updateTrackAnalysis(trackId, input) {
      const index = tracks.findIndex((track) => track.id === trackId);
      const track = tracks[index];

      if (index === -1 || !track) {
        return null;
      }

      const updated = applyTrackAnalysisUpdate(track, input);

      tracks[index] = updated;

      return updated;
    },
    async updateTrackAudioPath(trackId, audioPath) {
      const index = tracks.findIndex((track) => track.id === trackId);
      const track = tracks[index];

      if (index === -1 || !track) {
        return null;
      }

      const { audioQuality: _audioQuality, ...trackWithoutAudioQuality } = track;
      const updated = {
        ...trackWithoutAudioQuality,
        audioPath,
      };

      tracks[index] = updated;

      return updated;
    },
    async updateTrackAudioQuality(trackId, quality) {
      const index = tracks.findIndex((track) => track.id === trackId);
      const track = tracks[index];

      if (index === -1 || !track) {
        return null;
      }

      const updated = {
        ...track,
        audioQuality: quality,
      };

      tracks[index] = updated;

      return updated;
    },
  };
}

export function createSqliteTrackRepository(database: DatabaseSync): TrackRepository {
  return {
    async createSetDraft(input) {
      const setDraft: SetDraft = {
        comment: null,
        id: `set-${randomUUID()}`,
        name: normalizeRequiredText(input.name, "Set name"),
        trackIds: [],
      };

      database
        .prepare(
          `
            INSERT INTO set_drafts (id, name, comment)
            VALUES (?, ?, NULL)
          `,
        )
        .run(setDraft.id, setDraft.name);

      return setDraft;
    },
    async createTrack(input) {
      const normalized = normalizeCreateTrackInput(input);
      const trackId = `trk-man-${randomUUID()}`;
      const key = normalized.key ?? getDefaultUnknownKey();

      database.exec("BEGIN IMMEDIATE");

      try {
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
                harmony_notes,
                comment,
                raw_key,
                source_kind,
                source_identity,
                key_unknown,
                non_standard_tuning
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'manual', NULL, ?, ?)
            `,
          )
          .run(
            trackId,
            normalized.title,
            normalized.artist,
            normalized.bpm,
            key.tonic,
            key.mode,
            key.variant,
            normalized.key ? "confirmed" : "estimated",
            normalized.bpm === null ? "estimated" : "confirmed",
            normalized.chords.length > 0 ? "confirmed" : "estimated",
            normalized.harmonyNotes,
            normalized.comment,
            normalized.key ? 0 : 1,
            normalized.nonStandardTuning ? 1 : 0,
          );

        replaceTrackChords(database, trackId, normalized.chords);
        replaceTrackTags(database, trackId, normalized.tags);

        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      const track = readTrackById(database, trackId);

      if (!track) {
        throw new Error(`Created track could not be read: ${trackId}`);
      }

      return track;
    },
    async deleteSetDraft(setId) {
      const result = database.prepare("DELETE FROM set_drafts WHERE id = ?").run(setId);

      return result.changes > 0;
    },
    async getTrackAudioSource(trackId) {
      const row = database
        .prepare(
          `
            SELECT id, title, audio_path
            FROM tracks
            WHERE id = ? AND audio_path IS NOT NULL
          `,
        )
        .get(trackId) as unknown as
        | {
            audio_path: string | null;
            id: string;
            title: string;
          }
        | undefined;

      return row?.audio_path
        ? {
            audioPath: row.audio_path,
            title: row.title,
            trackId: row.id,
          }
        : null;
    },
    async getTrackById(trackId) {
      return readTrackById(database, trackId);
    },
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
      return readTracks(database);
    },
    async listSetDrafts() {
      return readSetDrafts(database);
    },
    async renameSetDraft(setId, input) {
      const name = normalizeRequiredText(input.name, "Set name");
      const result = database
        .prepare(
          `
            UPDATE set_drafts
            SET name = ?, updated_at = datetime('now')
            WHERE id = ?
          `,
        )
        .run(name, setId);

      if (result.changes === 0) {
        return null;
      }

      return readSetDraftById(database, setId);
    },
    async replaceSetDraftTracks(setId, trackIds) {
      if (!setDraftExists(database, setId)) {
        return null;
      }

      ensureTracksExist(database, trackIds);

      database.exec("BEGIN IMMEDIATE");

      try {
        replaceSetDraftTrackRows(database, setId, trackIds);
        database
          .prepare("UPDATE set_drafts SET updated_at = datetime('now') WHERE id = ?")
          .run(setId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return readSetDraftById(database, setId);
    },
    async updateTrackAnalysis(trackId, input) {
      let updated: Track | null = null;

      database.exec("BEGIN IMMEDIATE");

      try {
        const existing = readTrackById(database, trackId);

        if (!existing) {
          database.exec("ROLLBACK");
          return null;
        }

        updated = applyTrackAnalysisUpdate(existing, input);

        const key = updated.key ?? getDefaultUnknownKey();

        database
          .prepare(
            `
              UPDATE tracks
              SET
                bpm = ?,
                tonic = ?,
                mode = ?,
                modal_variant = ?,
                key_unknown = ?,
                key_confidence = ?,
                bpm_confidence = ?,
                harmony_notes = ?,
                comment = ?,
                non_standard_tuning = ?,
                updated_at = datetime('now')
              WHERE id = ?
            `,
          )
          .run(
            updated.bpm,
            key.tonic,
            key.mode,
            key.variant,
            updated.key ? 0 : 1,
            updated.confidence.key,
            updated.confidence.bpm,
            updated.harmonyNotes ?? null,
            updated.comment ?? null,
            updated.nonStandardTuning ? 1 : 0,
            trackId,
          );

        if (input.chords) {
          replaceTrackChords(database, trackId, updated.chordProgression);
          database
            .prepare(
              `
                UPDATE tracks
                SET chords_confidence = ?, updated_at = datetime('now')
                WHERE id = ?
              `,
            )
            .run(updated.confidence.chords, trackId);
        }

        if (input.tags) {
          replaceTrackTags(database, trackId, updated.tags);
        }

        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return updated ? readTrackById(database, trackId) : null;
    },
    async updateTrackAudioPath(trackId, audioPath) {
      const result = database
        .prepare(
          `
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
          `,
        )
        .run(audioPath, trackId);

      if (result.changes === 0) {
        return null;
      }

      return readTrackById(database, trackId);
    },
    async updateTrackAudioQuality(trackId, quality) {
      const result = database
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

      if (result.changes === 0) {
        return null;
      }

      return readTrackById(database, trackId);
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

function readTrackById(database: DatabaseSync, trackId: string): Track | null {
  const tracks = readTracks(database, {
    includeHidden: true,
    trackId,
  });

  return tracks[0] ?? null;
}

function readTracks(
  database: DatabaseSync,
  options: {
    includeHidden?: boolean;
    trackId?: string;
  } = {},
): Track[] {
  const conditions: string[] = [];
  const params: string[] = [];

  if (!options.includeHidden) {
    conditions.push("does_not_fit = 0");
  }

  if (options.trackId) {
    conditions.push("id = ?");
    params.push(options.trackId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const trackRows = database
    .prepare(
      `
        SELECT
          id,
          title,
          audio_path,
          audio_codec,
          audio_container,
          audio_sample_rate_hz,
          audio_bit_depth,
          audio_bitrate_kbps,
          audio_bitrate_mode,
          audio_quality_status,
          audio_lossy_high_bitrate,
          audio_quality_analyzed_at,
          audio_quality_probe_error,
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
          duration_seconds,
          non_standard_tuning
        FROM tracks
        ${whereClause}
        ORDER BY title COLLATE NOCASE
      `,
    )
    .all(...params) as unknown as TrackRow[];
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
}

function readSetDrafts(database: DatabaseSync): SetDraft[] {
  const setRows = database
    .prepare(
      `
        SELECT id, name, comment
        FROM set_drafts
        ORDER BY created_at, name COLLATE NOCASE
      `,
    )
    .all() as unknown as SetDraftRow[];
  const trackRows = database
    .prepare(
      `
        SELECT set_draft_id, track_id
        FROM set_draft_tracks
        ORDER BY set_draft_id, position
      `,
    )
    .all() as unknown as SetDraftTrackRow[];
  const trackIdsBySet = groupSetDraftTrackRows(trackRows);

  return setRows.map((row) => ({
    comment: row.comment,
    id: row.id,
    name: row.name,
    trackIds: [...(trackIdsBySet.get(row.id) ?? [])],
  }));
}

function groupSetDraftTrackRows(rows: readonly SetDraftTrackRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const row of rows) {
    const trackIds = grouped.get(row.set_draft_id) ?? [];

    trackIds.push(row.track_id);
    grouped.set(row.set_draft_id, trackIds);
  }

  return grouped;
}

function readSetDraftById(database: DatabaseSync, setId: string): SetDraft | null {
  return readSetDrafts(database).find((setDraft) => setDraft.id === setId) ?? null;
}

function setDraftExists(database: DatabaseSync, setId: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM set_drafts WHERE id = ?").get(setId));
}

function ensureTracksExist(database: DatabaseSync, trackIds: readonly string[]): void {
  const uniqueTrackIds = [...new Set(trackIds)];

  if (uniqueTrackIds.length === 0) {
    return;
  }

  const placeholders = uniqueTrackIds.map(() => "?").join(", ");
  const rows = database
    .prepare(`SELECT id FROM tracks WHERE id IN (${placeholders})`)
    .all(...uniqueTrackIds) as unknown as { id: string }[];
  const foundTrackIds = new Set(rows.map((row) => row.id));
  const missingTrackId = uniqueTrackIds.find((trackId) => !foundTrackIds.has(trackId));

  if (missingTrackId) {
    throw new TrackRepositoryValidationError(`Track not found: ${missingTrackId}`);
  }
}

function replaceSetDraftTrackRows(
  database: DatabaseSync,
  setId: string,
  trackIds: readonly string[],
): void {
  const insertTrack = database.prepare(`
    INSERT INTO set_draft_tracks (set_draft_id, position, track_id)
    VALUES (?, ?, ?)
  `);

  database.prepare("DELETE FROM set_draft_tracks WHERE set_draft_id = ?").run(setId);

  trackIds.forEach((trackId, index) => {
    insertTrack.run(setId, index, trackId);
  });
}

function replaceTrackChords(
  database: DatabaseSync,
  trackId: string,
  chords: readonly string[],
): void {
  const insertChord = database.prepare(`
    INSERT INTO track_chords (track_id, position, symbol)
    VALUES (?, ?, ?)
  `);

  database.prepare("DELETE FROM track_chords WHERE track_id = ?").run(trackId);

  chords.forEach((symbol, index) => {
    insertChord.run(trackId, index, symbol);
  });
}

function replaceTrackTags(database: DatabaseSync, trackId: string, tags: readonly string[]): void {
  const insertTag = database.prepare(`
    INSERT INTO track_tags (track_id, tag)
    VALUES (?, ?)
  `);

  database.prepare("DELETE FROM track_tags WHERE track_id = ?").run(trackId);

  for (const tag of tags) {
    insertTag.run(trackId, tag);
  }
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
  const audioQuality = toAudioQuality(row);

  return {
    id: row.id,
    title: row.title,
    ...(row.audio_path ? { audioPath: row.audio_path } : {}),
    ...(audioQuality ? { audioQuality } : {}),
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
    nonStandardTuning: row.non_standard_tuning === 1,
    tags: tags.get(row.id) ?? [],
  };
}

function toAudioQuality(row: TrackRow): TrackAudioQuality | undefined {
  if (
    !row.audio_quality_analyzed_at &&
    !row.audio_quality_probe_error &&
    row.audio_quality_status === "unknown" &&
    !row.audio_codec &&
    !row.audio_container &&
    row.audio_sample_rate_hz === null &&
    row.audio_bit_depth === null &&
    row.audio_bitrate_kbps === null &&
    row.audio_lossy_high_bitrate === 0
  ) {
    return undefined;
  }

  return {
    analyzedAt: row.audio_quality_analyzed_at,
    bitDepth: row.audio_bit_depth,
    bitrateKbps: row.audio_bitrate_kbps,
    bitrateMode: row.audio_bitrate_mode,
    codec: row.audio_codec,
    container: row.audio_container,
    isHighBitrateLossy: row.audio_lossy_high_bitrate === 1,
    probeError: row.audio_quality_probe_error,
    sampleRateHz: row.audio_sample_rate_hz,
    status: row.audio_quality_status,
  };
}

export class TrackRepositoryValidationError extends Error {
  override name = "TrackRepositoryValidationError";
}

function applyTrackAnalysisUpdate(track: Track, input: TrackAnalysisUpdateInput): Track {
  const hasBpm = Object.hasOwn(input, "bpm");
  const hasKey = Object.hasOwn(input, "key");
  const hasChords = Object.hasOwn(input, "chords");
  const nextBpm = hasBpm ? normalizeOptionalBpm(input.bpm) : track.bpm;
  const nextKey = hasKey ? normalizeOptionalKey(input.key) : track.key;
  const nextChords = hasChords ? normalizeTextList(input.chords ?? []) : track.chordProgression;
  const nextConfidence = {
    ...track.confidence,
  };

  if (hasBpm) {
    nextConfidence.bpm = nextBpm === null ? "estimated" : "confirmed";
  }

  if (hasKey) {
    nextConfidence.key = nextKey === null ? "estimated" : "confirmed";
  }

  if (hasChords) {
    nextConfidence.chords = nextChords.length > 0 ? "confirmed" : "estimated";
  }

  if (input.confidence?.bpm) {
    nextConfidence.bpm = normalizeVerificationState(input.confidence.bpm, "BPM confidence");
  }

  if (input.confidence?.key) {
    nextConfidence.key = normalizeVerificationState(input.confidence.key, "Key confidence");
  }

  const updated: Track = {
    ...track,
    bpm: nextBpm,
    key: nextKey,
    chordProgression: nextChords,
    confidence: nextConfidence,
    nonStandardTuning: Object.hasOwn(input, "nonStandardTuning")
      ? normalizeBoolean(input.nonStandardTuning, "Non-standard tuning")
      : Boolean(track.nonStandardTuning),
    tags: Object.hasOwn(input, "tags") ? normalizeTagList(input.tags ?? []) : track.tags,
  };

  if (Object.hasOwn(input, "harmonyNotes")) {
    const harmonyNotes = normalizeOptionalText(input.harmonyNotes);

    if (harmonyNotes) {
      updated.harmonyNotes = harmonyNotes;
    } else {
      delete updated.harmonyNotes;
    }
  }

  if (Object.hasOwn(input, "comment")) {
    const comment = normalizeOptionalText(input.comment);

    if (comment) {
      updated.comment = comment;
    } else {
      delete updated.comment;
    }
  }

  return updated;
}

function normalizeCreateTrackInput(input: CreateTrackInput): Required<CreateTrackInput> {
  return {
    artist: normalizeOptionalText(input.artist),
    bpm: normalizeOptionalBpm(input.bpm ?? null),
    chords: normalizeTextList(input.chords ?? []),
    comment: normalizeOptionalText(input.comment),
    harmonyNotes: normalizeOptionalText(input.harmonyNotes),
    key: normalizeOptionalKey(input.key ?? null),
    nonStandardTuning: normalizeBoolean(input.nonStandardTuning ?? false, "Non-standard tuning"),
    tags: normalizeTagList(input.tags ?? []),
    title: normalizeRequiredText(input.title, "Track title"),
  };
}

function normalizeRequiredText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TrackRepositoryValidationError(`${label} is required`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TrackRepositoryValidationError(`${label} is required`);
  }

  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TrackRepositoryValidationError("Expected text value");
  }

  const normalized = value.trim();

  return normalized || null;
}

function normalizeOptionalBpm(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TrackRepositoryValidationError("BPM must be a positive number");
  }

  return value;
}

function normalizeOptionalKey(value: unknown): TrackKey | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "object") {
    throw new TrackRepositoryValidationError("Key must be an object or null");
  }

  const candidate = value as Partial<TrackKey>;

  return {
    mode: normalizeMode(candidate.mode),
    tonic: normalizeTonic(candidate.tonic),
    variant: normalizeVariant(candidate.variant),
  };
}

function normalizeTonic(value: unknown): TrackKey["tonic"] {
  if (typeof value === "string" && PITCH_CLASSES.includes(value as TrackKey["tonic"])) {
    return value as TrackKey["tonic"];
  }

  throw new TrackRepositoryValidationError("Invalid key tonic");
}

function normalizeMode(value: unknown): DiatonicMode {
  const modes = [
    "major",
    "natural-minor",
    "dorian",
    "phrygian",
    "lydian",
    "mixolydian",
  ] as const satisfies readonly DiatonicMode[];

  if (typeof value === "string" && modes.includes(value as DiatonicMode)) {
    return value as DiatonicMode;
  }

  throw new TrackRepositoryValidationError("Invalid key mode");
}

function normalizeVariant(value: unknown): ModalVariant {
  const variants = [
    "diatonic",
    "raised-leading-tone",
    "variable-degree",
  ] as const satisfies readonly ModalVariant[];

  if (typeof value === "string" && variants.includes(value as ModalVariant)) {
    return value as ModalVariant;
  }

  throw new TrackRepositoryValidationError("Invalid key variant");
}

function normalizeVerificationState(value: unknown, label: string): VerificationState {
  const states = ["estimated", "confirmed"] as const satisfies readonly VerificationState[];

  if (typeof value === "string" && states.includes(value as VerificationState)) {
    return value as VerificationState;
  }

  throw new TrackRepositoryValidationError(`Invalid ${label}`);
}

function normalizeBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new TrackRepositoryValidationError(`${label} must be a boolean`);
}

function normalizeTextList(values: readonly string[]): string[] {
  return values
    .map((value) => normalizeOptionalText(value))
    .filter((value): value is string => Boolean(value));
}

function normalizeTagList(values: readonly string[]): string[] {
  return [...new Set(normalizeTextList(values))];
}

function getDefaultUnknownKey(): TrackKey {
  return {
    mode: "major",
    tonic: "C",
    variant: "diatonic",
  };
}
