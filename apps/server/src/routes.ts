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
  keyLabel: string;
  placement: ModalPlacement;
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

function toTrackView(track: Track): TrackView {
  return {
    ...track,
    keyLabel: describeKey(track.key),
    placement: getModalPlacement(track.key),
  };
}
