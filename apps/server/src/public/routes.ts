import { extname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bucketTracksByTonic, describeKey, getModalPlacement, type Track } from "@djdesk/domain";
import type { TrackRepository } from "../repositories/tracks.ts";
import { streamTrackAudio } from "../routes.ts";
import type { PublicConfig } from "./config.ts";
import { csrfToken, PublicError, WorkspaceStore, type WorkspaceAccess } from "./store.ts";

export async function registerPublicRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  tracks: TrackRepository,
  config: PublicConfig,
): Promise<void> {
  const store = new WorkspaceStore(database, config);
  const secure = config.origin.startsWith("https:");
  const cookieName = secure ? "__Host-djdesk" : "djdesk-local-session";

  function sessionToken(request: FastifyRequest): string | undefined {
    return request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  }

  function auth(request: FastifyRequest): WorkspaceAccess {
    const token = sessionToken(request);
    const access = store.authenticate(token);
    if (!access)
      throw new PublicError(401, "Open your secret access link to continue.", "SESSION_REQUIRED");
    if (
      !["GET", "HEAD"].includes(request.method) &&
      request.headers["x-csrf-token"] !== csrfToken(token!)
    ) {
      throw new PublicError(403, "Refresh the page and try again.", "CSRF_INVALID");
    }
    return access;
  }

  function issueSession(reply: FastifyReply, access: WorkspaceAccess) {
    const token = store.createSession(access);
    reply.header(
      "Set-Cookie",
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`,
    );
    return { workspaceId: access.workspaceId, csrfToken: csrfToken(token) };
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.headers.origin !== config.origin)
        throw new PublicError(403, "Requests must come from this site.", "ORIGIN_INVALID");
      store.consumeLimit("writes", request.ip, config.writesPerMinute, 60);
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof PublicError
        ? error.statusCode
        : ((error as { statusCode?: number }).statusCode ?? 500);
    if (status === 429) reply.header("Retry-After", "60");
    // No request bodies, tokens, filesystem paths or database diagnostics in public errors/logs.
    if (status >= 500) app.log.error({ status }, "Public API request failed");
    reply.code(status).send({
      code:
        error instanceof PublicError
          ? error.code
          : status >= 500
            ? "SERVER_ERROR"
            : "INVALID_REQUEST",
      ...(error instanceof PublicError && Object.keys(error.params).length
        ? { params: error.params }
        : {}),
      message:
        error instanceof PublicError
          ? error.message
          : status >= 500
            ? "The server could not complete this request."
            : "Invalid request.",
    });
  });

  app.get("/health", async () => ({ ok: true, service: "djdesk-api" }));
  app.get("/api/config", async () => ({
    mode: "public",
    maxTracksPerSet: config.tracksPerSet,
    maxSets: config.setsPerWorkspace,
  }));

  app.get("/api/session", async (request) => {
    const token = sessionToken(request);
    const access = store.authenticate(token);
    return access && token
      ? { workspaceId: access.workspaceId, csrfToken: csrfToken(token) }
      : { workspaceId: null, csrfToken: null };
  });

  app.post("/api/workspaces", async (request, reply) => {
    const input = body(request);
    store.consumeLimit("workspaces", request.ip, config.workspacesPerDay, 86400);
    const created = store.transaction(() => {
      const access = store.createWorkspace();
      const set = store.createSet(access.workspaceId, input);
      return { ...issueSession(reply, access), secret: access.secret, set };
    });
    reply.code(201);
    return created;
  });

  app.post("/api/session/exchange", async (request, reply) => {
    const input = body(request);
    store.consumeLimit("exchanges", request.ip, 30, 60);
    const access = store.exchange(input.workspaceId, input.secret);
    return issueSession(reply, access);
  });

  app.post("/api/workspace/rotate", async (request, reply) => {
    const access = auth(request);
    return store.transaction(() => {
      const next = store.rotate(access);
      return { ...issueSession(reply, next), secret: next.secret };
    });
  });

  app.get("/api/sets", async (request) => ({ sets: store.listSets(auth(request).workspaceId) }));
  app.post("/api/sets", async (request, reply) => {
    const access = auth(request);
    const set = store.transaction(() => store.createSet(access.workspaceId, body(request)));
    reply.code(201);
    return set;
  });
  app.patch<{ Params: { setId: string } }>("/api/sets/:setId", async (request) => {
    const access = auth(request);
    return store.transaction(() =>
      store.updateSet(access.workspaceId, request.params.setId, body(request)),
    );
  });
  app.put<{ Params: { setId: string } }>("/api/sets/:setId/tracks", async (request) => {
    const access = auth(request);
    return store.transaction(() =>
      store.updateSet(access.workspaceId, request.params.setId, body(request)),
    );
  });
  app.delete<{ Params: { setId: string } }>("/api/sets/:setId", async (request) => {
    const access = auth(request);
    store.transaction(() =>
      store.deleteSet(access.workspaceId, request.params.setId, body(request).revision),
    );
    return { ok: true };
  });

  app.get("/api/tracks", async () => {
    const publication = store.publication();
    return {
      tracks: (await tracks.listTracks())
        .filter((track) => publication.has(track.id))
        .map((track) => publicTrack(track, publication.get(track.id) === true)),
    };
  });
  app.get("/api/circle", async () => {
    const publication = store.publication();
    return {
      buckets: bucketTracksByTonic(
        (await tracks.listTracks()).filter((track) => publication.has(track.id)),
      ).map((bucket) => ({
        ...bucket,
        tracks: bucket.tracks.map((track) =>
          publicTrack(track, publication.get(track.id) === true),
        ),
      })),
    };
  });
  app.get<{ Params: { trackId: string } }>("/api/tracks/:trackId/harmony", async (request) => {
    if (!store.publication().has(request.params.trackId))
      throw new PublicError(404, "Track not found.", "TRACK_NOT_FOUND");
    const harmony = await tracks.getTrackHarmony(request.params.trackId);
    if (!harmony) throw new PublicError(404, "Track not found.", "TRACK_NOT_FOUND");
    return harmony;
  });
  app.get<{ Params: { trackId: string }; Querystring: { download?: string } }>(
    "/api/tracks/:trackId/audio",
    async (request, reply) => {
      if (store.publication().get(request.params.trackId) !== true)
        throw new PublicError(404, "Audio not available.", "AUDIO_UNAVAILABLE");
      const source = await tracks.getTrackAudioSource(request.params.trackId);
      if (!source) throw new PublicError(404, "Audio not available.", "AUDIO_UNAVAILABLE");
      return streamTrackAudio(source, request, reply, {
        download: request.query.download === "1",
        publicName: `${source.title.replace(/[\r\n\\/]/g, "_")}${extname(source.audioPath)}`,
      });
    },
  );
}

function body(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
    throw new PublicError(400, "Expected a JSON object.", "INVALID_REQUEST");
  return request.body as Record<string, unknown>;
}

function publicTrack(track: Track, allowAudio: boolean) {
  const audioAvailable = Boolean(allowAudio && track.audioPath);
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    key: track.key,
    confidence: track.confidence,
    chordProgression: track.chordProgression,
    harmonyNotes: track.harmonyNotes,
    durationSeconds: track.durationSeconds,
    nonStandardTuning: track.nonStandardTuning,
    tags: track.tags,
    audioQuality:
      audioAvailable && track.audioQuality
        ? { ...track.audioQuality, probeError: null }
        : undefined,
    audioAvailable,
    audioFileName: audioAvailable ? track.title : null,
    audioUrl: audioAvailable ? `/api/tracks/${encodeURIComponent(track.id)}/audio` : null,
    keyLabel: describeKey(track.key),
    placement: track.key ? getModalPlacement(track.key) : null,
  };
}
