import { pathToFileURL } from "node:url";
import { join } from "node:path";

import type {
  RetrieverCandidate,
  RetrieverDownloadResult,
  RetrieverSearchResult,
  TrackRetriever,
} from "./types.ts";

interface DjConfig {
  outputDir: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyMarket: string;
  spotiflacBin: string;
  yandexToken: string;
}

interface DjConfigModule {
  loadConfig(options?: { outOverride?: string }): DjConfig;
}

interface DjApiCandidate {
  artists?: unknown;
  durationMs?: unknown;
  id?: unknown;
  lossless?: unknown;
  match?: {
    confidence?: unknown;
  } | null;
  source?: unknown;
  title?: unknown;
  url?: unknown;
}

interface DjApiSearchResult {
  candidates?: unknown;
  reason?: unknown;
  track?: unknown;
}

interface DjApiDownloadResult {
  files?: unknown;
  ok?: unknown;
  reason?: unknown;
}

interface DjSingleTrackApi {
  downloadSpotifyCandidate(
    candidate: unknown,
    options: {
      config: DjConfig;
      onMessage?: (message: string) => void;
      signal?: AbortSignal;
      track?: unknown;
    },
  ): Promise<DjApiDownloadResult>;
  downloadYandexCandidate(
    candidate: unknown,
    options: { config: DjConfig; signal?: AbortSignal; track?: unknown },
  ): Promise<DjApiDownloadResult>;
  getLucidaFallback(
    input: string,
    options: { config: DjConfig; track?: unknown },
  ): Promise<{ url?: unknown }>;
  searchSpotifyCandidates(
    input: string,
    options: { config: DjConfig; track?: unknown },
  ): Promise<DjApiSearchResult>;
  searchYandexCandidates(input: string, options: { config: DjConfig }): Promise<DjApiSearchResult>;
}

export interface DjToolRetrieverOptions {
  audioUploadDir: string;
  djToolRoot: string;
}

export function createDjToolRetriever(options: DjToolRetrieverOptions): TrackRetriever {
  let apiModulePromise: Promise<DjSingleTrackApi> | null = null;
  let configModulePromise: Promise<DjConfigModule> | null = null;

  async function loadApi(): Promise<DjSingleTrackApi> {
    apiModulePromise ??= importModule<DjSingleTrackApi>(
      join(options.djToolRoot, "src/api/single-track.js"),
    );

    return apiModulePromise;
  }

  async function loadConfig(): Promise<DjConfig> {
    configModulePromise ??= importModule<DjConfigModule>(join(options.djToolRoot, "src/config.js"));

    const module = await configModulePromise;

    return module.loadConfig({
      outOverride: options.audioUploadDir,
    });
  }

  return {
    async downloadSpotifyCandidate(candidate, requestOptions) {
      const [api, config] = await Promise.all([loadApi(), loadConfig()]);
      const result = await api.downloadSpotifyCandidate(candidate.raw, {
        config,
        onMessage: requestOptions.onMessage,
        signal: requestOptions.signal,
        track: requestOptions.trackContext,
      });

      return normalizeDownloadResult(result);
    },
    async downloadYandexCandidate(candidate, requestOptions) {
      const [api, config] = await Promise.all([loadApi(), loadConfig()]);
      const result = await api.downloadYandexCandidate(candidate.raw, {
        config,
        signal: requestOptions.signal,
        track: requestOptions.trackContext,
      });

      return normalizeDownloadResult(result);
    },
    async getLucidaFallback(input, requestOptions) {
      const [api, config] = await Promise.all([loadApi(), loadConfig()]);
      const result = await api.getLucidaFallback(input, {
        config,
        track: requestOptions.trackContext,
      });
      const url = typeof result.url === "string" ? result.url : "";

      if (!url) {
        throw new Error("DJ tool returned an empty Lucida URL");
      }

      return {
        url,
      };
    },
    async searchSpotifyCandidates(input, requestOptions) {
      const [api, config] = await Promise.all([loadApi(), loadConfig()]);
      const result = await api.searchSpotifyCandidates(input, {
        config,
        track: requestOptions.trackContext,
      });

      return normalizeSearchResult(result, "spotify");
    },
    async searchYandexCandidates(input) {
      const [api, config] = await Promise.all([loadApi(), loadConfig()]);
      const result = await api.searchYandexCandidates(input, {
        config,
      });

      return normalizeSearchResult(result, "yandex");
    },
  };
}

async function importModule<Module>(path: string): Promise<Module> {
  return import(pathToFileURL(path).href) as Promise<Module>;
}

function normalizeSearchResult(
  result: DjApiSearchResult,
  fallbackSource: "spotify" | "yandex",
): RetrieverSearchResult {
  const rawCandidates = Array.isArray(result.candidates) ? result.candidates : [];

  return {
    candidates: rawCandidates.map((candidate, index) =>
      normalizeCandidate(candidate, fallbackSource, index),
    ),
    reason: typeof result.reason === "string" ? result.reason : null,
    trackContext: result.track ?? null,
  };
}

function normalizeCandidate(
  candidate: unknown,
  fallbackSource: "spotify" | "yandex",
  index: number,
): RetrieverCandidate {
  const record = isRecord(candidate) ? (candidate as DjApiCandidate) : {};
  const source =
    record.source === "spotify" || record.source === "yandex" ? record.source : fallbackSource;
  const matchConfidence =
    isRecord(record.match) && typeof record.match.confidence === "number"
      ? record.match.confidence
      : null;

  return {
    artists: Array.isArray(record.artists)
      ? record.artists.filter((artist): artist is string => typeof artist === "string")
      : [],
    durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
    id: typeof record.id === "string" ? record.id : `${source}-${String(index)}`,
    lossless: typeof record.lossless === "boolean" ? record.lossless : null,
    matchPercent: matchConfidence === null ? null : Math.round(matchConfidence * 100),
    raw: candidate,
    source,
    title: typeof record.title === "string" ? record.title : "Untitled track",
    url: typeof record.url === "string" ? record.url : "",
  };
}

function normalizeDownloadResult(result: DjApiDownloadResult): RetrieverDownloadResult {
  return {
    files: Array.isArray(result.files)
      ? result.files.filter((file): file is string => typeof file === "string")
      : [],
    ok: result.ok === true,
    reason: typeof result.reason === "string" ? result.reason : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
