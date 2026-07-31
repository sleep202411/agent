import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryPG } from "@mastra/pg";

import { exportMastraFrameworkDdl } from "./mastra-framework-schema.js";

const schema = "agent_memory";
const memoryMigrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations/0001_mastra_memory.sql"
);
const frameworkMigrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations/0004_mastra_framework_storage.sql"
);
const memoryMigration = await readFile(memoryMigrationPath, "utf8");
const frameworkMigration = await readFile(frameworkMigrationPath, "utf8");
const managedDdl = betweenMarkers(
  memoryMigration,
  "-- mastra-memory-ddl:start",
  "-- mastra-memory-ddl:end"
);
const adapterDdl = MemoryPG.getExportDDL(schema).join("\n");
const managedFrameworkDdl = betweenMarkers(
  frameworkMigration,
  "-- mastra-framework-ddl:start",
  "-- mastra-framework-ddl:end"
);
const adapterFrameworkDdl = exportMastraFrameworkDdl(schema);

if (normalizeSql(managedDdl) !== normalizeSql(adapterDdl)) {
  throw new Error("The checked-in Mastra memory DDL does not match the pinned @mastra/pg adapter");
}
if (normalizeSql(managedFrameworkDdl) !== normalizeSql(adapterFrameworkDdl)) {
  throw new Error(
    "The checked-in Mastra framework DDL does not match the pinned @mastra/pg adapter"
  );
}

process.stdout.write("Mastra framework schema matches the pinned PostgreSQL adapter.\n");

function betweenMarkers(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error("Memory migration is missing its generated-DDL boundary markers");
  }
  return source.slice(startIndex + start.length, endIndex);
}

function normalizeSql(source: string): string {
  return source
    .replace(/\s+/gu, " ")
    .replace(/\s*([(),;])\s*/gu, "$1")
    .trim();
}
