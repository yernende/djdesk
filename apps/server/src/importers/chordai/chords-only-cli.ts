import { readServerConfig } from "../../config.ts";
import { importChordAiChordsOnly } from "./chords-only.ts";

interface CliArgs {
  manifestPath: string | null;
  statePath: string | null;
}

const args = parseCliArgs(process.argv.slice(2));

if (!args.manifestPath || !args.statePath) {
  console.error(
    [
      "Usage:",
      "  npm run import:chordai:chords-only -- --manifest <manifest.csv> --state <batch_state.csv>",
    ].join("\n"),
  );
  process.exit(1);
}

const config = readServerConfig();
const result = await importChordAiChordsOnly({
  databasePath: config.databasePath,
  manifestPath: args.manifestPath,
  statePath: args.statePath,
});

console.log(`Import run: ${result.importRunId}`);
console.log(`Reports: ${result.reportCount}`);
console.log(`Imported: ${result.importedCount}`);
console.log(`Skipped: ${result.skipped.length}`);
console.log(`Errors: ${result.errors.length}`);

for (const skipped of result.skipped) {
  console.warn(
    `Skipped ${skipped.trackId}${skipped.reportPath ? ` (${skipped.reportPath})` : ""}: ${
      skipped.reason
    }`,
  );
}

for (const error of result.errors) {
  console.error(
    `Error ${error.trackId}${error.reportPath ? ` (${error.reportPath})` : ""}: ${error.error}`,
  );
}

if (result.errors.length > 0) {
  process.exitCode = 1;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {
    manifestPath: null,
    statePath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manifest") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--manifest requires a file path");
      }

      parsed.manifestPath = value;
      index += 1;
      continue;
    }

    if (arg === "--state") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--state requires a file path");
      }

      parsed.statePath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return parsed;
}
