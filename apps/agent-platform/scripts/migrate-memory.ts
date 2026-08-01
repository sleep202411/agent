import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PostgresStore } from "@mastra/pg";

const schema = "agent_memory";
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/u;
const databaseUrl = await loadMigrationDatabaseUrl();
const databaseRoles = loadDatabaseRoles();

const storage = new PostgresStore({
  id: "fizzdragon-agent-memory-migrator",
  connectionString: databaseUrl,
  schemaName: schema,
  disableInit: true,
  max: 1,
});

try {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => migrationFilePattern.test(file))
    .sort();
  if (files.length === 0) {
    throw new Error(`No memory migrations found in ${migrationsDirectory}`);
  }

  const migrations = await Promise.all(
    files.map(async (file) => {
      const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
      return Object.freeze({
        id: file.slice(0, -".sql".length),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      });
    })
  );

  await storage.db.tx(async (transaction) => {
    await transaction.none("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "fizzdragon-agent-memory-migrations",
    ]);
    await transaction.none(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await transaction.none(`
      CREATE TABLE IF NOT EXISTS "${schema}"."schema_migrations" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "checksum" CHAR(64) NOT NULL,
        "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await transaction.manyOrNone<{
      id: string;
      checksum: string;
    }>(`SELECT "id", "checksum" FROM "${schema}"."schema_migrations" ORDER BY "id"`);
    const available = new Map(migrations.map((migration) => [migration.id, migration]));

    for (const migration of applied) {
      const source = available.get(migration.id);
      if (!source) {
        throw new Error(`Database contains unknown agent-memory migration ${migration.id}`);
      }
      if (migration.checksum.trim() !== source.checksum) {
        throw new Error(`Checksum drift detected for agent-memory migration ${migration.id}`);
      }
    }

    const appliedIds = new Set(applied.map((migration) => migration.id));
    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) continue;
      await transaction.none(migration.sql);
      await transaction.none(
        `
          INSERT INTO "${schema}"."schema_migrations" ("id", "checksum")
          VALUES ($1, $2)
        `,
        [migration.id, migration.checksum]
      );
      process.stdout.write(`Applied agent-memory migration ${migration.id}\n`);
    }

    const migrationRole = await transaction.one<{ role: string }>(
      `SELECT current_user::text AS "role"`
    );
    if (process.env.NODE_ENV === "production") {
      if (migrationRole.role === databaseRoles.api || migrationRole.role === databaseRoles.worker) {
        throw new Error("Production migration and runtime PostgreSQL roles must be separate");
      }

      const runtimeRoles = await transaction.manyOrNone<{
        role: string;
        canLogin: boolean;
        inherits: boolean;
        isSuperuser: boolean;
        canCreateRole: boolean;
        canCreateDatabase: boolean;
        canReplicate: boolean;
        bypassesRowSecurity: boolean;
      }>(
        `
          SELECT
            rolname::text AS "role",
            rolcanlogin AS "canLogin",
            rolinherit AS "inherits",
            rolsuper AS "isSuperuser",
            rolcreaterole AS "canCreateRole",
            rolcreatedb AS "canCreateDatabase",
            rolreplication AS "canReplicate",
            rolbypassrls AS "bypassesRowSecurity"
          FROM pg_roles
          WHERE rolname IN ($1, $2)
          ORDER BY rolname
        `,
        [databaseRoles.api, databaseRoles.worker]
      );
      if (runtimeRoles.length !== 2) {
        throw new Error("Production API and Worker PostgreSQL roles must already exist");
      }
      for (const role of runtimeRoles) {
        if (
          !role.canLogin ||
          role.inherits ||
          role.isSuperuser ||
          role.canCreateRole ||
          role.canCreateDatabase ||
          role.canReplicate ||
          role.bypassesRowSecurity
        ) {
          throw new Error(
            `Production PostgreSQL role ${role.role} must be LOGIN NOINHERIT without administrative attributes`
          );
        }
      }

      const inheritedRoles = await transaction.manyOrNone<{
        role: string;
        inheritedRole: string;
      }>(
        `
          SELECT
            member_role.rolname::text AS "role",
            inherited_role.rolname::text AS "inheritedRole"
          FROM pg_auth_members AS membership
          JOIN pg_roles AS member_role ON member_role.oid = membership.member
          JOIN pg_roles AS inherited_role ON inherited_role.oid = membership.roleid
          WHERE member_role.rolname IN ($1, $2)
        `,
        [databaseRoles.api, databaseRoles.worker]
      );
      if (inheritedRoles.length > 0) {
        throw new Error(
          "Production API and Worker PostgreSQL roles must not be members of other roles"
        );
      }

      const ownedObjects = await transaction.manyOrNone<{
        role: string;
        objectName: string;
      }>(
        `
          SELECT
            owner.rolname::text AS "role",
            namespace.nspname::text AS "objectName"
          FROM pg_namespace AS namespace
          JOIN pg_roles AS owner ON owner.oid = namespace.nspowner
          WHERE namespace.nspname = $3
            AND owner.rolname IN ($1, $2)
          UNION ALL
          SELECT
            owner.rolname::text AS "role",
            namespace.nspname || '.' || object.relname AS "objectName"
          FROM pg_class AS object
          JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
          JOIN pg_roles AS owner ON owner.oid = object.relowner
          WHERE namespace.nspname = $3
            AND owner.rolname IN ($1, $2)
        `,
        [databaseRoles.api, databaseRoles.worker, schema]
      );
      if (ownedObjects.length > 0) {
        throw new Error(
          "Production API and Worker PostgreSQL roles must not own the memory schema or its objects"
        );
      }
    }

    const quotedApiRole = quoteIdentifier(databaseRoles.api);
    const quotedWorkerRole = quoteIdentifier(databaseRoles.worker);
    await transaction.none(
      `GRANT USAGE ON SCHEMA "${schema}" TO ${quotedApiRole}, ${quotedWorkerRole}`
    );
    await transaction.none(
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
       ON ALL TABLES IN SCHEMA "${schema}"
       FROM ${quotedApiRole}`
    );
    await transaction.none(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${quotedApiRole}`);
    await transaction.none(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}"
       FROM ${quotedApiRole}`
    );
    await transaction.none(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}"
       TO ${quotedWorkerRole}`
    );
    await transaction.none(
      `REVOKE INSERT, UPDATE, DELETE
       ON TABLE "${schema}"."schema_migrations"
       FROM ${quotedWorkerRole}`
    );
    await transaction.none(
      `GRANT SELECT ON TABLE "${schema}"."schema_migrations"
       TO ${quotedApiRole}, ${quotedWorkerRole}`
    );
    await transaction.none(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${schema}"
       TO ${quotedWorkerRole}`
    );
    await transaction.none(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
       REVOKE ALL PRIVILEGES ON TABLES FROM ${quotedApiRole}`
    );
    await transaction.none(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
       GRANT SELECT ON TABLES TO ${quotedApiRole}`
    );
    await transaction.none(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedWorkerRole}`
    );
    await transaction.none(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
       GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedWorkerRole}`
    );
  });
} finally {
  await storage.close();
}

