import {
  CIRCLE_OF_FIFTHS,
  describeKey,
  getModeLabel,
  getVariantLabel,
  PITCH_CLASS_LABELS,
  localizeSolfege,
  type DisplayLocale,
} from "./circle.ts";
import type { PitchClass, PitchClassLabel, TrackKey } from "./types.ts";

export type KeyNotation = "letters" | "solfege" | "camelot" | "open-key";
export const KEY_NOTATIONS: readonly KeyNotation[] = ["letters", "solfege", "camelot", "open-key"];
const SEMITONES: Record<PitchClass, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};
const LETTERS: Record<PitchClass, string> = {
  C: "C",
  "C#": "C♯",
  D: "D",
  "D#": "E♭",
  E: "E",
  F: "F",
  "F#": "F♯",
  G: "G",
  "G#": "G♯",
  A: "A",
  "A#": "B♭",
  B: "B",
};

export function formatKeyNotation(
  key: TrackKey | null,
  notation: KeyNotation,
  locale: DisplayLocale = "en",
): string {
  if (!key) return locale === "ru" ? "Тональность неизвестна" : "Unknown key";
  if (notation === "solfege") return describeKey(key, locale);
  const plain =
    key.variant === "diatonic" && (key.mode === "major" || key.mode === "natural-minor");
  if (plain && (notation === "camelot" || notation === "open-key")) {
    const minor = key.mode === "natural-minor";
    const relativeMinor = (SEMITONES[key.tonic] + (minor ? 0 : 9)) % 12;
    const index = CIRCLE_OF_FIFTHS.findIndex((pitch) => SEMITONES[pitch] === relativeMinor);
    return notation === "camelot"
      ? `${((index + 7) % 12) + 1}${minor ? "A" : "B"}`
      : `${index + 1}${minor ? "m" : "d"}`;
  }
  // Numeric major/minor codes must never disguise a mode or modal mixture.
  const mode = plain
    ? locale === "ru"
      ? key.mode === "major"
        ? "мажор"
        : "минор"
      : key.mode === "major"
        ? "major"
        : "minor"
    : getModeLabel(key.mode, locale);
  return `${LETTERS[key.tonic]} ${mode}${key.variant === "diatonic" ? "" : `, ${getVariantLabel(key.variant, locale)}`}`;
}

export function formatCircleNotation(
  pitch: PitchClass,
  notation: KeyNotation,
  locale: DisplayLocale = "en",
): PitchClassLabel {
  return notation === "solfege"
    ? {
        ...PITCH_CLASS_LABELS[pitch],
        primary: localizeSolfege(PITCH_CLASS_LABELS[pitch].primary, locale),
        ...(PITCH_CLASS_LABELS[pitch].enharmonic
          ? { enharmonic: localizeSolfege(PITCH_CLASS_LABELS[pitch].enharmonic!, locale) }
          : {}),
      }
    : {
        pitch,
        primary: formatKeyNotation(
          { tonic: pitch, mode: "natural-minor", variant: "diatonic" },
          notation,
          locale,
        ),
      };
}
