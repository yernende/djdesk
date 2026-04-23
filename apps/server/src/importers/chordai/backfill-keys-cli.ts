import { readServerConfig } from "../../config.ts";
import { backfillChordAiKeysFromReports } from "./backfill-keys.ts";

interface CliArgs {
  sourceKinds: string[];
}

const args = parseCliArgs(process.argv.slice(2));
const config = readServerConfig();
const result = await backfillChordAiKeysFromReports({
  databasePath: config.databasePath,
  sourceKinds: args.sourceKinds,
});

console.log(`Import run: ${result.importRunId}`);
console.log(`Scanned: ${result.scannedCount}`);
console.log(`Updated: ${result.updatedCount}`);
console.log(`Skipped confirmed: ${result.skippedConfirmedCount}`);
console.log(`Skipped missing report key: ${result.skippedMissingReportCount}`);
console.log(`Errors: ${result.errors.length}`);

for (const error of result.errors) {
  console.error(`Error ${error.trackId} [${error.sourceKind}]: ${error.error}`);
}

if (result.errors.length > 0) {
  process.exitCode = 1;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {
    sourceKinds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--source-kind") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--source-kind requires a value");
      }

      parsed.sourceKinds.push(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return parsed;
}