async function loadMigrationDatabaseUrl(): Promise<string> {
  const inline = process.env.AGENT_MEMORY_MIGRATION_DATABASE_URL?.trim();
  const filePath = process.env.AGENT_MEMORY_MIGRATION_DATABASE_URL_FILE?.trim();
  if (inline && filePath) {
    throw new Error(
      "Set exactly one of AGENT_MEMORY_MIGRATION_DATABASE_URL or AGENT_MEMORY_MIGRATION_DATABASE_URL_FILE"
    );
  }
  if (inline) return inline;
  if (filePath) {
    const fromFile = (await readFile(filePath, "utf8")).trim();
    if (fromFile) return fromFile;
    throw new Error("AGENT_MEMORY_MIGRATION_DATABASE_URL_FILE points to an empty secret");
  }
  throw new Error(
    "AGENT_MEMORY_MIGRATION_DATABASE_URL or AGENT_MEMORY_MIGRATION_DATABASE_URL_FILE is required; runtime credentials are never used for schema changes"
  );
}

function loadDatabaseRoles(): Readonly<{ api: string; worker: string }> {
  const api = parseDatabaseRole("AGENT_MEMORY_API_DATABASE_ROLE");
  const worker = parseDatabaseRole("AGENT_MEMORY_WORKER_DATABASE_ROLE");
  if (process.env.NODE_ENV === "production" && api === worker) {
    throw new Error("Production API and Worker PostgreSQL roles must be separate");
  }
  return Object.freeze({ api, worker });
}

function parseDatabaseRole(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL role identifier`);
  }
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
