import { sampleTracks, type Track } from "@djdesk/domain";

export interface TrackRepository {
  listTracks(): Promise<readonly Track[]>;
}

export function createInMemoryTrackRepository(
  seed: readonly Track[] = sampleTracks,
): TrackRepository {
  const tracks = [...seed];

  return {
    async listTracks() {
      return tracks;
    },
  };
}
