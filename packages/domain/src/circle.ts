import {
  type CircleBucket,
  type DiatonicMode,
  type ModalPlacement,
  type ModalTransitionMode,
  type ModalVariant,
  type PitchClass,
  type PitchClassLabel,
  type Track,
  type TrackKey,
  type TransitionDirection,
  type TransitionProfile,
} from "./types.ts";

export const CIRCLE_OF_FIFTHS = [
  "A",
  "E",
  "B",
  "F#",
  "C#",
  "G#",
  "D#",
  "A#",
  "F",
  "C",
  "G",
  "D",
] as const satisfies readonly PitchClass[];

type LetterName = "A" | "B" | "C" | "D" | "E" | "F" | "G";

interface PitchSpelling {
  accidental: -1 | 0 | 1;
  label: string;
  letter: LetterName;
}

const LETTER_ORDER = ["C", "D", "E", "F", "G", "A", "B"] as const satisfies readonly LetterName[];

const NATURAL_PITCH_VALUES: Record<LetterName, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const MODE_INTERVALS: Record<DiatonicMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  "natural-minor": [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const SOLMIZATION_PITCH_SPELLINGS: Record<PitchClass, readonly PitchSpelling[]> = {
  C: [{ accidental: 0, label: "Do", letter: "C" }],
  G: [{ accidental: 0, label: "Sol", letter: "G" }],
  D: [{ accidental: 0, label: "Re", letter: "D" }],
  A: [{ accidental: 0, label: "La", letter: "A" }],
  E: [{ accidental: 0, label: "Mi", letter: "E" }],
  B: [{ accidental: 0, label: "Si", letter: "B" }],
  "F#": [
    { accidental: 1, label: "Fa♯", letter: "F" },
    { accidental: -1, label: "Sol♭", letter: "G" },
  ],
  "C#": [
    { accidental: 1, label: "Do♯", letter: "C" },
    { accidental: -1, label: "Re♭", letter: "D" },
  ],
  "G#": [
    { accidental: 1, label: "Sol♯", letter: "G" },
    { accidental: -1, label: "La♭", letter: "A" },
  ],
  "D#": [
    { accidental: 1, label: "Re♯", letter: "D" },
    { accidental: -1, label: "Mi♭", letter: "E" },
  ],
  "A#": [
    { accidental: 1, label: "La♯", letter: "A" },
    { accidental: -1, label: "Si♭", letter: "B" },
  ],
  F: [{ accidental: 0, label: "Fa", letter: "F" }],
};

const CANONICAL_TIE_ACCIDENTAL_BY_PITCH: Partial<Record<PitchClass, -1 | 1>> = {
  "C#": 1,
  "F#": 1,
  "G#": 1,
  "D#": -1,
  "A#": -1,
};

export const PITCH_CLASS_LABELS: Record<PitchClass, PitchClassLabel> = CIRCLE_OF_FIFTHS.reduce(
  (labels, pitch) => {
    const solmization = getCanonicalMinorSectionSpelling(pitch);
    const enharmonic = getAlternatePitchSpelling(pitch, solmization);

    labels[pitch] = {
      pitch,
      primary: `${solmization.label} m`,
      ...(enharmonic ? { enharmonic: `${enharmonic} m` } : {}),
    };

    return labels;
  },
  {} as Record<PitchClass, PitchClassLabel>,
);

const PURE_MODAL_DISPLAY_OFFSET = 0.37;

const RELATIVE_MINOR_BY_MAJOR: Record<PitchClass, PitchClass> = {
  C: "A",
  G: "E",
  D: "B",
  A: "F#",
  E: "C#",
  B: "G#",
  "F#": "D#",
  "C#": "A#",
  "G#": "F",
  "D#": "C",
  "A#": "G",
  F: "D",
};

export function getCircleIndex(tonic: PitchClass): number {
  return CIRCLE_OF_FIFTHS.indexOf(tonic);
}

export function getModeLabel(mode: DiatonicMode): string {
  switch (mode) {
    case "major":
      return "Major";
    case "natural-minor":
      return "Natural minor";
    case "dorian":
      return "Dorian";
    case "phrygian":
      return "Phrygian";
    case "lydian":
      return "Lydian";
    case "mixolydian":
      return "Mixolydian";
    default:
      return assertNever(mode);
  }
}

export function getPitchClassLabel(pitch: PitchClass): string {
  const label = getCanonicalMinorSectionSpelling(pitch);
  const enharmonic = getAlternatePitchSpelling(pitch, label);

  return enharmonic ? `${label.label} / ${enharmonic}` : label.label;
}

export function getKeyTonicLabel(key: TrackKey): string {
  const spelling = getCanonicalKeySpelling(key);
  const enharmonic = getAlternatePitchSpelling(key.tonic, spelling);

  return enharmonic ? `${spelling.label} / ${enharmonic}` : spelling.label;
}

export function describeKey(key: TrackKey | null): string {
  if (!key) {
    return "Unknown key";
  }

  const variant = key.variant === "diatonic" ? "" : `, ${getVariantLabel(key.variant)}`;

  return `${getKeyTonicLabel(key)} ${getModeLabel(key.mode)}${variant}`;
}

export function getVariantLabel(variant: ModalVariant): string {
  switch (variant) {
    case "diatonic":
      return "Diatonic";
    case "raised-leading-tone":
      return "Raised leading tone";
    case "variable-degree":
      return "Variable degree";
    default:
      return assertNever(variant);
  }
}

export function getModalPlacement(key: TrackKey): ModalPlacement {
  const homeIndex = getHomeSectionIndex(key);
  const collectionIndex = getModalCollectionIndex(key, homeIndex);

  if (collectionIndex === homeIndex) {
    return {
      homeIndex,
      targetIndex: homeIndex,
      displayIndex: homeIndex,
      lane: "home",
      summary:
        key.variant === "raised-leading-tone" ? "Home key with raised leading tone" : "Home key",
    };
  }

  if (key.variant === "diatonic") {
    const displayOffset = getPureModalDisplayOffset(homeIndex, collectionIndex);

    return {
      homeIndex,
      targetIndex: collectionIndex,
      displayIndex: wrapIndex(collectionIndex + displayOffset),
      lane: "pure-modal",
      summary: `Pure ${getModeLabel(key.mode)} in modal collection section`,
    };
  }

  return {
    homeIndex,
    targetIndex: collectionIndex,
    displayIndex: getMidpointIndex(homeIndex, collectionIndex),
    lane: "modal-mixture",
    summary: `${getModeLabel(key.mode)} with modal mixture`,
  };
}

export function getTransitionProfile(key: TrackKey | null): TransitionProfile | null {
  if (!key) {
    return null;
  }

  const placement = getModalPlacement(key);

  if (placement.lane === "home") {
    return {
      kind: "home",
      section: placement.homeIndex,
    };
  }

  const mode = getModalTransitionMode(key.mode);
  const targetSection = getModalCollectionIndex(key, placement.homeIndex);

  if (placement.lane === "pure-modal") {
    return {
      direction: getModalDirection(mode),
      homeSection: placement.homeIndex,
      kind: "pure-modal",
      mode,
      targetSection,
    };
  }

  return {
    boundarySections: uniqueIndexes([placement.homeIndex, placement.targetIndex]) as [
      number,
      number,
    ],
    direction: getModalDirection(mode),
    homeSection: placement.homeIndex,
    kind: "modal-mixture",
    mode,
    targetSection: placement.targetIndex,
  };
}

export function canKeysTransition(previousKey: TrackKey | null, nextKey: TrackKey | null): boolean {
  const previousProfile = getTransitionProfile(previousKey);
  const nextProfile = getTransitionProfile(nextKey);

  if (!previousProfile || !nextProfile) {
    return false;
  }

  return canTransitionProfiles(previousProfile, nextProfile);
}

export function areKeysTransitionCompatible(
  firstKey: TrackKey | null,
  secondKey: TrackKey | null,
): boolean {
  return canKeysTransition(firstKey, secondKey) || canKeysTransition(secondKey, firstKey);
}

export function canTransitionProfiles(
  previous: TransitionProfile,
  next: TransitionProfile,
): boolean {
  if (previous.kind === "home" && next.kind === "home") {
    return circularIndexDistance(previous.section, next.section) <= 1;
  }

  if (previous.kind === "home" && next.kind === "pure-modal") {
    return previous.section === next.homeSection || previous.section === next.targetSection;
  }

  if (previous.kind === "pure-modal" && next.kind === "home") {
    return next.section === previous.homeSection || next.section === previous.targetSection;
  }

  if (previous.kind === "pure-modal" && next.kind === "pure-modal") {
    return (
      previous.mode === next.mode &&
      circularIndexDistance(previous.homeSection, next.homeSection) <= 1
    );
  }

  if (previous.kind === "home" && next.kind === "modal-mixture") {
    return next.boundarySections.includes(previous.section);
  }

  if (previous.kind === "modal-mixture" && next.kind === "home") {
    return previous.boundarySections.includes(next.section);
  }

  if (previous.kind === "modal-mixture" && next.kind === "modal-mixture") {
    return hasSameBoundary(previous.boundarySections, next.boundarySections);
  }

  if (previous.kind === "modal-mixture" && next.kind === "pure-modal") {
    return previous.homeSection === next.homeSection && previous.mode === next.mode;
  }

  return false;
}

export function createEmptyCircleBuckets(): CircleBucket[] {
  return CIRCLE_OF_FIFTHS.map((tonic, index) => ({
    index,
    label: PITCH_CLASS_LABELS[tonic],
    tonic,
    tracks: [],
  }));
}

export function bucketTracksByTonic(tracks: readonly Track[]): CircleBucket[] {
  const buckets = createEmptyCircleBuckets();

  for (const track of tracks) {
    if (!track.key) {
      continue;
    }

    const placement = getModalPlacement(track.key);
    const bucket =
      buckets[placement.lane === "pure-modal" ? placement.targetIndex : placement.homeIndex];

    if (bucket) {
      bucket.tracks.push(track);
    }
  }

  return buckets;
}

function getHomeSectionIndex(key: TrackKey): number {
  switch (key.mode) {
    case "major":
    case "lydian":
    case "mixolydian":
      return getCircleIndex(RELATIVE_MINOR_BY_MAJOR[key.tonic]);
    case "natural-minor":
    case "dorian":
    case "phrygian":
      return getCircleIndex(key.tonic);
    default:
      return assertNever(key.mode);
  }
}

function getModalCollectionIndex(key: TrackKey, homeIndex: number): number {
  switch (key.mode) {
    case "major":
    case "natural-minor":
      return homeIndex;
    case "dorian":
    case "lydian":
      return wrapIndex(homeIndex + 1);
    case "phrygian":
    case "mixolydian":
      return wrapIndex(homeIndex - 1);
    default:
      return assertNever(key.mode);
  }
}

function getPureModalDisplayOffset(homeIndex: number, collectionIndex: number): number {
  return getSignedCircularOffset(collectionIndex, homeIndex) > 0
    ? PURE_MODAL_DISPLAY_OFFSET
    : -PURE_MODAL_DISPLAY_OFFSET;
}

function getCanonicalMinorSectionSpelling(pitch: PitchClass): PitchSpelling {
  return getPreferredSpelling(pitch, "natural-minor");
}

function getCanonicalKeySpelling(key: TrackKey): PitchSpelling {
  return getPreferredSpelling(key.tonic, key.mode);
}

function getPreferredSpelling(pitch: PitchClass, mode: DiatonicMode): PitchSpelling {
  const spellings = SOLMIZATION_PITCH_SPELLINGS[pitch];

  return [...spellings].sort((first, second) => {
    const firstCost = getModeSpellingCost(first, mode);
    const secondCost = getModeSpellingCost(second, mode);

    if (firstCost !== secondCost) {
      return firstCost - secondCost;
    }

    return getTieBreakScore(pitch, first) - getTieBreakScore(pitch, second);
  })[0] as PitchSpelling;
}

function getAlternatePitchSpelling(
  pitch: PitchClass,
  primary: Pick<PitchSpelling, "label">,
): string | null {
  return (
    SOLMIZATION_PITCH_SPELLINGS[pitch].find((spelling) => spelling.label !== primary.label)
      ?.label ?? null
  );
}

function getModeSpellingCost(tonic: PitchSpelling, mode: DiatonicMode): number {
  const tonicLetterIndex = LETTER_ORDER.indexOf(tonic.letter);
  const tonicPitchValue = getPitchSpellingValue(tonic);
  const intervals = MODE_INTERVALS[mode];

  return intervals.reduce((cost, interval, degreeIndex) => {
    const letter = LETTER_ORDER[(tonicLetterIndex + degreeIndex) % LETTER_ORDER.length];

    if (!letter) {
      return cost;
    }

    const scalePitchValue = wrapSemitone(tonicPitchValue + interval);
    const accidental = getRequiredAccidental(NATURAL_PITCH_VALUES[letter], scalePitchValue);
    const accidentalSize = Math.abs(accidental);

    return cost + accidentalSize + Math.max(0, accidentalSize - 1) * 4;
  }, 0);
}

function getTieBreakScore(pitch: PitchClass, spelling: PitchSpelling): number {
  const preferredAccidental = CANONICAL_TIE_ACCIDENTAL_BY_PITCH[pitch];

  return preferredAccidental === spelling.accidental ? -1 : 0;
}

function getPitchSpellingValue(spelling: PitchSpelling): number {
  return wrapSemitone(NATURAL_PITCH_VALUES[spelling.letter] + spelling.accidental);
}

function getRequiredAccidental(naturalPitchValue: number, targetPitchValue: number): number {
  let accidental = targetPitchValue - naturalPitchValue;

  if (accidental > 6) {
    accidental -= 12;
  } else if (accidental < -6) {
    accidental += 12;
  }

  return accidental;
}

function getModalTransitionMode(mode: DiatonicMode): ModalTransitionMode {
  switch (mode) {
    case "dorian":
    case "phrygian":
    case "lydian":
    case "mixolydian":
      return mode;
    case "major":
    case "natural-minor":
      throw new Error(`${getModeLabel(mode)} is not a modal transition mode`);
    default:
      return assertNever(mode);
  }
}

function getModalDirection(mode: ModalTransitionMode): TransitionDirection {
  switch (mode) {
    case "dorian":
    case "lydian":
      return "clockwise";
    case "phrygian":
    case "mixolydian":
      return "counter";
    default:
      return assertNever(mode);
  }
}

function getMidpointIndex(from: number, to: number): number {
  let delta = to - from;

  if (delta > 6) {
    delta -= 12;
  } else if (delta < -6) {
    delta += 12;
  }

  return wrapIndex(from + delta / 2);
}

function wrapIndex(index: number): number {
  return (index + 12) % 12;
}

function wrapSemitone(value: number): number {
  return (value + 12) % 12;
}

function circularIndexDistance(first: number, second: number): number {
  const direct = Math.abs(first - second);

  return Math.min(direct, 12 - direct);
}

function hasSameBoundary(first: readonly number[], second: readonly number[]): boolean {
  return first.length === second.length && first.every((section) => second.includes(section));
}

function uniqueIndexes(indexes: readonly number[]): number[] {
  return [...new Set(indexes.map((index) => wrapIndex(index)))];
}

function getSignedCircularOffset(from: number, to: number): number {
  let delta = to - from;

  if (delta > 6) {
    delta -= 12;
  } else if (delta < -6) {
    delta += 12;
  }

  return delta;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
