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

export const PITCH_CLASS_LABELS: Record<PitchClass, PitchClassLabel> = {
  C: { pitch: "C", primary: "Do m" },
  G: { pitch: "G", primary: "Sol m" },
  D: { pitch: "D", primary: "Re m" },
  A: { pitch: "A", primary: "La m" },
  E: { pitch: "E", primary: "Mi m" },
  B: { pitch: "B", primary: "Si m" },
  "F#": { pitch: "F#", primary: "Fa# m", enharmonic: "Solb m" },
  "C#": { pitch: "C#", primary: "Do# m", enharmonic: "Reb m" },
  "G#": { pitch: "G#", primary: "Sol# m", enharmonic: "Lab m" },
  "D#": { pitch: "D#", primary: "Re# m", enharmonic: "Mib m" },
  "A#": { pitch: "A#", primary: "La# m", enharmonic: "Sib m" },
  F: { pitch: "F", primary: "Fa m" },
};

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

export function describeKey(key: TrackKey | null): string {
  if (!key) {
    return "Unknown key";
  }

  const variant = key.variant === "diatonic" ? "" : `, ${getVariantLabel(key.variant)}`;

  return `${key.tonic} ${getModeLabel(key.mode)}${variant}`;
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
    return previous.section === next.targetSection;
  }

  if (previous.kind === "pure-modal" && next.kind === "home") {
    return next.section === previous.targetSection;
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
