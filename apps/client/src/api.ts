import type {
  CircleBucket,
  ModalPlacement,
  Track,
  TrackAnalysisConfidence,
  TrackKey,
} from "@djdesk/domain";

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

export interface SetDraftView {
  comment: string | null;
  id: string;
  name: string;
  trackIds: string[];
}

export interface SetDraftListResponse {
  sets: SetDraftView[];
}

export interface TrackHarmonyResponse {
  chordSegments: TrackChordSegmentView[];
  trackId: string;
  usedChords: string[];
}

export interface AudioLibraryResponse {
  audioUploadDir: string;
}

export type RetrievalStage =
  | "cancelled"
  | "downloading-spotify"
  | "downloading-yandex"
  | "failed"
  | "linked"
  | "lucida"
  | "searching-spotify"
  | "searching-yandex"
  | "spotify-candidates"
  | "yandex-candidates";

export interface RetrievalCandidateView {
  artists: string[];
  durationMs: number | null;
  id: string;
  lossless: boolean | null;
  matchPercent: number | null;
  source: "spotify" | "yandex";
  title: string;
  url: string;
}

export interface RetrievalJobView {
  error: string | null;
  id: string;
  input: string;
  linkedTrack: TrackView | null;
  lucidaUrl: string | null;
  messages: string[];
  spotifyCandidates: RetrievalCandidateView[];
  stage: RetrievalStage;
  trackId: string;
  yandexCandidates: RetrievalCandidateView[];
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

export interface CreateTrackInput {
  artist?: string | null;
  bpm?: number | null;
  chords?: string[];
  comment?: string | null;
  harmonyNotes?: string | null;
  key?: TrackKey | null;
  tags?: string[];
  title: string;
}

export interface TrackAnalysisPatchInput {
  bpm?: number | null;
  chords?: string[];
  comment?: string | null;
  confidence?: Partial<Pick<TrackAnalysisConfidence, "bpm" | "key">>;
  harmonyNotes?: string | null;
  key?: TrackKey | null;
  tags?: string[];
}

export async function fetchTracks(): Promise<TrackListResponse> {
  const response = await fetch("/api/tracks");

  return parseJsonResponse<TrackListResponse>(response);
}

export async function fetchAudioLibrary(): Promise<AudioLibraryResponse> {
  const response = await fetch("/api/audio-library");

  return parseJsonResponse<AudioLibraryResponse>(response);
}

export async function fetchSets(): Promise<SetDraftListResponse> {
  const response = await fetch("/api/sets");

  return parseJsonResponse<SetDraftListResponse>(response);
}

export async function createSet(name: string): Promise<SetDraftView> {
  const response = await fetch("/api/sets", {
    body: JSON.stringify({ name }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  return parseJsonResponse<SetDraftView>(response);
}

export async function renameSet(setId: string, name: string): Promise<SetDraftView> {
  const response = await fetch(`/api/sets/${encodeURIComponent(setId)}`, {
    body: JSON.stringify({ name }),
    headers: {
      "content-type": "application/json",
    },
    method: "PATCH",
  });

  return parseJsonResponse<SetDraftView>(response);
}

export async function replaceSetTracks(
  setId: string,
  trackIds: readonly string[],
): Promise<SetDraftView> {
  const response = await fetch(`/api/sets/${encodeURIComponent(setId)}/tracks`, {
    body: JSON.stringify({ trackIds }),
    headers: {
      "content-type": "application/json",
    },
    method: "PUT",
  });

  return parseJsonResponse<SetDraftView>(response);
}

export async function deleteSet(setId: string): Promise<void> {
  const response = await fetch(`/api/sets/${encodeURIComponent(setId)}`, {
    method: "DELETE",
  });

  await parseJsonResponse(response);
}

export async function createTrack(input: CreateTrackInput): Promise<TrackView> {
  const response = await fetch("/api/tracks", {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  return parseJsonResponse<TrackView>(response);
}

export async function updateTrackAnalysis(
  trackId: string,
  input: TrackAnalysisPatchInput,
): Promise<TrackView> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/analysis`, {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
    },
    method: "PATCH",
  });

  return parseJsonResponse<TrackView>(response);
}

export async function uploadTrackAudio(trackId: string, audio: File): Promise<TrackView> {
  const body = new FormData();

  body.append("audio", audio);

  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/audio`, {
    body,
    method: "POST",
  });

  return parseJsonResponse<TrackView>(response);
}

export async function fetchTrackHarmony(trackId: string): Promise<TrackHarmonyResponse> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/harmony`);

  return parseJsonResponse<TrackHarmonyResponse>(response);
}

export async function startTrackRetrieval(
  trackId: string,
  input?: string | null,
): Promise<RetrievalJobView> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/retrievals`, {
    body: JSON.stringify({ input }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  return parseJsonResponse<RetrievalJobView>(response);
}

export async function fetchRetrievalJob(jobId: string): Promise<RetrievalJobView> {
  const response = await fetch(`/api/retrievals/${encodeURIComponent(jobId)}`);

  return parseJsonResponse<RetrievalJobView>(response);
}

export async function selectYandexRetrievalCandidate(
  jobId: string,
  candidateId: string | null,
): Promise<RetrievalJobView> {
  const response = await fetch(`/api/retrievals/${encodeURIComponent(jobId)}/yandex/select`, {
    body: JSON.stringify(candidateId ? { candidateId } : { skip: true }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  return parseJsonResponse<RetrievalJobView>(response);
}

export async function selectSpotifyRetrievalCandidate(
  jobId: string,
  candidateId: string | null,
): Promise<RetrievalJobView> {
  const response = await fetch(`/api/retrievals/${encodeURIComponent(jobId)}/spotify/select`, {
    body: JSON.stringify(candidateId ? { candidateId } : { skip: true }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  return parseJsonResponse<RetrievalJobView>(response);
}

export async function retryRetrievalJob(jobId: string): Promise<RetrievalJobView> {
  const response = await fetch(`/api/retrievals/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  });

  return parseJsonResponse<RetrievalJobView>(response);
}

export async function cancelRetrievalJob(jobId: string): Promise<RetrievalJobView> {
  const response = await fetch(`/api/retrievals/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });

  return parseJsonResponse<RetrievalJobView>(response);
}

export async function fetchCircle(): Promise<CircleResponse> {
  const response = await fetch("/api/circle");

  return parseJsonResponse<CircleResponse>(response);
}

async function parseJsonResponse<Response>(response: globalThis.Response): Promise<Response> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;

    throw new Error(error?.message ?? `API request failed: ${response.status}`);
  }

  return response.json() as Promise<Response>;
}
