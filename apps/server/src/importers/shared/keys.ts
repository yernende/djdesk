import type { DiatonicMode, PitchClass } from "@djdesk/domain";

export interface ImportedKey {
  mode: DiatonicMode;
  rawKey: string;
  tonic: PitchClass;
}

const flatToSharp = new Map<string, PitchClass>([
  ["Cb", "B"],
  ["Db", "C#"],
  ["Eb", "D#"],
  ["Fb", "E"],
  ["Gb", "F#"],
  ["Ab", "G#"],
  ["Bb", "A#"],
]);

const sharpAliases = new Map<string, PitchClass>([
  ["B#", "C"],
  ["E#", "F"],
]);

const pitchClasses = new Set<PitchClass>([
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
]);

export function parseImportedKey(rawKey: string, sourceLabel: string): ImportedKey {
  const trimmed = normalizeConfusableKeyText(rawKey);
  const match = /^([A-G](?:#|b)?)(m?)$/.exec(trimmed);

  if (!match) {
    throw new Error(`Unsupported ${sourceLabel} key: ${rawKey}`);
  }

  const root = match[1];
  const minorSuffix = match[2];

  if (!root) {
    throw new Error(`Unsupported ${sourceLabel} key: ${rawKey}`);
  }

  return {
    mode: minorSuffix === "m" ? "natural-minor" : "major",
    rawKey: trimmed,
    tonic: normalizePitchClass(root, sourceLabel),
  };
}

export function normalizeConfusableKeyText(value: string): string {
  return value.trim().replaceAll("С", "C").replaceAll("с", "c");
}

function normalizePitchClass(root: string, sourceLabel: string): PitchClass {
  const flat = flatToSharp.get(root);

  if (flat) {
    return flat;
  }

  const alias = sharpAliases.get(root);

  if (alias) {
    return alias;
  }

  if (pitchClasses.has(root as PitchClass)) {
    return root as PitchClass;
  }

  throw new Error(`Unsupported ${sourceLabel} key root: ${root}`);
}
