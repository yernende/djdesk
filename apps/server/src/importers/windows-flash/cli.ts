import { readFile } from "node:fs/promises";

import { readServerConfig } from "../../config.ts";
import {
  defaultWindowsFlashFolders,
  defaultZoukFlashFolders,
  type HqMode,
  type SpotifyMode,
  importWindowsFlashFolders,
} from "./importer.ts";

interface CliArgs {
  analysisTimeoutSeconds: number | null;
  batchPauseSeconds: number | null;
  batchSize: number | null;
  folderStartIndexes: Record<string, number>;
  folders: string[];
  hqMode: HqMode | null;
  localFallback: boolean;
  matchQueryLimit: number | null;
  maxFiles: number | null;
  onlyRemotePathsFile: string | null;
  perTrackPauseSeconds: number | null;
  singleTrackPauseSeconds: number | null;
  startIndex: number | null;
  spotifyMode: SpotifyMode | null;
  zoukOnly: boolean;
}

const args = parseCliArgs(process.argv.slice(2));
const config = readServerConfig();
const onlyRemotePaths =
  args.onlyRemotePathsFile === null
    ? undefined
    : await readRemotePathsFile(args.onlyRemotePathsFile);
const selectedFolders =
  args.folders.length > 0
    ? args.folders
    : args.zoukOnly
      ? [...defaultZoukFlashFolders]
      : defaultWindowsFlashFolders;
const result = await importWindowsFlashFolders({
  ...(args.analysisTimeoutSeconds === null
    ? {}
    : { analysisTimeoutSeconds: args.analysisTimeoutSeconds }),
  audioUploadDir: config.audioUploadDir,
  ...(args.batchPauseSeconds === null ? {} : { batchPauseSeconds: args.batchPauseSeconds }),
  chordAiKitRoot: config.chordAiKitRoot,
  databasePath: config.databasePath,
  djToolRoot: config.djToolRoot,
  folderStartIndexes: args.folderStartIndexes,
  folders: selectedFolders,
  ...(args.hqMode === null ? {} : { hqMode: args.hqMode }),
  ...(args.localFallback ? { localFallback: true } : {}),
  ...(args.matchQueryLimit === null ? {} : { matchQueryLimit: args.matchQueryLimit }),
  ...(args.maxFiles === null ? {} : { maxFiles: args.maxFiles }),
  ...(onlyRemotePaths === undefined ? {} : { onlyRemotePaths }),
  ...(args.perTrackPauseSeconds === null
    ? {}
    : { perTrackPauseSeconds: args.perTrackPauseSeconds }),
  ...(args.singleTrackPauseSeconds === null
    ? {}
    : { singleTrackPauseSeconds: args.singleTrackPauseSeconds }),
  ...(args.startIndex === null ? {} : { startIndex: args.startIndex }),
  stagingRoot: config.windowsFlashStagingDir,
  ...(args.spotifyMode === null ? {} : { spotifyMode: args.spotifyMode }),
  windowsHost: config.windowsHost,
  ...(args.batchSize === null ? {} : { batchSize: args.batchSize }),
});

console.log(`Run root: ${result.runRoot}`);
console.log(`Summary: ${result.summaryPath}`);

for (const folderResult of result.folderResults) {
  console.log(`Folder: ${folderResult.folder}`);
  console.log(`  CSV: ${folderResult.reportCsvPath}`);
  console.log(`  Markdown: ${folderResult.reportMarkdownPath}`);

  for (const [status, count] of Object.entries(folderResult.counts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(`  ${status}: ${count}`);
  }

  if (folderResult.stopReason) {
    console.warn(`  stop: ${folderResult.stopReason}`);
  }

  if (folderResult.remainingRemotePaths.length > 0) {
    console.warn(`  remaining: ${folderResult.remainingRemotePaths.length}`);
  }
}

if (result.stoppedReason) {
  console.error(`Stopped: ${result.stoppedReason}`);
}

process.exit(result.stoppedReason ? 1 : 0);

function parseCliArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {
    analysisTimeoutSeconds: null,
    batchPauseSeconds: null,
    batchSize: null,
    folderStartIndexes: {},
    folders: [],
    hqMode: null,
    localFallback: false,
    matchQueryLimit: null,
    maxFiles: null,
    onlyRemotePathsFile: null,
    perTrackPauseSeconds: null,
    singleTrackPauseSeconds: null,
    startIndex: null,
    spotifyMode: null,
    zoukOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--folder") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--folder requires a remote path");
      }

      parsed.folders.push(value);
      index += 1;
      continue;
    }

    if (arg === "--zouk-only") {
      parsed.zoukOnly = true;
      continue;
    }

    if (arg === "--folder-start-index") {
      const folder = argv[index + 1];
      const value = argv[index + 2];

      if (!folder || !value) {
        throw new Error("--folder-start-index requires a remote path and a number");
      }

      const startIndex = Number.parseInt(value, 10);

      if (!Number.isInteger(startIndex) || startIndex < 0) {
        throw new Error(`Invalid --folder-start-index value: ${value}`);
      }

      parsed.folderStartIndexes[folder] = startIndex;
      index += 2;
      continue;
    }

    if (arg === "--analysis-timeout-seconds") {
      parsed.analysisTimeoutSeconds = parsePositiveIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--batch-pause-seconds") {
      parsed.batchPauseSeconds = parseNonNegativeIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--batch-size") {
      parsed.batchSize = parsePositiveIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--hq-mode") {
      const value = argv[index + 1];

      if (value !== "download" && value !== "reuse" && value !== "none") {
        throw new Error("--hq-mode requires one of: download, reuse, none");
      }

      parsed.hqMode = value;
      index += 1;
      continue;
    }

    if (arg === "--fallback-local") {
      parsed.localFallback = true;
      continue;
    }

    if (arg === "--match-query-limit") {
      parsed.matchQueryLimit = parsePositiveIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--max-files") {
      parsed.maxFiles = parsePositiveIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--only-remote-paths-file") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--only-remote-paths-file requires a file path");
      }

      parsed.onlyRemotePathsFile = value;
      index += 1;
      continue;
    }

    if (arg === "--per-track-pause-seconds") {
      parsed.perTrackPauseSeconds = parseNonNegativeIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--single-track-pause-seconds") {
      parsed.singleTrackPauseSeconds = parseNonNegativeIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--start-index") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--start-index requires a number");
      }

      const startIndex = Number.parseInt(value, 10);

      if (!Number.isInteger(startIndex) || startIndex < 0) {
        throw new Error(`Invalid --start-index value: ${value}`);
      }

      parsed.startIndex = startIndex;
      index += 1;
      continue;
    }

    if (arg === "--spotify-mode") {
      const value = argv[index + 1];

      if (value !== "auto" && value !== "off") {
        throw new Error("--spotify-mode requires one of: auto, off");
      }

      parsed.spotifyMode = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return parsed;
}

async function readRemotePathsFile(filePath: string): Promise<string[]> {
  const text = await readFile(filePath, "utf8");

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parsePositiveIntegerArg(argv: readonly string[], index: number, name: string): number {
  const value = argv[index + 1];

  if (!value) {
    throw new Error(`${name} requires a number`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
}

function parseNonNegativeIntegerArg(argv: readonly string[], index: number, name: string): number {
  const value = argv[index + 1];

  if (!value) {
    throw new Error(`${name} requires a number`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
}
