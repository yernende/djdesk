import type { Track } from "@djdesk/domain";

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

export interface RetrievalCandidate {
  artists: string[];
  durationMs: number | null;
  id: string;
  lossless: boolean | null;
  matchPercent: number | null;
  source: "spotify" | "yandex";
  title: string;
  url: string;
}

export interface RetrieverCandidate extends RetrievalCandidate {
  raw: unknown;
}

export interface RetrieverSearchResult {
  candidates: RetrieverCandidate[];
  reason: string | null;
  trackContext: unknown;
}

export interface RetrieverDownloadResult {
  files: string[];
  ok: boolean;
  reason: string | null;
}

export interface RetrieverLucidaResult {
  url: string;
}

export interface TrackRetriever {
  downloadSpotifyCandidate(
    candidate: RetrieverCandidate,
    options: {
      onMessage: (message: string) => void;
      signal: AbortSignal;
      trackContext: unknown;
    },
  ): Promise<RetrieverDownloadResult>;
  downloadYandexCandidate(
    candidate: RetrieverCandidate,
    options: {
      onMessage: (message: string) => void;
      signal: AbortSignal;
      trackContext: unknown;
    },
  ): Promise<RetrieverDownloadResult>;
  getLucidaFallback(
    input: string,
    options: { trackContext: unknown },
  ): Promise<RetrieverLucidaResult>;
  searchSpotifyCandidates(
    input: string,
    options: { trackContext: unknown },
  ): Promise<RetrieverSearchResult>;
  searchYandexCandidates(input: string): Promise<RetrieverSearchResult>;
}

export interface RetrievalJobView {
  error: string | null;
  id: string;
  input: string;
  linkedTrack: Track | null;
  lucidaUrl: string | null;
  messages: string[];
  spotifyCandidates: RetrievalCandidate[];
  stage: RetrievalStage;
  trackId: string;
  yandexCandidates: RetrievalCandidate[];
}
