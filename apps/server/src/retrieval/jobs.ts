import { randomUUID } from "node:crypto";

import type { Track } from "@djdesk/domain";

import type { TrackRepository } from "../repositories/tracks.ts";
import type {
  RetrievalCandidate,
  RetrievalJobView,
  RetrievalStage,
  RetrieverCandidate,
  TrackRetriever,
} from "./types.ts";

interface RetrievalJob {
  abortController: AbortController | null;
  error: string | null;
  id: string;
  input: string;
  linkedTrack: Track | null;
  lucidaUrl: string | null;
  messages: string[];
  spotifyCandidates: RetrieverCandidate[];
  stage: RetrievalStage;
  trackContext: unknown;
  trackId: string;
  yandexCandidates: RetrieverCandidate[];
}

export interface RetrievalManager {
  cancel(jobId: string): RetrievalJobView | null;
  get(jobId: string): RetrievalJobView | null;
  retry(jobId: string): Promise<RetrievalJobView | null>;
  selectSpotifyCandidate(
    jobId: string,
    candidateId: string | null,
  ): Promise<RetrievalJobView | null>;
  selectYandexCandidate(
    jobId: string,
    candidateId: string | null,
  ): Promise<RetrievalJobView | null>;
  startTrackRetrieval(track: Track, input: string | null): Promise<RetrievalJobView>;
}

export function createRetrievalManager(input: {
  retriever: TrackRetriever;
  tracks: TrackRepository;
}): RetrievalManager {
  const jobs = new Map<string, RetrievalJob>();

  async function prepareYandexStage(job: RetrievalJob): Promise<void> {
    job.stage = "searching-yandex";
    job.error = null;
    job.linkedTrack = null;
    job.lucidaUrl = null;
    job.spotifyCandidates = [];
    job.yandexCandidates = [];
    appendMessage(job, `Yandex: searching "${job.input}"`);

    try {
      const result = await input.retriever.searchYandexCandidates(job.input);

      job.trackContext = result.trackContext;
      job.yandexCandidates = result.candidates;

      if (result.reason) {
        job.messages.push(`Yandex: ${result.reason}`);
      }

      if (job.yandexCandidates.length > 0) {
        job.stage = "yandex-candidates";
        appendMessage(job, `Yandex: found ${job.yandexCandidates.length} candidate(s)`);
        return;
      }
    } catch (error) {
      job.messages.push(`Yandex: ${getErrorMessage(error)}`);
    }

    await prepareSpotifyStage(job);
  }

  async function prepareSpotifyStage(job: RetrievalJob): Promise<void> {
    job.stage = "searching-spotify";
    job.error = null;
    job.spotifyCandidates = [];
    appendMessage(job, `Spotify: searching "${job.input}"`);

    try {
      const result = await input.retriever.searchSpotifyCandidates(job.input, {
        trackContext: job.trackContext,
      });

      job.trackContext = result.trackContext;
      job.spotifyCandidates = result.candidates;

      if (result.reason) {
        job.messages.push(`Spotify: ${result.reason}`);
      }

      if (job.spotifyCandidates.length > 0) {
        job.stage = "spotify-candidates";
        appendMessage(job, `Spotify: found ${job.spotifyCandidates.length} candidate(s)`);
        return;
      }
    } catch (error) {
      job.messages.push(`Spotify: ${getErrorMessage(error)}`);
    }

    await prepareLucidaStage(job);
  }

  async function prepareLucidaStage(job: RetrievalJob): Promise<void> {
    try {
      const result = await input.retriever.getLucidaFallback(job.input, {
        trackContext: job.trackContext,
      });

      job.lucidaUrl = result.url;
      job.stage = "lucida";
      job.error = null;
      appendMessage(job, "Lucida: manual fallback is ready");
    } catch (error) {
      job.stage = "failed";
      job.error = `Lucida: ${getErrorMessage(error)}`;
    }
  }

  async function linkDownloadedFile(job: RetrievalJob, files: readonly string[]): Promise<boolean> {
    const audioPath = files[0];

    if (!audioPath) {
      job.error = "Download finished without a new audio file";
      return false;
    }

    const track = await input.tracks.updateTrackAudioPath(job.trackId, audioPath);

    if (!track) {
      job.error = "Track not found";
      return false;
    }

    job.linkedTrack = track;
    job.stage = "linked";
    job.error = null;
    appendMessage(job, `Linked audio: ${audioPath}`);

    return true;
  }

  async function runYandexDownload(
    job: RetrievalJob,
    candidate: RetrieverCandidate,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const result = await input.retriever.downloadYandexCandidate(candidate, {
        onMessage: (message) => appendSourceMessage(job, "Yandex", message),
        signal: abortController.signal,
        trackContext: job.trackContext,
      });

      if (!isJobStillRunning(job, abortController)) {
        return;
      }

      if (result.ok && (await linkDownloadedFile(job, result.files))) {
        return;
      }

      appendMessage(job, `Yandex: ${result.reason ?? "download failed"}`);
    } catch (error) {
      if (!isJobStillRunning(job, abortController)) {
        return;
      }

      appendMessage(job, `Yandex: ${getErrorMessage(error)}`);
    } finally {
      if (job.abortController === abortController) {
        job.abortController = null;
      }
    }

    if (job.stage !== "cancelled") {
      await prepareSpotifyStage(job);
    }
  }

  async function runSpotifyDownload(
    job: RetrievalJob,
    candidate: RetrieverCandidate,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const result = await input.retriever.downloadSpotifyCandidate(candidate, {
        onMessage: (message) => appendSourceMessage(job, "SpotiFLAC", message),
        signal: abortController.signal,
        trackContext: job.trackContext,
      });

      if (!isJobStillRunning(job, abortController)) {
        return;
      }

      if (result.ok && (await linkDownloadedFile(job, result.files))) {
        return;
      }

      appendMessage(job, `SpotiFLAC: ${result.reason ?? "download failed"}`);
    } catch (error) {
      if (!isJobStillRunning(job, abortController)) {
        return;
      }

      appendMessage(job, `SpotiFLAC: ${getErrorMessage(error)}`);
    } finally {
      if (job.abortController === abortController) {
        job.abortController = null;
      }
    }

    if (job.stage !== "cancelled") {
      await prepareLucidaStage(job);
    }
  }

  return {
    cancel(jobId) {
      const job = jobs.get(jobId);

      if (!job) {
        return null;
      }

      job.abortController?.abort();
      job.abortController = null;
      job.stage = "cancelled";
      job.error = "Retrieval cancelled";
      appendMessage(job, "Cancelled by user");

      return toView(job);
    },
    get(jobId) {
      const job = jobs.get(jobId);

      return job ? toView(job) : null;
    },
    async retry(jobId) {
      const job = jobs.get(jobId);

      if (!job) {
        return null;
      }

      job.abortController?.abort();
      job.abortController = null;
      job.error = null;
      job.linkedTrack = null;
      job.lucidaUrl = null;
      job.messages = [];
      job.spotifyCandidates = [];
      job.stage = "searching-yandex";
      job.trackContext = null;
      job.yandexCandidates = [];

      await prepareYandexStage(job);

      return toView(job);
    },
    async selectSpotifyCandidate(jobId, candidateId) {
      const job = jobs.get(jobId);

      if (!job) {
        return null;
      }

      if (!candidateId) {
        job.abortController?.abort();
        job.abortController = null;
        appendMessage(job, "SpotiFLAC: skipped");
        await prepareLucidaStage(job);

        return toView(job);
      }

      const candidate = job.spotifyCandidates.find((item) => item.id === candidateId);

      if (!candidate) {
        job.error = "Spotify candidate not found";
        return toView(job);
      }

      const abortController = new AbortController();

      job.abortController = abortController;
      job.stage = "downloading-spotify";
      job.error = null;
      appendMessage(job, `SpotiFLAC: downloading ${candidate.title}`);
      void runSpotifyDownload(job, candidate, abortController);

      return toView(job);
    },
    async selectYandexCandidate(jobId, candidateId) {
      const job = jobs.get(jobId);

      if (!job) {
        return null;
      }

      if (!candidateId) {
        job.abortController?.abort();
        job.abortController = null;
        appendMessage(job, "Yandex: skipped");
        await prepareSpotifyStage(job);

        return toView(job);
      }

      const candidate = job.yandexCandidates.find((item) => item.id === candidateId);

      if (!candidate) {
        job.error = "Yandex candidate not found";
        return toView(job);
      }

      const abortController = new AbortController();

      job.abortController = abortController;
      job.stage = "downloading-yandex";
      job.error = null;
      appendMessage(job, `Yandex: downloading ${candidate.title}`);
      void runYandexDownload(job, candidate, abortController);

      return toView(job);
    },
    async startTrackRetrieval(track, rawInput) {
      const job: RetrievalJob = {
        abortController: null,
        error: null,
        id: `ret-${randomUUID()}`,
        input: normalizeRetrievalInput(rawInput, track),
        linkedTrack: null,
        lucidaUrl: null,
        messages: [],
        spotifyCandidates: [],
        stage: "searching-yandex",
        trackContext: null,
        trackId: track.id,
        yandexCandidates: [],
      };

      jobs.set(job.id, job);
      await prepareYandexStage(job);

      return toView(job);
    },
  };
}

