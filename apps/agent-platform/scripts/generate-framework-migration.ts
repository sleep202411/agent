import { access, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exportMastraFrameworkDdl } from "./mastra-framework-schema.js";

const migrationName = process.argv[2];
if (!migrationName || !/^\d{4}_[a-z0-9_]+\.sql$/u.test(migrationName)) {
  throw new Error(
    "Pass a new immutable migration filename such as 0004_mastra_framework_storage.sql"
  );
}

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migrationPath = resolve(migrationsDirectory, migrationName);
try {
  await access(migrationPath);
  throw new Error(`Refusing to overwrite existing migration ${migrationName}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const generatedDdl = exportMastraFrameworkDdl("agent_memory").trim();
const migration = [
  "-- Generated from the pinned @mastra/pg framework domains.",
  "-- Do not edit after application; add a new migration for future adapter changes.",
  "-- mastra-framework-ddl:start",
  generatedDdl,
  "-- mastra-framework-ddl:end",
  "",
].join("\n");

await writeFile(migrationPath, migration, { encoding: "utf8", flag: "wx" });
process.stdout.write(`Generated ${migrationPath}\n`);
