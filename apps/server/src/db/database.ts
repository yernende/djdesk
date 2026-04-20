import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function openDatabase(databasePath: string): Promise<DatabaseSync> {
  await mkdir(dirname(databasePath), {
    recursive: true,
  });

  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");

  return database;
}