function normalizeRetrievalInput(input: string | null, track: Track): string {
  const trimmed = input?.trim();

  if (trimmed) {
    return trimmed;
  }

  return [track.artist, track.title].filter(Boolean).join(" ").trim() || track.title;
}

function toView(job: RetrievalJob): RetrievalJobView {
  return {
    error: job.error,
    id: job.id,
    input: job.input,
    linkedTrack: job.linkedTrack,
    lucidaUrl: job.lucidaUrl,
    messages: [...job.messages],
    spotifyCandidates: job.spotifyCandidates.map(toCandidateView),
    stage: job.stage,
    trackId: job.trackId,
    yandexCandidates: job.yandexCandidates.map(toCandidateView),
  };
}

function toCandidateView(candidate: RetrieverCandidate): RetrievalCandidate {
  return {
    artists: [...candidate.artists],
    durationMs: candidate.durationMs,
    id: candidate.id,
    lossless: candidate.lossless,
    matchPercent: candidate.matchPercent,
    source: candidate.source,
    title: candidate.title,
    url: candidate.url,
  };
}

function appendMessage(job: RetrievalJob, message: string): void {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (job.messages.at(-1) !== line) {
      job.messages.push(line);
    }
  }

  if (job.messages.length > 80) {
    job.messages.splice(0, job.messages.length - 80);
  }
}

function appendSourceMessage(job: RetrievalJob, source: string, message: string): void {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    appendMessage(job, hasExplicitRetrievalSource(line) ? line : `${source}: ${line}`);
  }
}

function hasExplicitRetrievalSource(message: string): boolean {
  return /^(Lucida|Songlink|Spotify|SpotiFLAC|Yandex):\s/i.test(message);
}

function isJobStillRunning(job: RetrievalJob, abortController: AbortController): boolean {
  return job.abortController === abortController && job.stage !== "cancelled";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
