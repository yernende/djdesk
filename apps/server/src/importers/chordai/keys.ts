import type { PitchClass } from "@djdesk/domain";

import type { ChordAiKey } from "./types.ts";

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

export function parseChordAiKey(rawKey: string): ChordAiKey {
  const trimmed = rawKey.trim();
  const match = /^([A-G](?:#|b)?)(m?)$/.exec(trimmed);

  if (!match) {
    throw new Error(`Unsupported ChordAI key: ${rawKey}`);
  }

  const root = match[1];
  const minorSuffix = match[2];

  if (!root) {
    throw new Error(`Unsupported ChordAI key: ${rawKey}`);
  }

  return {
    mode: minorSuffix === "m" ? "natural-minor" : "major",
    rawKey: trimmed,
    tonic: normalizePitchClass(root),
  };
}

function normalizePitchClass(root: string): PitchClass {
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

  throw new Error(`Unsupported ChordAI key root: ${root}`);
}
