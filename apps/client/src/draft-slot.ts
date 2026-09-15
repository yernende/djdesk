export type DraftSlotMode = "append" | "replace";

export type DraftTransitionRisk = "none" | "previous" | "next" | "both";

export interface DraftTransitionContext<T> {
  mode: DraftSlotMode;
  nextTrack: T | null;
  previousTrack: T | null;
  referenceTrack: T | null;
  selectedIndex: number | null;
}

export interface DraftCandidateCompatibility {
  isRisky: boolean;
  nextOk: boolean;
  previousOk: boolean;
  risk: DraftTransitionRisk;
}

export function getDraftTransitionContext<T>(
  draftTracks: readonly T[],
  selectedIndex: number | null,
): DraftTransitionContext<T> {
  if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < draftTracks.length) {
    const previousTrack = selectedIndex > 0 ? (draftTracks[selectedIndex - 1] ?? null) : null;
    const nextTrack =
      selectedIndex < draftTracks.length - 1 ? (draftTracks[selectedIndex + 1] ?? null) : null;

    return {
      mode: "replace",
      nextTrack,
      previousTrack,
      referenceTrack: previousTrack,
      selectedIndex,
    };
  }

  const previousTrack = draftTracks.at(-1) ?? null;

  return {
    mode: "append",
    nextTrack: null,
    previousTrack,
    referenceTrack: previousTrack,
    selectedIndex: null,
  };
}

export function getDraftCandidateCompatibility<T>(
  context: DraftTransitionContext<T>,
  candidate: T,
  canFollow: (previousTrack: T, nextTrack: T) => boolean,
): DraftCandidateCompatibility {
  const previousOk = context.previousTrack ? canFollow(context.previousTrack, candidate) : true;
  const nextOk = context.nextTrack ? canFollow(candidate, context.nextTrack) : true;

  return {
    isRisky: !previousOk || !nextOk,
    nextOk,
    previousOk,
    risk: getDraftTransitionRisk(previousOk, nextOk),
  };
}

export function formatDraftCompatibilityReason<T>(
  context: DraftTransitionContext<T>,
  compatibility: DraftCandidateCompatibility | null,
): string {
  if (!compatibility?.isRisky) {
    return "";
  }

  if (context.mode === "append") {
    return "Non-harmonic";
  }

  switch (compatibility.risk) {
    case "previous":
      return "Breaks previous link";
    case "next":
      return "Breaks next link";
    case "both":
      return "Breaks both links";
    case "none":
      return "";
  }
}

function getDraftTransitionRisk(previousOk: boolean, nextOk: boolean): DraftTransitionRisk {
  if (!previousOk && !nextOk) {
    return "both";
  }

  if (!previousOk) {
    return "previous";
  }

  if (!nextOk) {
    return "next";
  }

  return "none";
}
