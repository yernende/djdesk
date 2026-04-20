import type { DiatonicMode, PitchClass, Track } from "@djdesk/domain";

export const chordAiSourceKind = "chordai";

export interface ChordAiKey {
  mode: DiatonicMode;
  rawKey: string;
  tonic: PitchClass;
}

export interface ChordAiChordSegment {
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

export interface ChordAiBar {
  bar: number;
  basicProgression: string | null;
  beat1: string | null;
  beat2: string | null;
  beat3: string | null;
  beat4: string | null;
  bpm: number | null;
  durationS: number;
  slashBassProgression: string | null;
  startS: number;
}

export interface ChordAiReport {
  audioFileName: string | null;
  bars: ChordAiBar[];
  bpm: number;
  bpmStd: number | null;
  chordSegments: ChordAiChordSegment[];
  creationDate: string | null;
  durationSeconds: number;
  folderName: string;
  key: ChordAiKey;
  lastEditDate: string | null;
  meter: string | null;
  reportPath: string;
  sourceExport: string | null;
  sourceIdentity: string;
  title: string;
  trackId: string;
}

export interface ChordAiImportOptions {
  databasePath: string;
  removeSamples: boolean;
  reportsPath: string;
}

export interface ChordAiImportResult {
  errors: ChordAiImportError[];
  importedCount: number;
  importRunId: string;
  reportCount: number;
  skipped: ChordAiSkippedReport[];
}

export interface ChordAiImportError {
  error: string;
  reportPath: string;
}

export interface ChordAiSkippedReport {
  reason: string;
  reportPath: string;
}

export interface ExistingTrackState {
  bpmConfidence: Track["confidence"]["bpm"];
  chordsConfidence: Track["confidence"]["chords"];
  id: string;
  keyConfidence: Track["confidence"]["key"];
}
