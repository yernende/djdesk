import type { CircleBucket, ModalPlacement, Track } from "@djdesk/domain";

export interface TrackView extends Track {
  keyLabel: string;
  placement: ModalPlacement;
}

export interface CircleBucketView extends Omit<CircleBucket, "tracks"> {
  tracks: TrackView[];
}

export interface CircleResponse {
  buckets: CircleBucketView[];
}

export interface TrackListResponse {
  tracks: TrackView[];
}

export async function fetchTracks(): Promise<TrackListResponse> {
  const response = await fetch("/api/tracks");

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<TrackListResponse>;
}

export async function fetchCircle(): Promise<CircleResponse> {
  const response = await fetch("/api/circle");

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<CircleResponse>;
}
