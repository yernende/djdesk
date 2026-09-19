import { readServerConfig } from "../config.ts";
import { linkAudioFiles } from "./linker.ts";

interface CliArgs {
  roots: string[];
}

const args = parseCliArgs();

if (args.roots.length === 0) {
  console.error(
    ["Usage:", '  npm run audio:link -- --root "/path/to/music" --root "/path/to/more-music"'].join(
      "\n",
    ),
  );
  process.exitCode = 1;
} else {
  const config = readServerConfig();
  const result = await linkAudioFiles({
    databasePath: config.databasePath,
    roots: args.roots,
  });

  console.log(`Scanned ${result.filesScanned} audio files.`);
  console.log(`Linked ${result.linked.length} tracks.`);
  console.log(`Unmatched ${result.unmatched.length} tracks.`);

  if (result.unmatched.length > 0) {
    console.log("");
    console.log("First unmatched tracks:");

    for (const track of result.unmatched.slice(0, 25)) {
      console.log(`- ${track.title}${track.artist ? ` — ${track.artist}` : ""}`);
    }
  }
}

function parseArgs(argv: readonly string[]): CliArgs {
  const roots: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--root" || arg === "--roots") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${arg} expects a path`);
      }

      roots.push(...splitRoots(value));
      index += 1;
      continue;
    }

    if (arg.startsWith("--root=")) {
      roots.push(...splitRoots(arg.slice("--root=".length)));
      continue;
    }

    if (arg.startsWith("--roots=")) {
      roots.push(...splitRoots(arg.slice("--roots=".length)));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    roots,
  };
}

function parseCliArgs(): CliArgs {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function splitRoots(value: string): string[] {
  return value
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean);
}
