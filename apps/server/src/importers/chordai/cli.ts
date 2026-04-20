import { readServerConfig } from "../../config.ts";
import { importChordAiReports } from "./importer.ts";

interface CliArgs {
  removeSamples: boolean;
  reportsPath: string | null;
}

const args = parseArgs(process.argv.slice(2));

if (!args.reportsPath) {
  console.error("Usage: npm run import:chordai -- --reports <reports-dir> [--remove-samples]");
  process.exit(1);
}

const config = readServerConfig();
const result = await importChordAiReports({
  databasePath: config.databasePath,
  removeSamples: args.removeSamples,
  reportsPath: args.reportsPath,
});

console.log(`Import run: ${result.importRunId}`);
console.log(`Reports: ${result.reportCount}`);
console.log(`Imported: ${result.importedCount}`);
console.log(`Skipped: ${result.skipped.length}`);
console.log(`Errors: ${result.errors.length}`);

for (const skipped of result.skipped) {
  console.warn(`Skipped ${skipped.reportPath}: ${skipped.reason}`);
}

for (const error of result.errors) {
  console.error(`Error ${error.reportPath}: ${error.error}`);
}

if (result.errors.length > 0) {
  process.exitCode = 1;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {
    removeSamples: false,
    reportsPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--remove-samples") {
      parsed.removeSamples = true;
      continue;
    }

    if (arg === "--reports") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--reports requires a directory path");
      }

      parsed.reportsPath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return parsed;
}
