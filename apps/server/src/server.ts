import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";

import type { ServerConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { runMigrations } from "./db/migrations.ts";
import { createSqliteTrackRepository, seedTracksIfEmpty } from "./repositories/tracks.ts";
import { createDjToolRetriever } from "./retrieval/dj-tool.ts";
import { createRetrievalManager } from "./retrieval/jobs.ts";
import type { TrackRetriever } from "./retrieval/types.ts";
import { registerRoutes } from "./routes.ts";

export interface ServerDependencies {
  retriever?: TrackRetriever;
}

export async function createServer(
  config: ServerConfig,
  dependencies: ServerDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  const database = await openDatabase(config.databasePath);
  const migrations = await runMigrations(database);

  if (migrations.applied.length > 0) {
    app.log.info({ migrations: migrations.applied }, "Applied database migrations");
  }

  if (config.seedSampleData && seedTracksIfEmpty(database)) {
    app.log.info({ databasePath: config.databasePath }, "Seeded sample track data");
  }

  app.addHook("onClose", async () => {
    database.close();
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024,
      files: 1,
    },
  });

  const trackRepository = createSqliteTrackRepository(database);
  const retriever =
    dependencies.retriever ??
    createDjToolRetriever({
      audioUploadDir: config.audioUploadDir,
      djToolRoot: config.djToolRoot,
    });

  await registerRoutes(app, trackRepository, {
    audioUploadDir: config.audioUploadDir,
    retrievalManager: createRetrievalManager({
      retriever,
      tracks: trackRepository,
    }),
  });

  return app;
}
