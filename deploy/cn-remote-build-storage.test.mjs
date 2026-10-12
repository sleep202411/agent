import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const source = readFileSync(new URL("./cn-remote-build-services.sh", import.meta.url), "utf8");
function run(
  t,
  { low = false, pushFail = false, podman = false, external = true, pruneFail = false, pullFailures = 0, buildFail = false } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), "cn-disk-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "calls");
  writeFileSync(
    join(dir, "docker"),
    `#!/bin/bash\necho "$*" >> '${log}'\nif [ "$1" = --version ]; then echo '${podman ? "podman version 4.9" : "Docker version 27"}'; fi
if [[ " $* " == *" --build "* ]]; then echo 'Error: unknown flag: --build' >&2; exit 125; fi
if [ "$1 $2 $3" = 'image prune --help' ]; then echo '${external ? "--external" : "--all --force"}'; exit 0; fi
${pruneFail ? "if [ \"$1 $2\" = 'system prune' ]; then exit 125; fi" : ":"}
if [ "$1 $2" = 'image inspect' ]; then exit 1; fi
if [ "$1 $2" = 'pull node:test' ]; then
 n=$(cat '${dir}/pull-count' 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > '${dir}/pull-count'
 if [ "$n" -le ${pullFailures} ]; then echo '502 Bad Gateway' >&2; exit 125; fi
fi
${buildFail ? 'if [ "$1" = build ]; then echo "compile failed" >&2; exit 1; fi' : ':'}
if [ "$1" = info ]; then\n ${podman ? '[ "$3" != "{{.DockerRootDir}}" ] || exit 1' : ":"}\n echo '${dir}'\nfi\n${pushFail ? '[ "$1" != push ] || exit 1' : ":"}\n`,
    { mode: 0o755 }
  );
  writeFileSync(
    join(dir, "df"),
    `#!/bin/bash\necho 'Filesystem size used avail percent path'\necho 'disk 99999999 1 ${low ? "100" : "99999999"} 1% /'\n`,
    { mode: 0o755 }
  );
  writeFileSync(join(dir, "Dockerfile"), "FROM node:test AS base\nFROM base AS builder\nFROM base AS runner\n");
  writeFileSync(join(dir, "sleep"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const storage = source.slice(
    source.indexOf("prepare_build_storage()"),
    source.indexOf("\ntrap ")
  );
  const build = source.slice(source.indexOf("prepare_base_images()"), source.indexOf("\nwant()"));
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail\n${storage}\n${build}\nREG=registry NS=namespace TAG=tag NPM_REGISTRY=registry\nbuild server "${dir}/Dockerfile"\nbuild web "${dir}/Dockerfile"\n`,
    ],
    { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" }
  );
  return { ...result, calls: readFileSync(log, "utf8").trim().split("\n") };
}
test("reclaims verified service layers before the next build, without volumes", (t) => {
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const prunes = r.calls.flatMap((c, i) => (c === "image prune -af" ? [i] : []));
  assert.equal(prunes.length, 2);
  assert.ok(r.calls.indexOf("pull --quiet registry/namespace/fizzdragon-server:tag") < prunes[1]);
  assert.ok(r.calls.every((c) => !/volume|system prune|container prune/.test(c)));
});
test("stops before building when cleanup leaves inadequate storage", (t) => {
  const r = run(t, { low: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /12 GiB/);
  assert.ok(!r.calls.some((c) => c.startsWith("build ")));
});
test("does not clean the newly built image after a failed push", (t) => {
  const r = run(t, { pushFail: true });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.filter((c) => c === "image prune -af").length, 1);
});
test("checks Podman graph storage when DockerRootDir is unavailable", (t) => {
  const r = run(t, { podman: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.includes("info --format {{.Store.GraphRoot}}"));
  assert.equal(r.calls.filter((c) => c === "system prune --all --force").length, 2);
  assert.ok(r.calls.every((c) => !c.includes("--volumes") && !c.split(" ").includes("--build")));
  assert.equal(r.calls.filter((c) => c === "image prune --all --force --external").length, 2);
});

test("Podman without external-image pruning still uses supported cleanup", (t) => {
  const r = run(t, { podman: true, external: false });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.calls.some((c) => c.endsWith("--external")));
});
test("Podman cleanup failures stop the build instead of hiding errors", (t) => {
  const r = run(t, { podman: true, pruneFail: true });
  assert.notEqual(r.status, 0);
  assert.ok(!r.calls.some((c) => c.startsWith("build ")));
});

test("retries transient base-image 502 before compiling, skipping internal stages", (t) => {
 const r=run(t,{podman:true,pullFailures:1});
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.calls.filter(c=>c==='pull node:test').length,3);
 assert.ok(!r.calls.includes('pull base'));
 assert.equal(r.calls.filter(c=>c.startsWith('build ')).length,2);
});
test("stops after four base-image failures without compiling or pushing", (t) => {
 const r=run(t,{podman:true,pullFailures:10});
 assert.notEqual(r.status,0);
 assert.equal(r.calls.filter(c=>c==='pull node:test').length,4);
 assert.ok(!r.calls.some(c=>/^(build|push) /.test(c)));
});
test("never retries compilation errors", (t) => {
 const r=run(t,{buildFail:true});
 assert.notEqual(r.status,0);
 assert.equal(r.calls.filter(c=>c.startsWith('build ')).length,1);
 assert.ok(!r.calls.some(c=>c.startsWith('push ')));
});
