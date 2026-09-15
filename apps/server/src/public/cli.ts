import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readServerConfig } from "../config.ts";
import { runMigrations } from "../db/migrations.ts";
import {
  applyPublication,
  backupDatabase,
  claimLegacySets,
  exportManifest,
  preparePublicData,
  readManifest,
  verifyDatabase,
} from "./admin.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    database: { type: "string" },
    output: { type: "string" },
    manifest: { type: "string" },
    origin: { type: "string" },
    "audio-root": { type: "string" },
  },
});
const command = positionals[0];
// npm workspace scripts change cwd; paths supplied by the operator remain
// relative to the directory from which npm was invoked.
const invocationRoot = process.env.INIT_CWD ?? process.cwd();
const databasePath = resolve(
  invocationRoot,
  values.database ?? readServerConfig(process.env).databasePath,
);
function required(name: "output" | "manifest" | "origin"): string {
  const value = values[name];
  if (!value) throw new Error(`--${name} is required`);
  return name === "origin" ? value : resolve(invocationRoot, value);
}

try {
  if (command === "prepare") {
    const result = await preparePublicData(
      databasePath,
      required("output"),
      await readManifest(required("manifest")),
      required("origin"),
      values["audio-root"],
    );
    console.log(JSON.stringify(result));
    console.log(
      "Prepared data is marked READY. The owner link, if any, is in owner-access-link.txt (private).",
    );
  } else {
    if (!["export", "publish", "owner-link", "backup", "verify"].includes(command ?? ""))
      throw new Error(
        "Usage: public <export|publish|prepare|owner-link|backup|verify> --database PATH [--manifest PATH] [--output PATH] [--origin URL] [--audio-root DEPLOYED_PATH]",
      );
    const db = new DatabaseSync(databasePath, {
      readOnly: command !== "publish" && command !== "owner-link",
    });
    try {
      if (command === "export") {
        await writeFile(required("output"), `${JSON.stringify(exportManifest(db), null, 2)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        console.log(
          "Publication checklist exported with every entry disabled. Select publish/audio explicitly.",
        );
      } else if (command === "backup") {
        await backupDatabase(db, resolve(required("output")));
        console.log("Consistent SQLite backup verified.");
      } else if (command === "verify") {
        verifyDatabase(db);
        console.log("SQLite integrity and foreign keys: OK.");
      } else {
        db.exec("PRAGMA foreign_keys = ON");
        await runMigrations(db);
        if (command === "publish") {
          applyPublication(db, await readManifest(required("manifest")));
          console.log("Public catalogue selection updated. Existing track IDs and sets preserved.");
        } else {
          const count = await claimLegacySets(db, required("origin"), required("output"));
          console.log(
            `Assigned ${count} existing sets. Access link written to the requested private file, never to logs.`,
          );
        }
      }
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
}
