import type { CircleBucket, ModalPlacement, Track } from "@djdesk/domain";

export interface TrackView extends Track {
  audioAvailable: boolean;
  audioFileName: string | null;
  audioUrl: string | null;
  keyLabel: string;
  placement: ModalPlacement | null;
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

export interface TrackHarmonyResponse {
  chordSegments: TrackChordSegmentView[];
  trackId: string;
  usedChords: string[];
}

export interface TrackChordSegmentView {
  bass: string | null;
  basicLabel: string | null;
  chord: string;
  degree: string | null;
  durationS: number;
  endS: number;
  index: number;
  label: string;
  midiNotes: string | null;
  startS: number;
}

export async function fetchTracks(): Promise<TrackListResponse> {
  const response = await fetch("/api/tracks");

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<TrackListResponse>;
}

export async function fetchTrackHarmony(trackId: string): Promise<TrackHarmonyResponse> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/harmony`);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<TrackHarmonyResponse>;
}

export async function fetchCircle(): Promise<CircleResponse> {
  const response = await fetch("/api/circle");

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<CircleResponse>;
}
