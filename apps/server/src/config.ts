import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPublicConfig, type PublicConfig } from "./public/config.ts";

const defaultDatabasePath = fileURLToPath(new URL("../../../data/djdesk.sqlite", import.meta.url));
const defaultAudioUploadDir = "/home/example/Documents/Music/2.05.2025";
const defaultChordAiKitRoot = "/home/example/Documents/ChordAI Pipeline Kit";
const defaultDjToolRoot = "/home/example/Development/dj";
const defaultWindowsFlashStagingDir = "/home/example/Documents/djdesk/windows-flash-import";
const defaultWindowsHost = "windows";

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
  const publicConfig = readPublicConfig(env);
  return {
    ...(publicConfig ? { public: publicConfig } : {}),
    audioUploadDir: resolve(env.AUDIO_UPLOAD_DIR ?? defaultAudioUploadDir),
    chordAiKitRoot: resolve(env.CHORDAI_KIT_ROOT ?? defaultChordAiKitRoot),
    databasePath: resolve(env.DATABASE_PATH ?? defaultDatabasePath),
    djToolRoot: resolve(env.DJ_TOOL_ROOT ?? defaultDjToolRoot),
    host: env.HOST ?? (publicConfig ? "127.0.0.1" : "0.0.0.0"),
    port: readPort(env.PORT),
    seedSampleData: env.SEED_SAMPLE_DATA === "true",
    windowsFlashStagingDir: resolve(env.WINDOWS_FLASH_STAGING_DIR ?? defaultWindowsFlashStagingDir),
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
