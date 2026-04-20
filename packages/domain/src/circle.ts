import {
  PITCH_CLASSES,
  type CircleBucket,
  type DiatonicMode,
  type ModalPlacement,
  type ModalVariant,
  type PitchClass,
  type PitchClassLabel,
  type Track,
  type TrackKey,
} from "./types.ts";

export const CIRCLE_OF_FIFTHS = PITCH_CLASSES;

export const PITCH_CLASS_LABELS: Record<PitchClass, PitchClassLabel> = {
  C: { pitch: "C", primary: "Do" },
  G: { pitch: "G", primary: "Sol" },
  D: { pitch: "D", primary: "Re" },
  A: { pitch: "A", primary: "La" },
  E: { pitch: "E", primary: "Mi" },
  B: { pitch: "B", primary: "Si" },
  "F#": { pitch: "F#", primary: "Fa#", enharmonic: "Solb" },
  "C#": { pitch: "C#", primary: "Do#", enharmonic: "Reb" },
  "G#": { pitch: "G#", primary: "Sol#", enharmonic: "Lab" },
  "D#": { pitch: "D#", primary: "Re#", enharmonic: "Mib" },
  "A#": { pitch: "A#", primary: "La#", enharmonic: "Sib" },
  F: { pitch: "F", primary: "Fa" },
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

export function describeKey(key: TrackKey): string {
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
  const homeIndex = getCircleIndex(key.tonic);
  const targetIndex = getPureModalTargetIndex(key);

  if (targetIndex === homeIndex) {
    return {
      homeIndex,
      targetIndex,
      displayIndex: homeIndex,
      lane: key.variant === "raised-leading-tone" ? "modal-mixture" : "home",
      summary:
        key.variant === "raised-leading-tone" ? "Home key with raised leading tone" : "Home key",
    };
  }

  if (key.variant === "diatonic") {
    return {
      homeIndex,
      targetIndex,
      displayIndex: targetIndex,
      lane: "pure-modal",
      summary: `Pure ${getModeLabel(key.mode)} collection`,
    };
  }

  return {
    homeIndex,
    targetIndex,
    displayIndex: getMidpointIndex(homeIndex, targetIndex),
    lane: "modal-mixture",
    summary: `${getModeLabel(key.mode)} with modal mixture`,
  };
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
    const bucket = buckets[getCircleIndex(track.key.tonic)];

    if (bucket) {
      bucket.tracks.push(track);
    }
  }

  return buckets;
}

function getPureModalTargetIndex(key: TrackKey): number {
  const homeIndex = getCircleIndex(key.tonic);

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

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
