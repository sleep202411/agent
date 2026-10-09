// No dependencies or real database/process access: run production migration in a Node VM.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(process.argv[2], "utf8");
const host = "pgm-gs50h257n9e0hthu.pgsql.singapore.rds.aliyuncs.com";
const url = `postgresql://fizzdragon_app:runtime-fixture@${host}/fizzdragon?sslmode=verify-full`;
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE"];

async function run(name, overrides = {}) {
  const env = {
    DATABASE_URL: url,
    PGADMIN_USER: "fixture-admin",
    PGADMIN_PASSWORD: "fixture-password",
    DOTENV_CONFIG_PATH: "/must-not-load.env",
    KEEP_ENV: "preserved",
    SSL_CERT_FILE: "/wrong-ca.pem",
    ...overrides.env,
  };
  const calls = { clients: [], queries: [], spawns: [], ended: 0, logs: [] };
  const processMock = { env, exitCode: 0 };
  class Client {
    constructor(options) {
      calls.clients.push(options);
    }
    async connect() {
      if (overrides.connectError)
        throw Object.assign(new Error("secret fixture-password must stay hidden"), {
          code: overrides.connectCode ?? "FIXTURE_CONNECT",
        });
    }
    async query(sql) {
      calls.queries.push(sql);
      if (sql.includes("current_database()"))
        return {
          rows: [{ db: "fizzdragon", role: "fizzdragon_owner", tls: true, ...overrides.identity }],
        };
      if (!sql.includes("has_table_privilege")) throw new Error("Unexpected SQL in fixture");
      if (overrides.grantsError)
        throw Object.assign(new Error("fixture-password"), { code: "FIXTURE_GRANTS" });
      const checks = [
        ...sql.matchAll(/has_table_privilege\('fizzdragon_app',\s*c\.oid,\s*'([^']+)'\)/g),
      ].map((m) => m[1]);
      const sequenceChecks = [
        ...sql.matchAll(/has_sequence_privilege\('fizzdragon_app',\s*c\.oid,\s*'([^']+)'\)/g),
      ].map((m) => m[1]);
      // PostgreSQL's comma-separated privilege argument succeeds if ANY is held.
      // A runtime with only SELECT must fail the release's all-four-grants check.
      const held = overrides.held || privileges;
      const heldSequences = overrides.heldSequences || ["USAGE", "SELECT"];
      const complete =
        checks.every((check) =>
          check.split(",").some((privilege) => held.includes(privilege.trim()))
        ) &&
        sequenceChecks.every((check) =>
          check.split(",").some((privilege) => heldSequences.includes(privilege.trim()))
        );
      return { rows: [{ missing: complete ? 0 : 1 }] };
    }
    async end() {
      calls.ended++;
    }
  }
  function spawnSync(...args) {
    calls.spawns.push(args);
    return overrides.spawn || { status: 0 };
  }
  const requireMock = (name) => {
    if (name === "pg") return { Client };
    if (name === "node:child_process") return { spawnSync };
    throw new Error("Unexpected module: " + name);
  };
  await vm.runInNewContext(
    source,
    {
      require: requireMock,
      URL,
      process: processMock,
      console: {
        log: (...x) => calls.logs.push(x.join(" ")),
        error: (...x) => calls.logs.push(x.join(" ")),
      },
    },
    { filename: "production-migrate.cjs", timeout: 1000 }
  );
  const failed = processMock.exitCode === 1;
  assert.equal(failed, Boolean(overrides.failure), name + ": expected failure boundary");
  assert(!calls.logs.join("\n").includes("fixture-password"), name + ": password leaked");
  if (failed) {
    const expectedCode = overrides.noClient
      ? "CANONICAL_MIGRATION_CONNECTION_MISMATCH"
      : overrides.identity
        ? "MIGRATION_DATABASE_ROLE_OR_TLS_MISMATCH"
        : overrides.connectError
          ? overrides.connectCode
            ? "migration-check-failed"
            : "FIXTURE_CONNECT"
          : overrides.spawn
            ? "PRISMA_MIGRATE_FAILED"
            : overrides.grantsError
              ? "FIXTURE_GRANTS"
              : "RUNTIME_MIGRATION_GRANTS_INCOMPLETE";
    assert(
      calls.logs.some((log) => log.includes(expectedCode)),
      name + ": safe error code missing"
    );
  }
  if (overrides.noClient)
    assert.equal(calls.clients.length, 0, name + ": invalid connection reached pg");
  if (overrides.noSpawn)
    assert.equal(calls.spawns.length, 0, name + ": failed guard reached Prisma");
  if (calls.clients.length && !overrides.connectError)
    assert.equal(calls.ended, 1, name + ": client not closed");
  if (calls.spawns.length) {
    const [executable, argv, options] = calls.spawns[0];
    assert.equal(executable, "node");
    assert.deepEqual(Array.from(argv), [
      "/app/node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
    ]);
    assert.equal(options.cwd, "/app/apps/server");
    assert.equal(options.timeout, 540000);
    assert.equal(options.stdio, "inherit");
    assert.equal(options.env.KEEP_ENV, "preserved");
    assert.equal(options.env.DOTENV_CONFIG_PATH, "/dev/null");
    assert.equal(options.env.SSL_CERT_FILE, "/etc/fizzdragon/certs/ApsaraDB-CA-Chain.pem");
    const native = new URL(options.env.DATABASE_URL);
    assert.equal(native.hostname, host);
    assert.equal(native.pathname, "/fizzdragon");
    assert.equal(native.username, "fixture-admin");
    assert.equal(native.password, "fixture-password");
    assert.equal(native.searchParams.get("schema"), "public");
    assert.equal(native.searchParams.get("sslmode"), "require");
    assert.equal(native.searchParams.get("sslaccept"), "strict");
    assert.equal(native.searchParams.get("sslcert"), "/etc/fizzdragon/certs/ApsaraDB-CA-Chain.pem");
    assert.match(native.searchParams.get("options"), /role=fizzdragon_owner/);
    assert.match(native.searchParams.get("options"), /lock_timeout=10000/);
    assert.match(native.searchParams.get("options"), /statement_timeout=300000/);
    const pg = calls.clients[0];
    assert.equal(new URL(pg.connectionString).searchParams.get("sslmode"), "verify-full");
    assert.match(pg.options, /role=fizzdragon_owner/);
    assert.equal(pg.connectionTimeoutMillis, 15000);
  }
  if (overrides.spawn || overrides.identity || overrides.connectError || overrides.noClient) {
    assert(
      !calls.queries.some((sql) => sql.includes("has_table_privilege")),
      name + ": execution continued after failure"
    );
  }
  if (!failed) {
    const grantQuery = calls.queries.find((sql) => sql.includes("has_table_privilege"));
    const checks = [
      ...grantQuery.matchAll(/has_table_privilege\('fizzdragon_app',\s*c\.oid,\s*'([^']+)'\)/g),
    ].map((m) => m[1]);
    assert.deepEqual(
      checks.sort(),
      [...privileges].sort(),
      "all four privileges must be checked separately"
    );
    const sequenceChecks = [
      ...grantQuery.matchAll(/has_sequence_privilege\('fizzdragon_app',\s*c\.oid,\s*'([^']+)'\)/g),
    ].map((m) => m[1]);
    assert.deepEqual(
      sequenceChecks.sort(),
      ["SELECT", "USAGE"],
      "both sequence privileges must be checked separately"
    );
  }
  return { name, passed: true };
}

