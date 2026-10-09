// Runs only inside the selected Server image's short-lived Kubernetes Job.
// Credentials remain in existing cluster Secrets; no local secret downloads.
const { Client } = require("pg");
const { spawnSync } = require("node:child_process");

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

async function migrate() {
  const url = new URL(process.env.DATABASE_URL);
  if (
    url.hostname !== "pgm-gs50h257n9e0hthu.pgsql.singapore.rds.aliyuncs.com" ||
    url.pathname !== "/fizzdragon" ||
    url.username !== "fizzdragon_app" ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    !process.env.PGADMIN_USER ||
    !process.env.PGADMIN_PASSWORD
  )
    fail("CANONICAL_MIGRATION_CONNECTION_MISMATCH");
  url.username = process.env.PGADMIN_USER;
  url.password = process.env.PGADMIN_PASSWORD;
  const options = "-c role=fizzdragon_owner -c lock_timeout=10000 -c statement_timeout=300000";
  const client = new Client({
    connectionString: url.toString(),
    options,
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  try {
    const {
      rows: [identity],
    } = await client.query(`
      SELECT current_database() AS db, current_user AS role,
             (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls
    `);
    if (
      identity.db !== "fizzdragon" ||
      identity.role !== "fizzdragon_owner" ||
      identity.tls !== true
    ) {
      fail("MIGRATION_DATABASE_ROLE_OR_TLS_MISMATCH");
    }
    // Native Prisma uses sslmode=require + sslaccept=strict + sslcert for
    // verified TLS, whereas the application's pg connection uses verify-full.
    url.search = "";
    url.searchParams.set("schema", "public");
    url.searchParams.set("sslmode", "require");
    url.searchParams.set("sslaccept", "strict");
    url.searchParams.set("sslcert", "/etc/fizzdragon/certs/ApsaraDB-CA-Chain.pem");
    url.searchParams.set("options", options);
    const result = spawnSync(
      "node",
      ["/app/node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        cwd: "/app/apps/server",
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          DOTENV_CONFIG_PATH: "/dev/null",
          // Prisma's sslcert loads one PEM; OpenSSL needs the full RDS CA bundle.
          SSL_CERT_FILE: "/etc/fizzdragon/certs/ApsaraDB-CA-Chain.pem",
        },
        stdio: "inherit",
        timeout: 540000,
      }
    );
    if (result.error || result.status !== 0) fail("PRISMA_MIGRATE_FAILED");
    const {
      rows: [grants],
    } = await client.query(`
      SELECT count(*)::int AS missing FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND (
        (c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations' AND NOT (
          has_table_privilege('fizzdragon_app', c.oid, 'SELECT') AND
          has_table_privilege('fizzdragon_app', c.oid, 'INSERT') AND
          has_table_privilege('fizzdragon_app', c.oid, 'UPDATE') AND
          has_table_privilege('fizzdragon_app', c.oid, 'DELETE')
        )) OR (c.relkind = 'S' AND NOT (
          has_sequence_privilege('fizzdragon_app', c.oid, 'USAGE') AND
          has_sequence_privilege('fizzdragon_app', c.oid, 'SELECT')
        ))
      )
    `);
    if (grants.missing !== 0) fail("RUNTIME_MIGRATION_GRANTS_INCOMPLETE");
    console.log("Canonical Prisma migrations and existing runtime grants passed");
  } finally {
    await client.end();
  }
}

migrate().catch((error) => {
  // Raw driver errors may include connection strings. Job logs retain Prisma's
  // migration output, but never print the admin URL or password here.
  const code =
    typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : "migration-check-failed";
  console.error("Migration Job failed:", code);
  process.exitCode = 1;
});
