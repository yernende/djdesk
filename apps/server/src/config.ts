import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDatabasePath = fileURLToPath(new URL("../../../data/djdesk.sqlite", import.meta.url));

export interface ServerConfig {
  databasePath: string;
  host: string;
  port: number;
  seedSampleData: boolean;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    databasePath: resolve(env.DATABASE_PATH ?? defaultDatabasePath),
    host: env.HOST ?? "0.0.0.0",
    port: readPort(env.PORT),
    seedSampleData: env.SEED_SAMPLE_DATA !== "false",
  };
}

function readPort(value: string | undefined): number {
  if (!value) {
    return 3000;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}
