import { createHash } from "node:crypto";
import { basename } from "node:path";

import { parseCsv } from "./csv.ts";
import { parseChordAiKey } from "./keys.ts";
import type { ChordAiBar, ChordAiChordSegment, ChordAiReport } from "./types.ts";

interface AndroidMetaData {
  audio_file_name?: unknown;
  creation_date?: unknown;
  duration?: unknown;
  last_edit_date?: unknown;
  title?: unknown;
}

interface TranscriptionJson {
  global_bpm_avg?: unknown;
  global_bpm_std?: unknown;
  global_metric_string?: unknown;
}

interface SummaryFields {
  bpm: number | null;
  durationSeconds: number | null;
  heading: string | null;
  key: string | null;
  meter: string | null;
  sourceExport: string | null;
}

export interface ChordAiReportFiles {
  androidMetaData: string;
  barGridCsv: string;
  chordSegmentsCsv: string;
  reportPath: string;
  summaryMarkdown: string;
  transcriptionJson: string;
}

export function parseChordAiReport(files: ChordAiReportFiles): ChordAiReport {
  const summary = parseSummary(files.summaryMarkdown);
  const metadata = JSON.parse(files.androidMetaData) as AndroidMetaData;
  const transcription = JSON.parse(files.transcriptionJson) as TranscriptionJson;
  const title = readString(metadata.title) ?? summary.heading ?? basename(files.reportPath);
  const audioFileName = readString(metadata.audio_file_name);
  const durationSeconds =
    readNumber(metadata.duration) ?? summary.durationSeconds ?? inferDuration(files.barGridCsv);
  const bpm = readNumber(transcription.global_bpm_avg) ?? summary.bpm;
  const bpmStd = readNumber(transcription.global_bpm_std);
  const meter = readString(transcription.global_metric_string) ?? summary.meter;
  const rawKey = summary.key;

  if (!durationSeconds || durationSeconds <= 0) {
    throw new Error(`Cannot import report without duration: ${files.reportPath}`);
  }

  if (!bpm || bpm <= 0) {
    throw new Error(`Cannot import report without BPM: ${files.reportPath}`);
  }

  if (!rawKey) {
    throw new Error(`Cannot import report without key: ${files.reportPath}`);
  }

  const sourceIdentity = createSourceIdentity(audioFileName ?? title, durationSeconds);

  return {
    audioFileName,
    bars: parseBarGrid(files.barGridCsv),
    bpm,
    bpmStd,
    chordSegments: parseChordSegments(files.chordSegmentsCsv),
    creationDate: readString(metadata.creation_date),
    durationSeconds,
    folderName: basename(files.reportPath),
    key: parseChordAiKey(rawKey),
    lastEditDate: readString(metadata.last_edit_date),
    meter,
    reportPath: files.reportPath,
    sourceExport: summary.sourceExport,
    sourceIdentity,
    title,
    trackId: `trk-${sourceIdentity.slice(0, 12)}`,
  };
}

export function createSourceIdentity(titleOrFileName: string, durationSeconds: number): string {
  const normalized = titleOrFileName
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
  const roundedDuration = Math.round(durationSeconds);

  return createHash("sha256").update(`${normalized}|${roundedDuration}`).digest("hex");
}

export function parseSummary(text: string): SummaryFields {
  return {
    bpm: parseNullableNumber(readSummaryValue(text, "BPM")),
    durationSeconds: parseDuration(readSummaryValue(text, "Duration")),
    heading: readHeading(text),
    key: readSummaryValue(text, "Key"),
    meter: readSummaryValue(text, "Meter"),
    sourceExport: stripBackticks(readSummaryValue(text, "Source export")),
  };
}

export function parseChordSegments(csvText: string): ChordAiChordSegment[] {
  return parseCsv(csvText).map((row) => ({
    bass: stringOrNull(row.bass),
    basicLabel: stringOrNull(row.basic_label),
    chord: requiredString(row.chord, "chord"),
    degree: stringOrNull(row.degree),
    durationS: requiredNumber(row.duration_s, "duration_s"),
    endS: requiredNumber(row.end_s, "end_s"),
    index: requiredInteger(row.index, "index"),
    label: requiredString(row.label || row.chord, "label"),
    midiNotes: stringOrNull(row.midi_notes),
    startS: requiredNumber(row.start_s, "start_s"),
  }));
}

export function parseBarGrid(csvText: string): ChordAiBar[] {
  return parseCsv(csvText).map((row) => ({
    bar: requiredInteger(row.bar, "bar"),
    basicProgression: stringOrNull(row.basic_progression),
    beat1: stringOrNull(row.beat_1),
    beat2: stringOrNull(row.beat_2),
    beat3: stringOrNull(row.beat_3),
    beat4: stringOrNull(row.beat_4),
    bpm: parseNullableNumber(row.bpm),
    durationS: requiredNumber(row.duration_s, "duration_s"),
    slashBassProgression: stringOrNull(row.slash_bass_progression),
    startS: requiredNumber(row.start_s, "start_s"),
  }));
}

export function compactChordProgression(segments: readonly ChordAiChordSegment[]): string[] {
  const progression: string[] = [];

  for (const segment of segments) {
    const label = segment.label.trim();

    if (!label || label === "N") {
      continue;
    }

    if (progression.at(-1) !== label) {
      progression.push(label);
    }
  }

  return progression;
}

function readSummaryValue(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^- ${escaped}:\\s*(.+)$`, "m").exec(text);

  return match?.[1]?.trim() ?? null;
}

function readHeading(text: string): string | null {
  const match = /^#\s+(.+)$/m.exec(text);

  return match?.[1]?.trim() ?? null;
}

function stripBackticks(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/^`|`$/g, "");
}

function parseDuration(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parts = value.split(":").map((part) => Number(part));

  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;

    if (minutes === undefined || seconds === undefined) {
      return null;
    }

    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;

    if (hours === undefined || minutes === undefined || seconds === undefined) {
      return null;
    }

    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

function inferDuration(barGridCsv: string): number | null {
  const bars = parseBarGrid(barGridCsv);
  const last = bars.at(-1);

  if (!last) {
    return null;
  }

  return last.startS + last.durationS;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseNullableNumber(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: string | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function requiredString(value: string | undefined, field: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`Missing required CSV field: ${field}`);
  }

  return trimmed;
}

function requiredNumber(value: string | undefined, field: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric CSV field ${field}: ${value ?? ""}`);
  }

  return parsed;
}

function requiredInteger(value: string | undefined, field: string): number {
  const parsed = requiredNumber(value, field);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer CSV field ${field}: ${value ?? ""}`);
  }

  return parsed;
}
