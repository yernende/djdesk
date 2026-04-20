import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import type { ServerConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { runMigrations } from "./db/migrations.ts";
import { createSqliteTrackRepository, seedTracksIfEmpty } from "./repositories/tracks.ts";
import { registerRoutes } from "./routes.ts";

export async function createServer(config: ServerConfig): Promise<FastifyInstance> {
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

  await registerRoutes(app, createSqliteTrackRepository(database));

  return app;
}
