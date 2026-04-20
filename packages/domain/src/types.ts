export const PITCH_CLASSES = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
  "G#",
  "D#",
  "A#",
  "F",
] as const;

export type PitchClass = (typeof PITCH_CLASSES)[number];

export interface PitchClassLabel {
  pitch: PitchClass;
  primary: string;
  enharmonic?: string;
}

export type DiatonicMode =
  | "major"
  | "natural-minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian";

export type ModalVariant = "diatonic" | "raised-leading-tone" | "variable-degree";

export type VerificationState = "estimated" | "confirmed" | "rejected";

export type ModalPlacementLane = "home" | "pure-modal" | "modal-mixture";

export interface TrackKey {
  tonic: PitchClass;
  mode: DiatonicMode;
  variant: ModalVariant;
}

export interface ModalPlacement {
  homeIndex: number;
  targetIndex: number;
  displayIndex: number;
  lane: ModalPlacementLane;
  summary: string;
}

export interface TrackAnalysisConfidence {
  bpm: VerificationState;
  chords: VerificationState;
  key: VerificationState;
}

export interface Track {
  id: string;
  title: string;
  artist?: string;
  bpm: number;
  key: TrackKey | null;
  chordProgression: readonly string[];
  confidence: TrackAnalysisConfidence;
  harmonyNotes?: string;
  comment?: string;
  durationSeconds?: number;
  tags: readonly string[];
}

export interface CircleBucket {
  index: number;
  label: PitchClassLabel;
  tonic: PitchClass;
  tracks: Track[];
}
