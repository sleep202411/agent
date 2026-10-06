// Runs only a disposable environment-reporting workspace. Never starts server tests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const turbo = process.argv[2] ?? require.resolve("turbo/bin/turbo");
const config = JSON.parse(readFileSync(new URL("../turbo.json", import.meta.url), "utf8"));
// Discover integration switches from tracked test sources so adding a suite
// cannot silently bypass this contract. Never read local .env files.
const repoRoot = new URL("../", import.meta.url);
const sources = execFileSync("git", ["ls-files", "apps", "packages"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((path) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path));
const discovered = sources.flatMap((path) =>
  [...readFileSync(new URL(path, repoRoot), "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)]
    .map((match) => match[1])
    .filter((name) =>
      /INTEGRATION|TEST_DATABASE|AUDIT_DATABASE|POSTGRES_TEST|_SQL_TEST|RETENTION_SCALE|_SCALE_TEST|TEST_REDIS_URL/.test(
        name
      )
    )
);
const flags = [...new Set([...config.tasks.test.env, ...discovered])].sort();
for (const flag of discovered) {
  assert.ok(config.tasks.test.env.includes(flag), `${flag} must be passed and hashed by Turbo`);
}

const dir = mkdtempSync(join(tmpdir(), "fizz-test-orchestration-"));
function json(path, value) {
  writeFileSync(join(dir, path), JSON.stringify(value));
}
try {
  mkdirSync(join(dir, "fixture"));
  json("package.json", {
    name: "orchestration-check",
    private: true,
    packageManager: "npm@11.16.0",
    workspaces: ["fixture"],
  });
  json("package-lock.json", {
    name: "orchestration-check",
    lockfileVersion: 3,
    packages: {
      "": { name: "orchestration-check", workspaces: ["fixture"] },
      fixture: { name: "fixture", version: "1.0.0" },
    },
  });
  json("fixture/package.json", {
    name: "fixture",
    version: "1.0.0",
    scripts: { test: "node check.cjs" },
  });
  writeFileSync(
    join(dir, "fixture/check.cjs"),
    `require('fs').writeFileSync('result.json',JSON.stringify(Object.fromEntries(${JSON.stringify(flags)}.map(k=>[k,process.env[k]??null]))));`
  );
  // Retain the repository's env/hash contract; omit upstream builds because
  // this fixture has no dependencies. Only this harmless task is executed.
  json("turbo.json", {
    tasks: {
      test: {
        ...config.tasks.test,
        dependsOn: [],
        inputs: ["package.json", "check.cjs"],
        outputs: ["result.json"],
      },
    },
    globalPassThroughEnv: config.globalPassThroughEnv,
  });
  const env = { PATH: process.env.PATH, HOME: dir, TURBO_TELEMETRY_DISABLED: "1", CI: "1" };
  let previousHash;
  for (const [value, gpsUrl] of [
    [undefined, undefined],
    ["1", undefined],
    ["0", undefined],
    ["0", "postgres://fixture@127.0.0.1:55441/gps_test"],
    ["0", "postgres://fixture@127.0.0.1:55441/gps_test?application_name=other"],
  ]) {
    const runEnv = {
      ...env,
      ...Object.fromEntries(flags.filter(() => value !== undefined).map((k) => [k, value])),
      ...(gpsUrl ? { CONTENT_GPS_TEST_DATABASE_URL: gpsUrl } : {}),
    };
    const run = (extra) => {
      const result = spawnSync(
        process.execPath,
        [turbo, "run", "test", "--env-mode=strict", ...extra],
        { cwd: dir, env: runEnv, encoding: "utf8", timeout: 30_000 }
      );
      assert.equal(result.status, 0, result.stderr || result.error?.message || "Turbo failed");
      return result.stdout;
    };
    const dry = JSON.parse(run(["--dry=json"]));
    const hash = dry.tasks[0].hash;
    if (previousHash)
      assert.notEqual(hash, previousHash, "Integration mode must affect the task hash");
    previousHash = hash;
    rmSync(join(dir, "fixture/result.json"), { force: true });
    run([]);
    const observed = JSON.parse(readFileSync(join(dir, "fixture/result.json"), "utf8"));
    for (const flag of flags)
      assert.equal(
        observed[flag],
        flag === "CONTENT_GPS_TEST_DATABASE_URL" && gpsUrl ? gpsUrl : (value ?? null),
        `${flag} did not reach the test process`
      );
    console.log(
      `PASS: mode ${value ?? "unset"}; all ${flags.length} integration settings reach the task with a distinct hash`
    );
  }
  console.log(
    "Only disposable fixture commands executed; no database connections or credentials used."
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
