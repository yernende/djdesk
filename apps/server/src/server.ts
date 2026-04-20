import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import { createInMemoryTrackRepository } from "./repositories/tracks.ts";
import { registerRoutes } from "./routes.ts";

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: true,
  });

  await registerRoutes(app, createInMemoryTrackRepository());

  return app;
}
