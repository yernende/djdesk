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
  revision?: number;
}

export interface WorkspaceSession {
  workspaceId: string | null;
  csrfToken: string | null;
}

let publicMode = false;
let workspaceSession: WorkspaceSession = { workspaceId: null, csrfToken: null };
let newWorkspaceSecret: { workspaceId: string; secret: string } | null = null;

export async function fetchAppConfig(): Promise<{ mode: "local" | "public" }> {
  const config = await parseJsonResponse<{ mode: "local" | "public" }>(await fetch("/api/config"));
  publicMode = config.mode === "public";
  return config;
}

export async function fetchWorkspaceSession(): Promise<WorkspaceSession> {
  workspaceSession = await parseJsonResponse<WorkspaceSession>(await fetch("/api/session"));
  return workspaceSession;
}

export async function exchangeWorkspaceLink(
  workspaceId: string,
  secret: string,
): Promise<WorkspaceSession> {
  workspaceSession = await writeJson<WorkspaceSession>("/api/session/exchange", "POST", {
    workspaceId,
    secret,
  });
  return workspaceSession;
}

export async function rotateWorkspaceLink(): Promise<void> {
  const result = await writeJson<WorkspaceSession & { workspaceId: string; secret: string }>(
    "/api/workspace/rotate",
    "POST",
    {},
  );
  workspaceSession = { workspaceId: result.workspaceId, csrfToken: result.csrfToken };
  newWorkspaceSecret = { workspaceId: result.workspaceId, secret: result.secret };
}

export function takeNewWorkspaceSecret(): { workspaceId: string; secret: string } | null {
  const result = newWorkspaceSecret;
  newWorkspaceSecret = null;
  return result;
}

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  params: Record<string, string | number> | undefined;
  constructor(
    status: number,
    message: string,
    code?: string,
    params?: Record<string, string | number>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

async function writeJson<T>(url: string, method: string, body: unknown): Promise<T> {
  return parseJsonResponse<T>(
    await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...(workspaceSession.csrfToken ? { "x-csrf-token": workspaceSession.csrfToken } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
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
  nonStandardTuning?: boolean;
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
  nonStandardTuning?: boolean;
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

export async function createSet(
  name: string,
  trackIds: readonly string[] = [],
  id = crypto.randomUUID(),
): Promise<SetDraftView> {
  if (publicMode && !workspaceSession.workspaceId) {
    const result = await writeJson<
      WorkspaceSession & { workspaceId: string; secret: string; set: SetDraftView }
    >("/api/workspaces", "POST", { name, trackIds, id });
    workspaceSession = { workspaceId: result.workspaceId, csrfToken: result.csrfToken };
    newWorkspaceSecret = { workspaceId: result.workspaceId, secret: result.secret };
    return result.set;
  }
  const set = await writeJson<SetDraftView>("/api/sets", "POST", { name, trackIds, id });
  if (!publicMode && trackIds.length) return replaceSetTracks(set.id, trackIds);
  return set;
}

export async function renameSet(
  setId: string,
  name: string,
  revision?: number,
): Promise<SetDraftView> {
  return writeJson<SetDraftView>(`/api/sets/${encodeURIComponent(setId)}`, "PATCH", {
    name,
    revision,
  });
}

export async function replaceSetTracks(
  setId: string,
  trackIds: readonly string[],
  revision?: number,
): Promise<SetDraftView> {
  return writeJson<SetDraftView>(`/api/sets/${encodeURIComponent(setId)}/tracks`, "PUT", {
    trackIds,
    revision,
  });
}

export async function deleteSet(setId: string, revision?: number): Promise<void> {
  await writeJson(`/api/sets/${encodeURIComponent(setId)}`, "DELETE", { revision });
}

export async function saveSetSnapshot(set: SetDraftView, revision?: number): Promise<SetDraftView> {
  if (publicMode)
    return writeJson<SetDraftView>(`/api/sets/${encodeURIComponent(set.id)}`, "PATCH", {
      name: set.name,
      trackIds: set.trackIds,
      revision,
    });
  await renameSet(set.id, set.name);
  return replaceSetTracks(set.id, set.trackIds);
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
    const error = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
      params?: Record<string, string | number>;
    } | null;

    throw new ApiError(
      response.status,
      error?.message ?? `API request failed: ${response.status}`,
      error?.code,
      error?.params,
    );
  }

  return response.json() as Promise<Response>;
}
