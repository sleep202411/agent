import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./deploy-com-aks.sh", import.meta.url);
function fixture(t, scenario) {
  const root = mkdtempSync(join(tmpdir(), "fizz-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  git("init", "--bare", join(root, "origin.git"));
  git("remote", "add", "origin", join(root, "origin.git"));
  mkdirSync(join(repo, "deploy/helm/fizzdragon"), { recursive: true });
  mkdirSync(join(repo, "apps/server"), { recursive: true });
  copyFileSync(script, join(repo, "deploy/deploy-com-aks.sh"));
  const values = join(repo, "deploy/helm/fizzdragon/values.yaml");
  const original =
    "server:\n  image:\n    repository: fizzdragon-server\n    tag: old\nweb:\n  image:\n    repository: fizzdragon-web\n    tag: unchanged\n";
  writeFileSync(values, original);
  writeFileSync(join(repo, "apps/server/source.txt"), "committed");
  git("add", ".");
  git("commit", "-m", "source");
  git("push", "origin", "main");
  const sha = git("rev-parse", "HEAD");
  const future = git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "Remote update");
  if (scenario === "stale") git("push", "origin", `${future}:main`);
  if (scenario === "fetch-failed") {
    git("fetch", "origin", "main"); // Leave a stale FETCH_HEAD behind.
    git("remote", "set-url", "origin", join(root, "missing.git"));
  }
  writeFileSync(join(repo, "apps/server/untracked.txt"), "must not build");
  if (scenario.startsWith("resume")) {
    const changed = scenario === "resume-app-change" ? "apps/server/source.txt" : "deploy/recovery.txt";
    writeFileSync(join(repo, changed), "new change");
    git("add", changed);
    git("commit", "-m", "Subsequent change");
    git("push", "origin", "main");
  }
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "az.jsonl");
  writeFileSync(
    join(bin, "az"),
    `#!${process.execPath}
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.AZ_TEST_LOG, JSON.stringify({args, cwd: process.cwd(), msys: process.env.MSYS_NO_PATHCONV})+'\\n');
if (args[0] === 'account') process.exit(0);
const scenario = process.env.AZ_TEST_SCENARIO;
if (args[1] === 'build') {
  if (fs.readFileSync('apps/server/source.txt', 'utf8') !== 'committed' || fs.existsSync('apps/server/untracked.txt')) process.exit(41);
  if (scenario === 'script-edit') fs.writeFileSync(process.env.AZ_TEST_REPO+'/deploy/deploy-com-aks.sh', 'echo MUST_NOT_EXECUTE\\n'.repeat(1000));
  if (scenario === 'edit') fs.writeFileSync(process.env.AZ_TEST_REPO+'/apps/server/source.txt', 'concurrent edit');
  if (scenario === 'remote') {
    const r = spawnSync('git', ['push', 'origin', process.env.AZ_TEST_FUTURE+':main'], {cwd:process.env.AZ_TEST_REPO});
    if (r.status !== 0) process.exit(42);
  }
  if (scenario === 'request-failed') process.exit(43);
  // Azure CLI's core discards the result for supports_no_wait commands.
  if (args.includes('--no-wait')) process.exit(0);
  if (!args.includes('--no-logs')) process.exit(46);
  console.log(scenario === 'bad-id' ? 'unexpected output' : 'own-run-123');
} else if (args[1] === 'task' && args[2] === 'show-run') {
  if (args[args.indexOf('--run-id')+1] !== 'own-run-123') process.exit(44);
  const query = args[args.indexOf('--query')+1];
  if (query === 'status') console.log(scenario === 'failed' ? 'Failed' : 'Succeeded');
  else if (query.includes('.digest')) console.log('sha256:'+'a'.repeat(64));
  else console.log(scenario === 'missing-image' || scenario === 'resume-missing-image' ? '0' : '1');
} else if (args[1] === 'repository' && args[2] === 'show') {
  console.log('sha256:'+(scenario === 'resume-digest-change' ? 'b' : 'a').repeat(64));
} else if (args[1] === 'repository' && args[2] === 'show-tags') {
  console.log('true'); // An older build already published this tag.
} else if (args[1] === 'task' && args[2] === 'list-runs') {
  console.log(args.includes('[0].status') ? 'Failed' : 'unrelated-run');
} else process.exit(45);
`,
    { mode: 0o755 }
  );
  const result = spawnSync("/bin/bash", ["deploy/deploy-com-aks.sh", ...(scenario.startsWith("resume") ? ["--resume-build", sha, "server=own-run-123"] : ["server"])], {
    cwd: repo,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AZ_TEST_LOG: log,
      AZ_TEST_SCENARIO: scenario,
      AZ_TEST_REPO: repo,
      AZ_TEST_FUTURE: future,
      AZ_ACR_BUILD_NO_LOGS: "1",
      FORCE: "0",
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
  assert.equal(
    calls.some((c) => c.args.includes("list-runs") || c.args.includes("show-tags")),
    false,
    "Never use another run or an older tag as evidence for this build"
  );
  for (const call of calls.filter((c) => c.args[1] === "build")) {
    assert.notEqual(resolve(call.cwd), resolve(repo));
    assert.equal(existsSync(call.cwd), false, "snapshot cleaned up");
    assert.equal(call.msys, "1");
    assert.ok(call.args.includes("--no-logs"));
    assert.ok(!call.args.includes("--no-wait"));
    assert.equal(call.args[call.args.indexOf("--query") + 1], "runId");
    assert.ok(call.args.includes(`fizzdragon-server:${sha}`));
  }
  return { result, calls, git, sha, values, original, repo };
}

test("builds only committed source and publishes only the requested image after its own run succeeds", (t) => {
  const { result, calls, git, sha, values } = fixture(t, "success");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls.filter((c) => c.args[1] === "build").length, 1);
  assert.match(readFileSync(values, "utf8"), new RegExp(`tag: ${sha}`));
  assert.match(readFileSync(values, "utf8"), /tag: unchanged/);
  assert.equal(
    git("rev-parse", "HEAD"),
    git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]
  );
});
for (const scenario of [
  "stale",
  "remote",
  "edit",
  "script-edit",
  "failed",
  "missing-image",
  "bad-id",
  "request-failed",
  "fetch-failed",
]) {
  test(`refuses publication for ${scenario} without altering existing work`, (t) => {
    const { result, calls, git, sha, values, original, repo } = fixture(t, scenario);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.error, undefined);
    assert.equal(git("rev-parse", "HEAD"), sha);
    assert.equal(readFileSync(values, "utf8"), original);
    if (scenario === "stale" || scenario === "fetch-failed")
      assert.equal(calls.length, 0, "reject before Azure calls");
    if (scenario === "script-edit") {
      assert.match(result.stderr, /Branch or tracked files changed during the build/);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /MUST_NOT_EXECUTE|No such file or directory/
      );
    }
    if (scenario === "edit")
      assert.equal(readFileSync(join(repo, "apps/server/source.txt"), "utf8"), "concurrent edit");
  });
}

for (const scenario of ["resume-success", "resume-app-change", "resume-digest-change", "resume-missing-image"]) {
  test(`verified build recovery: ${scenario}`, (t) => {
    const { result, calls, sha, values, original } = fixture(t, scenario);
    assert.equal(calls.filter((c) => c.args[1] === "build").length, 0);
    if (scenario === "resume-success") {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(readFileSync(values, "utf8"), new RegExp(`tag: ${sha}`));
    } else {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(values, "utf8"), original);
    }
  });
}
