export const DEFAULT_TARGET_BPM = 80;

export interface BpmSortableTrack {
  bpm: number | null;
  title: string;
}

export function compareBpmDescending(first: BpmSortableTrack, second: BpmSortableTrack): number {
  if (first.bpm === null && second.bpm !== null) {
    return 1;
  }

  if (first.bpm !== null && second.bpm === null) {
    return -1;
  }

  if (first.bpm !== null && second.bpm !== null) {
    const bpmComparison = second.bpm - first.bpm;

    if (bpmComparison !== 0) {
      return bpmComparison;
    }
  }

  return first.title.localeCompare(second.title);
}

export function findClosestBpmTrack<T extends BpmSortableTrack>(
  targetBpm: number,
  tracks: readonly T[],
): T | null {
  let closestTrack: T | null = null;

  for (const track of tracks) {
    if (track.bpm === null) {
      continue;
    }

    if (!closestTrack || closestTrack.bpm === null) {
      closestTrack = track;
      continue;
    }

    const currentDistance = Math.abs(track.bpm - targetBpm);
    const closestDistance = Math.abs(closestTrack.bpm - targetBpm);

    if (
      currentDistance < closestDistance ||
      (currentDistance === closestDistance && track.bpm > closestTrack.bpm)
    ) {
      closestTrack = track;
    }
  }

  return closestTrack;
}
