import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { readPublicConfig, type PublicConfig } from "./public/config.ts";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const defaultDatabasePath = "data/djdesk.sqlite";
const defaultAudioUploadDir = "data/audio";
const defaultChordAiKitRoot = "../chordai-pipeline-kit";
const defaultDjToolRoot = "../dj";
const defaultWindowsFlashStagingDir = "data/windows-flash-import";
const defaultWindowsHost = "windows";
let environmentLoaded = false;

export interface ServerConfig {
  public?: PublicConfig;
  audioUploadDir: string;
  chordAiKitRoot: string;
  databasePath: string;
  djToolRoot: string;
  host: string;
  port: number;
  seedSampleData: boolean;
  windowsFlashStagingDir: string;
  windowsHost: string;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (env === process.env && !environmentLoaded) {
    try {
      // Node preserves values that already exist in the process environment.
      loadEnvFile(resolve(projectRoot, ".env"));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    environmentLoaded = true;
  }

  const publicConfig = readPublicConfig(env);
  return {
    ...(publicConfig ? { public: publicConfig } : {}),
    audioUploadDir: resolve(projectRoot, env.AUDIO_UPLOAD_DIR ?? defaultAudioUploadDir),
    chordAiKitRoot: resolve(projectRoot, env.CHORDAI_KIT_ROOT ?? defaultChordAiKitRoot),
    databasePath: resolve(projectRoot, env.DATABASE_PATH ?? defaultDatabasePath),
    djToolRoot: resolve(projectRoot, env.DJ_TOOL_ROOT ?? defaultDjToolRoot),
    host: env.HOST ?? (publicConfig ? "127.0.0.1" : "0.0.0.0"),
    port: readPort(env.PORT),
    seedSampleData: env.SEED_SAMPLE_DATA === "true",
    windowsFlashStagingDir: resolve(
      projectRoot,
      env.WINDOWS_FLASH_STAGING_DIR ?? defaultWindowsFlashStagingDir,
    ),
    windowsHost: env.WINDOWS_FLASH_HOST ?? defaultWindowsHost,
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
