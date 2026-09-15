import { readServerConfig } from "../config.ts";
import { openDatabase } from "../db/database.ts";
import { runMigrations } from "../db/migrations.ts";
import { backfillAudioQuality } from "./quality-backfill.ts";

interface CliArgs {
  concurrency: number | undefined;
  dryRun: boolean;
  force: boolean;
  limit: number | null;
  trackIds: string[];
}

const args = parseCliArgs();
const config = readServerConfig();
const database = await openDatabase(config.databasePath);

try {
  await runMigrations(database);

  const result = await backfillAudioQuality(database, {
    dryRun: args.dryRun,
    force: args.force,
    limit: args.limit,
    trackIds: args.trackIds,
    ...(args.concurrency === undefined ? {} : { concurrency: args.concurrency }),
  });
  const counts = countQualityResults(result.analyzed);

  console.log(`Audio quality candidates: ${result.totalCandidates}`);
  console.log(`Analyzed: ${result.analyzed.length}${result.dryRun ? " (dry run)" : ""}`);
  console.log(`HQ: ${counts.hq}`);
  console.log(`Lossy: ${counts.lossy}`);
  console.log(`Lossy+: ${counts.highBitrateLossy}`);
  console.log(`Unknown: ${counts.unknown}`);
  console.log(`Probe errors: ${counts.errors}`);

  const errored = result.analyzed.filter((item) => item.quality.probeError).slice(0, 10);

  if (errored.length > 0) {
    console.log("");
    console.log("First probe errors:");

    for (const item of errored) {
      console.log(`- ${item.title}: ${item.quality.probeError}`);
    }
  }
} finally {
  database.close();
}

function parseArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {
    concurrency: undefined,
    dryRun: false,
    force: false,
    limit: null,
    trackIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    if (arg === "--track-id") {
      parsed.trackIds.push(parseRequiredArg(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith("--track-id=")) {
      parsed.trackIds.push(parseRequiredInlineArg(arg, "--track-id"));
      continue;
    }

    if (arg === "--limit") {
      parsed.limit = parsePositiveIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      parsed.limit = parsePositiveIntegerValue(parseRequiredInlineArg(arg, "--limit"), "--limit");
      continue;
    }

    if (arg === "--concurrency") {
      parsed.concurrency = parsePositiveIntegerArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--concurrency=")) {
      parsed.concurrency = parsePositiveIntegerValue(
        parseRequiredInlineArg(arg, "--concurrency"),
        "--concurrency",
      );
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function parseCliArgs(): CliArgs {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseRequiredArg(argv: readonly string[], index: number, label: string): string {
  const value = argv[index + 1];

  if (!value) {
    throw new Error(`${label} expects a value`);
  }

  return value;
}

function parseRequiredInlineArg(arg: string, label: string): string {
  const value = arg.slice(`${label}=`.length).trim();

  if (!value) {
    throw new Error(`${label} expects a value`);
  }

  return value;
}

function parsePositiveIntegerArg(argv: readonly string[], index: number, label: string): number {
  return parsePositiveIntegerValue(parseRequiredArg(argv, index, label), label);
}

function parsePositiveIntegerValue(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} expects a positive integer`);
  }

  return parsed;
}

function countQualityResults(items: Awaited<ReturnType<typeof backfillAudioQuality>>["analyzed"]): {
  errors: number;
  highBitrateLossy: number;
  hq: number;
  lossy: number;
  unknown: number;
} {
  return items.reduce(
    (counts, item) => ({
      errors: counts.errors + (item.quality.probeError ? 1 : 0),
      highBitrateLossy: counts.highBitrateLossy + (item.quality.isHighBitrateLossy ? 1 : 0),
      hq: counts.hq + (item.quality.status === "hq" ? 1 : 0),
      lossy: counts.lossy + (item.quality.status === "lossy" ? 1 : 0),
      unknown: counts.unknown + (item.quality.status === "unknown" ? 1 : 0),
    }),
    {
      errors: 0,
      highBitrateLossy: 0,
      hq: 0,
      lossy: 0,
      unknown: 0,
    },
  );
}
