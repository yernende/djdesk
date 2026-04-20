import { readServerConfig } from "../../config.ts";
import { importRekordboxPlaylist } from "./importer.ts";

interface CliArgs {
  fromPosition: number;
  playlistPath: string | null;
  toPosition: number;
}

const args = parseArgs(process.argv.slice(2));

if (!args.playlistPath) {
  console.error(
    "Usage: npm run import:rekordbox -- --playlist <playlist-file> [--from 1] [--to 136]",
  );
  process.exit(1);
}

const config = readServerConfig();
const result = await importRekordboxPlaylist({
  databasePath: config.databasePath,
  fromPosition: args.fromPosition,
  playlistPath: args.playlistPath,
  toPosition: args.toPosition,
});

console.log(`Import run: ${result.importRunId}`);
console.log(`Rows: ${result.rowCount}`);
console.log(`Imported: ${result.importedCount}`);
console.log(`Skipped: ${result.skipped.length}`);
console.log(`Errors: ${result.errors.length}`);

for (const skipped of result.skipped) {
  const position = skipped.playlistPosition ? `#${skipped.playlistPosition}` : "#?";
  const title = skipped.title ? ` ${skipped.title}` : "";

  console.warn(`Skipped ${position}${title}: ${skipped.reason}`);
}

for (const error of result.errors) {
  console.error(`Error #${error.playlistPosition} ${error.title}: ${error.error}`);
}

if (result.errors.length > 0) {
  process.exitCode = 1;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {
    fromPosition: 1,
    playlistPath: null,
    toPosition: Number.MAX_SAFE_INTEGER,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--playlist") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--playlist requires a file path");
      }

      parsed.playlistPath = value;
      index += 1;
      continue;
    }

    if (arg === "--from") {
      parsed.fromPosition = readPosition(argv[index + 1], "--from");
      index += 1;
      continue;
    }

    if (arg === "--to") {
      parsed.toPosition = readPosition(argv[index + 1], "--to");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  if (parsed.fromPosition > parsed.toPosition) {
    throw new Error("--from must be less than or equal to --to");
  }

  return parsed;
}

function readPosition(value: string | undefined, flag: string): number {
  if (!value) {
    throw new Error(`${flag} requires a playlist position`);
  }

  const position = Number.parseInt(value, 10);

  if (!Number.isInteger(position) || position < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return position;
}
