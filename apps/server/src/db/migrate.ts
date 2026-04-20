import { readServerConfig } from "../config.ts";
import { openDatabase } from "./database.ts";
import { runMigrations } from "./migrations.ts";

const config = readServerConfig();
const database = await openDatabase(config.databasePath);

try {
  const result = await runMigrations(database);
  const applied = result.applied.length > 0 ? result.applied.join(", ") : "no new migrations";

  console.log(`Database: ${config.databasePath}`);
  console.log(`Applied: ${applied}`);
} finally {
  database.close();
}
