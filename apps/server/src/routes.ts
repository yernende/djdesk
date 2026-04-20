import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { basename, extname, join, parse } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

import {
  bucketTracksByTonic,
  describeKey,
  getModalPlacement,
  type CircleBucket,
  type DiatonicMode,
  type ModalVariant,
  type ModalPlacement,
  type PitchClass,
  type Track,
  type TrackAnalysisConfidence,
  type TrackKey,
} from "@djdesk/domain";

import {
  TrackRepositoryValidationError,
  type CreateTrackInput,
  type SetDraft,
  type TrackAnalysisUpdateInput,
  type TrackRepository,
} from "./repositories/tracks.ts";
import type { RetrievalJobView } from "./retrieval/types.ts";
import type { RetrievalManager } from "./retrieval/jobs.ts";

export interface HealthResponse {
  ok: true;
  service: "djdesk-api";
}

export interface TrackListResponse {
  tracks: TrackView[];
}

export interface SetDraftListResponse {
  sets: SetDraft[];
}

export interface TrackHarmonyResponse {
  chordSegments: TrackChordSegmentView[];
  trackId: string;
  usedChords: string[];
}

export interface CircleResponse {
  buckets: CircleBucketView[];
}

export interface AudioLibraryResponse {
  audioUploadDir: string;
}

interface RouteOptions {
  audioUploadDir: string;
  retrievalManager: RetrievalManager;
}

interface CreateSetRequest {
  name?: unknown;
}

interface RenameSetRequest {
  name?: unknown;
}

interface ReplaceSetTracksRequest {
  trackIds?: unknown;
}

interface CreateTrackRequest {
  artist?: unknown;
  bpm?: unknown;
  chords?: unknown;
  comment?: unknown;
  harmonyNotes?: unknown;
  key?: unknown;
  tags?: unknown;
  title?: unknown;
}

interface TrackAnalysisPatchRequest {
  bpm?: unknown;
  chords?: unknown;
  comment?: unknown;
  confidence?: unknown;
  harmonyNotes?: unknown;
  key?: unknown;
  tags?: unknown;
}

interface StartRetrievalRequest {
  input?: unknown;
}

interface SelectRetrievalCandidateRequest {
  candidateId?: unknown;
  skip?: unknown;
}

