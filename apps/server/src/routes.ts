import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { FastifyInstance } from "fastify";

import {
  bucketTracksByTonic,
  describeKey,
  getModalPlacement,
  type CircleBucket,
  type ModalPlacement,
  type Track,
} from "@djdesk/domain";

import type { TrackRepository } from "./repositories/tracks.ts";

export interface HealthResponse {
  ok: true;
  service: "djdesk-api";
}

export interface TrackListResponse {
  tracks: TrackView[];
}

export interface TrackHarmonyResponse {
  chordSegments: TrackChordSegmentView[];
  trackId: string;
  usedChords: string[];
}

export interface CircleResponse {
  buckets: CircleBucketView[];
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

export async function registerRoutes(app: FastifyInstance, tracks: TrackRepository): Promise<void> {
  app.get<{ Reply: HealthResponse }>("/health", async () => ({
    ok: true,
    service: "djdesk-api",
  }));

  app.get<{ Reply: TrackListResponse }>("/api/tracks", async () => {
    const savedTracks = await tracks.listTracks();

    return {
      tracks: savedTracks.map(toTrackView),
    };
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
      `inline; filename="${sanitizeHeaderFileName(basename(audioSource.audioPath))}"`,
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

function sanitizeHeaderFileName(fileName: string): string {
  return fileName.replace(/["\\\r\n]/g, "_");
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
