import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

interface MigrationFile {
  name: string;
  sql: string;
  version: string;
}

const migrationNamePattern = /^\d{4}_.+\.sql$/;

export async function runMigrations(
  database: DatabaseSync,
  migrationsUrl = new URL("../../migrations/", import.meta.url),
): Promise<MigrationResult> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrations = await readMigrations(migrationsUrl);
  const appliedVersions = new Set(
    (
      database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
        version: string;
      }[]
    ).map((row) => row.version),
  );
  const result: MigrationResult = {
    applied: [],
    skipped: [],
  };

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      result.skipped.push(migration.version);
      continue;
    }

    applyMigration(database, migration);
    result.applied.push(migration.version);
  }

  return result;
}

async function readMigrations(migrationsUrl: URL): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsUrl);
  const files = entries.filter((entry) => migrationNamePattern.test(entry)).sort();

  return Promise.all(
    files.map(async (name) => ({
      name,
      sql: await readFile(new URL(name, migrationsUrl), "utf8"),
      version: basename(name, ".sql"),
    })),
  );
}

function applyMigration(database: DatabaseSync, migration: MigrationFile): void {
  const insertMigration = database.prepare(
    "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
  );

  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(migration.sql);
    insertMigration.run(migration.version, migration.name);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
