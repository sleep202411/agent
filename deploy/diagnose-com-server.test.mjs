import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sha = "a".repeat(40);
const script = fileURLToPath(new URL("./diagnose-com-server.mjs", import.meta.url));
function run(mode) {
  const dir = mkdtempSync(join(tmpdir(), "fizz-rollout-check-"));
  try {
    const kubectl = join(dir, "kubectl");
    writeFileSync(
      kubectl,
      `#!${process.execPath}
const args = process.argv.slice(2);
if (!args.includes('get') || args.some(a => ['secrets','exec','logs','apply','patch','delete'].includes(a))) process.exit(9);
if (process.env.FIXTURE_MODE === 'denied') { process.stderr.write('Forbidden'); process.exit(1); }
const resource = args[args.indexOf('get') + 1];
const image = 'registry/server:${sha}';
const old = process.env.FIXTURE_MODE === 'old';
const data = {
 application: {spec:{source:{targetRevision:'main'}},status:{sync:{status:'Synced'},health:{status:'Healthy'}}},
 deployment: {metadata:{generation:2},spec:{replicas:1,template:{spec:{containers:[{name:'server',image}]}}},status:{observedGeneration:2,replicas:1,updatedReplicas:1,availableReplicas:1}},
 pods: {items:[{metadata:{name:'server-pod'},status:{phase:'Running',conditions:[{type:'Ready',status:'True'}],containerStatuses:[{name:'server',ready:true,image:old?'registry/server:old':image,imageID:'sha256:fixture',restartCount:0}]}}]},
 service: {spec:{selector:{component:'server'},ports:[{port:3001}]}},
 endpointslices:{items:[]}, ingress:{items:[]}
};
if (process.env.FIXTURE_MODE === 'stale-generation') data.deployment.status.observedGeneration = 1;
if (process.env.FIXTURE_MODE === 'init-failed') {
 data.pods.items[0].status.conditions[0].status = 'False';
 data.pods.items[0].status.initContainerStatuses = [{name:'db-migrate',state:{terminated:{reason:'Error',exitCode:1}}}];
}
process.stdout.write(JSON.stringify(data[resource]));
`
    );
    chmodSync(kubectl, 0o755);
    return spawnSync(process.execPath, [script, sha], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_MODE: mode },
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("verifies the expected running image rather than just green health", () => {
  const result = run("healthy");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).serverRolloutVerified, true);
});
for (const mode of ["old", "stale-generation", "init-failed", "denied"]) {
  test(`does not report rollout success for ${mode}`, () => {
    const result = run(mode);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.serverRolloutVerified, false);
    if (mode === "init-failed")
      assert.equal(report.pods[0].initContainers[0].terminated.exitCode, 1);
    if (mode === "denied") assert.equal(report.readFailures.length, 6);
  });
}
test("requires an explicit immutable image SHA before invoking kubectl", () => {
  const result = spawnSync(process.execPath, [script, "main"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /expected-full-image-sha/);
});
