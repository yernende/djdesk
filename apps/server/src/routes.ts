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

export interface CircleResponse {
  buckets: CircleBucketView[];
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