(async () => {
  const cases = [];
  cases.push(await run("canonical verified owner connection and native Prisma CLI"));
  for (const [name, change] of [
    ["wrong host", { DATABASE_URL: url.replace(host, "wrong.invalid") }],
    ["wrong database", { DATABASE_URL: url.replace("/fizzdragon?", "/snapshot?") }],
    ["wrong runtime identity", { DATABASE_URL: url.replace("fizzdragon_app:", "other:") }],
    ["unverified TLS mode", { DATABASE_URL: url.replace("verify-full", "require") }],
    ["missing admin username", { PGADMIN_USER: "" }],
    ["missing admin password", { PGADMIN_PASSWORD: "" }],
  ])
    cases.push(await run(name, { env: change, failure: true, noClient: true, noSpawn: true }));
  for (const identity of [{ db: "snapshot" }, { role: "fizzdragon_app" }, { tls: false }]) {
    cases.push(
      await run("SQL identity rejection " + JSON.stringify(identity), {
        identity,
        failure: true,
        noSpawn: true,
      })
    );
  }
  cases.push(
    await run("database connect error is sanitized", {
      connectError: true,
      failure: true,
      noSpawn: true,
    })
  );
  for (const connectCode of ["postgresql://fixture-password@private.invalid", "X".repeat(65)]) {
    cases.push(
      await run("untrusted driver code is withheld", {
        connectError: true,
        connectCode,
        failure: true,
        noSpawn: true,
      })
    );
  }
  for (const spawn of [{ status: 1 }, { status: null, error: new Error("fixture-password") }]) {
    cases.push(await run("native CLI failure " + String(spawn.status), { spawn, failure: true }));
  }
  for (const missing of privileges)
    cases.push(
      await run("missing runtime " + missing, {
        held: privileges.filter((x) => x !== missing),
        failure: true,
      })
    );
  cases.push(await run("runtime has SELECT only", { held: ["SELECT"], failure: true }));
  for (const missing of ["USAGE", "SELECT"])
    cases.push(
      await run("missing runtime sequence " + missing, {
        heldSequences: ["USAGE", "SELECT"].filter((x) => x !== missing),
        failure: true,
      })
    );
  cases.push(
    await run("grant query error closes client and sanitizes details", {
      grantsError: true,
      failure: true,
    })
  );
  process.stdout.write(JSON.stringify(cases));
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