interface TrackChordSegmentView {
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

interface TrackView extends Track {
  audioAvailable: boolean;
  audioFileName: string | null;
  audioUrl: string | null;
  keyLabel: string;
  placement: ModalPlacement | null;
}

interface CircleBucketView extends Omit<CircleBucket, "tracks"> {
  tracks: TrackView[];
}

interface RetrievalJobResponse extends Omit<RetrievalJobView, "linkedTrack"> {
  linkedTrack: TrackView | null;
}

export async function registerRoutes(
  app: FastifyInstance,
  tracks: TrackRepository,
  options: RouteOptions,
): Promise<void> {
  app.get<{ Reply: HealthResponse }>("/health", async () => ({
    ok: true,
    service: "djdesk-api",
  }));

  app.get<{ Reply: AudioLibraryResponse }>("/api/audio-library", async () => ({
    audioUploadDir: options.audioUploadDir,
  }));

  app.get<{ Reply: SetDraftListResponse }>("/api/sets", async () => ({
    sets: [...(await tracks.listSetDrafts())],
  }));

  app.post<{ Body: CreateSetRequest; Reply: SetDraft | { message: string } }>(
    "/api/sets",
    async (request, reply) => {
      try {
        reply.code(201);

        return await tracks.createSetDraft({
          name: request.body?.name as string,
        });
      } catch (error) {
        return sendMutationError(reply, error);
      }
    },
  );

  app.patch<{
    Body: RenameSetRequest;
    Params: { setId: string };
    Reply: SetDraft | { message: string };
  }>("/api/sets/:setId", async (request, reply) => {
    try {
      const setDraft = await tracks.renameSetDraft(request.params.setId, {
        name: request.body?.name as string,
      });

      if (!setDraft) {
        reply.code(404);

        return {
          message: "Set not found",
        };
      }

      return setDraft;
    } catch (error) {
      return sendMutationError(reply, error);
    }
  });

  app.put<{
    Body: ReplaceSetTracksRequest;
    Params: { setId: string };
    Reply: SetDraft | { message: string };
  }>("/api/sets/:setId/tracks", async (request, reply) => {
    try {
      const setDraft = await tracks.replaceSetDraftTracks(
        request.params.setId,
        parseTrackIdList(request.body?.trackIds),
      );

      if (!setDraft) {
        reply.code(404);

        return {
          message: "Set not found",
        };
      }

      return setDraft;
    } catch (error) {
      return sendMutationError(reply, error);
    }
  });

  app.delete<{ Params: { setId: string }; Reply: { ok: true } | { message: string } }>(
    "/api/sets/:setId",
    async (request, reply) => {
      const deleted = await tracks.deleteSetDraft(request.params.setId);

      if (!deleted) {
        reply.code(404);

        return {
          message: "Set not found",
        };
      }

      return {
        ok: true,
      };
    },
  );

  app.get<{ Reply: TrackListResponse }>("/api/tracks", async () => {
    const savedTracks = await tracks.listTracks();

    return {
      tracks: savedTracks.map(toTrackView),
    };
  });

  app.post<{ Body: CreateTrackRequest; Reply: TrackView | { message: string } }>(
    "/api/tracks",
    async (request, reply) => {
      try {
        const track = await tracks.createTrack(parseCreateTrackRequest(request.body));

        reply.code(201);

        return toTrackView(track);
      } catch (error) {
        return sendMutationError(reply, error);
      }
    },
  );

  app.patch<{
    Body: TrackAnalysisPatchRequest;
    Params: { trackId: string };
    Reply: TrackView | { message: string };
  }>("/api/tracks/:trackId/analysis", async (request, reply) => {
    try {
      const track = await tracks.updateTrackAnalysis(
        request.params.trackId,
        parseTrackAnalysisPatchRequest(request.body),
      );

      if (!track) {
        reply.code(404);

        return {
          message: "Track not found",
        };
      }

      return toTrackView(track);
    } catch (error) {
      return sendMutationError(reply, error);
    }
  });

  app.get<{ Params: { trackId: string }; Reply: TrackHarmonyResponse | { message: string } }>(
    "/api/tracks/:trackId/harmony",
    async (request, reply) => {
      const harmony = await tracks.getTrackHarmony(request.params.trackId);

      if (!harmony) {
        reply.code(404);

        return {
          message: "Track not found",
        };
      }

      return harmony;
    },
  );

  app.post<{ Params: { trackId: string }; Reply: TrackView | { message: string } }>(
    "/api/tracks/:trackId/audio",
    async (request, reply) => {
      const existingTrack = await tracks.getTrackById(request.params.trackId);

      if (!existingTrack) {
        reply.code(404);

        return {
          message: "Track not found",
        };
      }

      const upload = await request.file();

      if (!upload) {
        reply.code(400);

        return {
          message: "Expected multipart file field named audio",
        };
      }

      if (upload.fieldname !== "audio") {
        upload.file.resume();
        reply.code(400);

        return {
          message: "Expected multipart file field named audio",
        };
      }

      let audioPath: string;

      try {
        audioPath = await saveUploadedAudioFile(
          options.audioUploadDir,
          upload.filename,
          upload.file,
        );
      } catch (error) {
        upload.file.resume();

        return sendMutationError(reply, error);
      }

      const updatedTrack = await tracks.updateTrackAudioPath(request.params.trackId, audioPath);

      if (!updatedTrack) {
        await rm(audioPath, {
          force: true,
        });
        reply.code(404);

        return {
          message: "Track not found",
        };
      }

      return toTrackView(updatedTrack);
    },
  );

  app.post<{
    Body: StartRetrievalRequest;
    Params: { trackId: string };
    Reply: RetrievalJobResponse | { message: string };
  }>("/api/tracks/:trackId/retrievals", async (request, reply) => {
    const track = await tracks.getTrackById(request.params.trackId);

    if (!track) {
      reply.code(404);

      return {
        message: "Track not found",
      };
    }

    try {
      const job = await options.retrievalManager.startTrackRetrieval(
        track,
        parseOptionalText(request.body?.input, "Retrieval input"),
      );

      return toRetrievalJobResponse(job);
    } catch (error) {
      return sendMutationError(reply, error);
    }
  });

  app.get<{ Params: { jobId: string }; Reply: RetrievalJobResponse | { message: string } }>(
    "/api/retrievals/:jobId",
    async (request, reply) => {
      const job = options.retrievalManager.get(request.params.jobId);

      if (!job) {
        reply.code(404);

        return {
          message: "Retrieval job not found",
        };
      }

      return toRetrievalJobResponse(job);
    },
  );

  app.post<{
    Body: SelectRetrievalCandidateRequest;
    Params: { jobId: string };
    Reply: RetrievalJobResponse | { message: string };
  }>("/api/retrievals/:jobId/yandex/select", async (request, reply) => {
    let job: RetrievalJobView | null;

    try {
      job = await options.retrievalManager.selectYandexCandidate(
        request.params.jobId,
        parseRetrievalCandidateId(request.body),
      );
    } catch (error) {
      return sendMutationError(reply, error);
    }

    if (!job) {
      reply.code(404);

      return {
        message: "Retrieval job not found",
      };
    }

    return toRetrievalJobResponse(job);
  });

  app.post<{
    Body: SelectRetrievalCandidateRequest;
    Params: { jobId: string };
    Reply: RetrievalJobResponse | { message: string };
  }>("/api/retrievals/:jobId/spotify/select", async (request, reply) => {
    let job: RetrievalJobView | null;

    try {
      job = await options.retrievalManager.selectSpotifyCandidate(
        request.params.jobId,
        parseRetrievalCandidateId(request.body),
      );
    } catch (error) {
      return sendMutationError(reply, error);
    }

    if (!job) {
      reply.code(404);

      return {
        message: "Retrieval job not found",
      };
    }

    return toRetrievalJobResponse(job);
  });

  app.post<{ Params: { jobId: string }; Reply: RetrievalJobResponse | { message: string } }>(
    "/api/retrievals/:jobId/retry",
    async (request, reply) => {
      const job = await options.retrievalManager.retry(request.params.jobId);

      if (!job) {
        reply.code(404);

        return {
          message: "Retrieval job not found",
        };
      }

      return toRetrievalJobResponse(job);
    },
  );

  app.post<{ Params: { jobId: string }; Reply: RetrievalJobResponse | { message: string } }>(
    "/api/retrievals/:jobId/cancel",
    async (request, reply) => {
      const job = options.retrievalManager.cancel(request.params.jobId);

      if (!job) {
        reply.code(404);

        return {
          message: "Retrieval job not found",
        };
      }

      return toRetrievalJobResponse(job);
    },
  );

  app.get<{ Params: { trackId: string } }>("/api/tracks/:trackId/audio", async (request, reply) => {
    const audioSource = await tracks.getTrackAudioSource(request.params.trackId);

    if (!audioSource) {
      reply.code(404);

      return {
        message: "Track audio is not linked",
      };
    }

    const fileStats = await stat(audioSource.audioPath).catch(() => null);

    if (!fileStats?.isFile()) {
      reply.code(404);

      return {
        message: "Track audio file was not found",
      };
    }

    const contentType = getAudioContentType(audioSource.audioPath);
    const range = parseRangeHeader(request.headers.range, fileStats.size);

    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", contentType);
    reply.header(
      "Content-Disposition",
      getAudioContentDisposition(basename(audioSource.audioPath)),
    );

    if (!range) {
      reply.header("Content-Length", fileStats.size);

      return reply.send(createReadStream(audioSource.audioPath));
    }

    reply.code(206);
    reply.header("Content-Length", range.end - range.start + 1);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${fileStats.size}`);

    return reply.send(
      createReadStream(audioSource.audioPath, {
        end: range.end,
        start: range.start,
      }),
    );
  });

  app.get<{ Reply: CircleResponse }>("/api/circle", async () => {
    const savedTracks = await tracks.listTracks();

    return {
      buckets: bucketTracksByTonic(savedTracks).map((bucket) => ({
        index: bucket.index,
        label: bucket.label,
        tonic: bucket.tonic,
        tracks: bucket.tracks.map(toTrackView),
      })),
    };
  });
}

export function getAudioContentDisposition(fileName: string): string {
  return [
    `inline; filename="${toAsciiHeaderFileName(fileName)}"`,
    `filename*=UTF-8''${encodeRfc5987Value(fileName)}`,
  ].join("; ");
}

async function saveUploadedAudioFile(
  audioUploadDir: string,
  originalFileName: string,
  stream: NodeJS.ReadableStream,
): Promise<string> {
  const safeFileName = sanitizeUploadedAudioFileName(originalFileName);
  const audioPath = await getAvailableAudioUploadPath(audioUploadDir, safeFileName);

  await mkdir(audioUploadDir, {
    recursive: true,
  });

  try {
    await pipeline(stream, createWriteStream(audioPath, { flags: "wx" }));
  } catch (error) {
    await rm(audioPath, {
      force: true,
    });
    throw error;
  }

  return audioPath;
}

function sanitizeUploadedAudioFileName(fileName: string): string {
  const normalized = basename(fileName)
    .normalize("NFC")
    .split("")
    .filter((character) => !isControlCharacter(character))
    .join("")
    .replace(/[\\/:]/g, "_")
    .trim();
  const extension = extname(normalized).toLocaleLowerCase();

  if (!normalized || normalized === "." || normalized === "..") {
    throw new TrackRepositoryValidationError("Audio filename is required");
  }

  if (!isSupportedAudioExtension(extension)) {
    throw new TrackRepositoryValidationError(`Unsupported audio file type: ${extension || "none"}`);
  }

  return normalized;
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);

  return code < 32 || code === 127;
}

async function getAvailableAudioUploadPath(
  audioUploadDir: string,
  fileName: string,
): Promise<string> {
  const parsed = parse(fileName);

  for (let index = 0; index < 10_000; index += 1) {
    const candidateName =
      index === 0 ? fileName : `${parsed.name} ${String(index + 1)}${parsed.ext}`;
    const candidatePath = join(audioUploadDir, candidateName);
    const fileStats = await stat(candidatePath).catch(() => null);

    if (!fileStats) {
      return candidatePath;
    }
  }

  throw new TrackRepositoryValidationError("Could not allocate a unique audio filename");
}

function isSupportedAudioExtension(extension: string): boolean {
  return [".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".wav"].includes(extension);
}

function parseCreateTrackRequest(body: CreateTrackRequest | undefined): CreateTrackInput {
  const input: CreateTrackInput = {
    chords: parseOptionalStringList(body?.chords, "chords"),
    key: parseOptionalTrackKey(body?.key),
    tags: parseOptionalStringList(body?.tags, "tags"),
    title: body?.title as string,
  };

  if (body && Object.hasOwn(body, "artist")) {
    input.artist = body.artist as string | null;
  }

  if (body && Object.hasOwn(body, "bpm")) {
    input.bpm = body.bpm as number | null;
  }

  if (body && Object.hasOwn(body, "comment")) {
    input.comment = body.comment as string | null;
  }

  if (body && Object.hasOwn(body, "harmonyNotes")) {
    input.harmonyNotes = body.harmonyNotes as string | null;
  }

  return input;
}

function parseTrackAnalysisPatchRequest(
  body: TrackAnalysisPatchRequest | undefined,
): TrackAnalysisUpdateInput {
  const input: TrackAnalysisUpdateInput = {};

  if (body && Object.hasOwn(body, "bpm")) {
    input.bpm = body.bpm as number | null;
  }

  if (body && Object.hasOwn(body, "key")) {
    input.key = parseOptionalTrackKey(body.key);
  }

  if (body && Object.hasOwn(body, "confidence")) {
    input.confidence = parseConfidencePatch(body.confidence);
  }

  if (body && Object.hasOwn(body, "harmonyNotes")) {
    input.harmonyNotes = body.harmonyNotes as string | null;
  }

  if (body && Object.hasOwn(body, "comment")) {
    input.comment = body.comment as string | null;
  }

  if (body && Object.hasOwn(body, "chords")) {
    input.chords = parseOptionalStringList(body.chords, "chords");
  }

  if (body && Object.hasOwn(body, "tags")) {
    input.tags = parseOptionalStringList(body.tags, "tags");
  }

  return input;
}

function parseTrackIdList(value: unknown): string[] {
  return parseOptionalStringList(value, "trackIds");
}

function parseOptionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TrackRepositoryValidationError(`${label} must be a string`);
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

function parseRetrievalCandidateId(
  body: SelectRetrievalCandidateRequest | undefined,
): string | null {
  if (body?.skip === true) {
    return null;
  }

  if (body?.candidateId === undefined || body.candidateId === null) {
    return null;
  }

  if (typeof body.candidateId !== "string") {
    throw new TrackRepositoryValidationError("candidateId must be a string");
  }

  const trimmed = body.candidateId.trim();

  return trimmed ? trimmed : null;
}

function parseOptionalStringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TrackRepositoryValidationError(`${label} must be a string array`);
  }

  return value;
}

function parseOptionalTrackKey(value: unknown): TrackKey | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new TrackRepositoryValidationError("Key must be an object or null");
  }

  return {
    mode: value.mode as DiatonicMode,
    tonic: value.tonic as PitchClass,
    variant: value.variant as ModalVariant,
  };
}

function parseConfidencePatch(
  value: unknown,
): Partial<Pick<TrackAnalysisConfidence, "bpm" | "key">> {
  if (!isRecord(value)) {
    throw new TrackRepositoryValidationError("Confidence must be an object");
  }

  return {
    ...(Object.hasOwn(value, "bpm") ? { bpm: value.bpm as TrackAnalysisConfidence["bpm"] } : {}),
    ...(Object.hasOwn(value, "key") ? { key: value.key as TrackAnalysisConfidence["key"] } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendMutationError(reply: FastifyReply, error: unknown): { message: string } {
  if (error instanceof TrackRepositoryValidationError) {
    reply.code(400);

    return {
      message: error.message,
    };
  }

  throw error;
}

function toAsciiHeaderFileName(fileName: string): string {
  const fallback = fileName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\;\r\n]/g, "_")
    .replace(/_+/g, "_")
    .trim();

  return fallback || "audio";
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toTrackView(track: Track): TrackView {
  const audioFileName = track.audioPath ? basename(track.audioPath) : null;

  return {
    ...track,
    audioAvailable: Boolean(track.audioPath),
    audioFileName,
    audioUrl: track.audioPath ? `/api/tracks/${encodeURIComponent(track.id)}/audio` : null,
    keyLabel: describeKey(track.key),
    placement: track.key ? getModalPlacement(track.key) : null,
  };
}

function toRetrievalJobResponse(job: RetrievalJobView): RetrievalJobResponse {
  return {
    ...job,
    linkedTrack: job.linkedTrack ? toTrackView(job.linkedTrack) : null,
  };
}

function parseRangeHeader(
  header: string | undefined,
  fileSize: number,
): { end: number; start: number } | null {
  if (!header) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header);

  if (!match) {
    return null;
  }

  const [, rawStart = "", rawEnd = ""] = match;

  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);

    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      end: fileSize - 1,
      start: Math.max(fileSize - suffixLength, 0),
    };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : fileSize - 1;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return null;
  }

  return {
    end: Math.min(end, fileSize - 1),
    start,
  };
}

function getAudioContentType(audioPath: string): string {
  switch (extname(audioPath).toLocaleLowerCase()) {
    case ".aac":
      return "audio/aac";
    case ".aif":
    case ".aiff":
      return "audio/aiff";
    case ".flac":
      return "audio/flac";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}
