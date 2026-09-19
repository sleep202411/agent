/** Exercise build artifact restoration in a disposable local Turbo workspace. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const turbo = process.argv[2] ?? require.resolve("turbo/bin/turbo");
const config = JSON.parse(readFileSync(new URL("../turbo.json", import.meta.url), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "fizz-build-cache-"));
const artifacts = [
  ".next/BUILD_ID",
  ".next/standalone/server.js",
  ".next/static/chunk.js",
  "dist/index.js",
  ".next/routes-manifest.json",
];
function json(name, value) {
  writeFileSync(join(dir, name), JSON.stringify(value));
}
try {
  mkdirSync(join(dir, "fixture"));
  json("package.json", {
    name: "build-cache-check",
    private: true,
    packageManager: "npm@11.16.0",
    workspaces: ["fixture"],
  });
  json("package-lock.json", {
    name: "build-cache-check",
    lockfileVersion: 3,
    packages: {
      "": { name: "build-cache-check", workspaces: ["fixture"] },
      fixture: { name: "fixture", version: "1.0.0" },
    },
  });
  json("fixture/package.json", {
    name: "fixture",
    version: "1.0.0",
    scripts: { build: "node build.cjs" },
  });
  writeFileSync(join(dir, ".gitignore"), ".next/\ndist/\n.turbo/\nexecutions.log\n");
  writeFileSync(join(dir, "fixture/source.txt"), "v1");
  writeFileSync(
    join(dir, "fixture/build.cjs"),
    `const fs=require('fs'),path=require('path');fs.appendFileSync('../executions.log','run\\n');for(const name of ${JSON.stringify([...artifacts, ".next/cache/local-only"])}){fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,name==='.next/routes-manifest.json'?(process.env.AURORA_STRIP_PREFIX??'unset'):'fixture:'+fs.readFileSync('source.txt','utf8')+':'+name);}console.log('Fixture build completed');`
  );
  // Use the actual build contract, without unrelated global task definitions.
  json("turbo.json", {
    tasks: { build: config.tasks.build },
    globalPassThroughEnv: config.globalPassThroughEnv,
  });
  const env = { PATH: process.env.PATH, HOME: dir, CI: "1", TURBO_TELEMETRY_DISABLED: "1" };
  function run(stripPrefix) {
    const result = spawnSync(
      process.execPath,
      [turbo, "run", "build", "--cache=local:rw", "--env-mode=strict"],
      {
        cwd: dir,
        env: { ...env, ...(stripPrefix === undefined ? {} : { AURORA_STRIP_PREFIX: stripPrefix }) },
        encoding: "utf8",
        timeout: 30_000,
      }
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message || "Turbo failed");
  }
  run();
  for (const file of artifacts)
    assert.equal(
      readFileSync(join(dir, "fixture", file), "utf8"),
      file === ".next/routes-manifest.json" ? "unset" : "fixture:v1:" + file
    );
  console.log("PASS: cold build writes representative Next.js and dist artifacts");
  rmSync(join(dir, "fixture/.next"), { recursive: true });
  rmSync(join(dir, "fixture/dist"), { recursive: true });
  run();
  assert.equal(
    readFileSync(join(dir, "executions.log"), "utf8"),
    "run\n",
    "Warm build must use cache rather than rerunning the builder"
  );
  for (const file of artifacts) {
    assert.ok(existsSync(join(dir, "fixture", file)), `Cache hit did not restore ${file}`);
    assert.equal(
      readFileSync(join(dir, "fixture", file), "utf8"),
      file === ".next/routes-manifest.json" ? "unset" : "fixture:v1:" + file
    );
  }
  assert.equal(
    existsSync(join(dir, "fixture/.next/cache/local-only")),
    false,
    "Compiler scratch cache should not be restored as release output"
  );
  console.log(
    "PASS: cache hit restores BUILD_ID, standalone server, static files and dist without rerunning"
  );
  console.log("PASS: .next/cache is excluded from restored release artifacts");
  writeFileSync(join(dir, "fixture/source.txt"), "v2");
  run();
  assert.equal(
    readFileSync(join(dir, "executions.log"), "utf8"),
    "run\nrun\n",
    "A source change must execute a new build"
  );
  for (const file of artifacts)
    assert.equal(
      readFileSync(join(dir, "fixture", file), "utf8"),
      file === ".next/routes-manifest.json" ? "unset" : "fixture:v2:" + file
    );
  console.log("PASS: a source change invalidates the old build and emits updated artifacts");
  run("1");
  assert.equal(
    readFileSync(join(dir, "fixture/.next/routes-manifest.json"), "utf8"),
    "1",
    "Build-time routing flag must reach the builder and invalidate the old manifest"
  );
  run("0");
  assert.equal(
    readFileSync(join(dir, "fixture/.next/routes-manifest.json"), "utf8"),
    "0",
    "Changing the routing flag must invalidate the cached manifest"
  );
  assert.equal(readFileSync(join(dir, "executions.log"), "utf8"), "run\n".repeat(4));
  console.log(
    "PASS: AURORA_STRIP_PREFIX reaches the build and changing it invalidates the manifest"
  );
  console.log(
    "Only synthetic local files were built; no Next app, provider, remote cache or deployment was used."
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
