import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function run(t, scenario, phase = "all", pinned = false) {
  const root = mkdtempSync(join(tmpdir(), "cn-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  function git(...args) {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git("init", "-b", "main");
  git("config", "user.name", "Local QA");
  git("config", "user.email", "qa@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  const put = (file, contents) => {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), contents, { mode: 0o755 });
  };
  put(
    "deploy/cn_registry.py",
    "import os, sys\nsys.exit(1 if os.environ.get('QA_SCENARIO') == 'missing-image' else 0)\n"
  );
  put("deploy/release_images.py", "import os,sys\nprint((sys.argv[3]+' sha256:'+'a'*64) if os.environ.get('QA_SCENARIO') == 'reuse-existing' else 'BUILD')\n");
  put("deploy/verify_release_image.py", "import os,sys\nsys.exit(1 if os.environ.get('QA_SCENARIO') == 'missing-image' else 0)\n");
  put("deploy/release_revision.py", "import os,sys\nprint(os.environ['QA_FUTURE'])\n");
  put("deploy/release_lock.py", "import os,sys\nos.environ['FD_REGIONAL_LOCK_CN']='fixture'\nos.execvp(sys.argv[3],sys.argv[3:])\n");
  put("deploy/cn_build_credentials.py", "import os,sys\nfrom pathlib import Path\nif os.environ.get('QA_SCENARIO')=='auth-failure': sys.exit(1)\np=Path(sys.argv[2]);p.mkdir(parents=True);(p/'acr-username.txt').write_text('fixture-user');(p/'acr-password.txt').write_text('fixture-token')\n");
  put("deploy/cn_ssh_access.py", "import os,sys\nsys.exit(2 if os.environ.get('QA_SCENARIO') == 'ssh-blocked' else 0)\n");
  put("deploy/cn-preflight.sh", "#!/bin/bash\nexit 0\n");
  put("deploy/cn-remote-build-services.sh", "# snapshot A\n");
  put("deploy/cn-source-relay.cjs", "// mocked relay\n");
  put("deploy/helm/fizzdragon/Chart.yaml", "name: fixture\n");
  put("deploy/helm/fizzdragon/values.yaml", "revision: A\n");
  put("deploy/helm/fizzdragon/values.cn-prod.yaml", "{}\n");
  put("deploy/helm/fizzdragon/templates/server.yaml", "fixture\n");
  put("apps/web/.env.production.cn", "NEXT_PUBLIC_PARENT_ORIGIN=https://example.invalid\n");
  put(".env.private", "fixture-only-secret");
  put("source.txt", "A");
  copyFileSync(
    new URL("./deploy-cn-services.sh", import.meta.url),
    join(repo, "deploy/deploy-cn-services.sh")
  );
  git("add", ".");
  git("commit", "-m", "A");
  const revision = git("rev-parse", "HEAD");
  put("source.txt", "B");
  put("deploy/cn-remote-build-services.sh", "# snapshot B\n");
  git("commit", "-am", "B");
  const future = git("rev-parse", "HEAD");
  git("reset", "--hard", revision);
  put("untracked.txt", "exclude");
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.jsonl");
  const mock = join(bin, "mock");
  writeFileSync(
    mock,
    `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const cmd = path.basename(process.argv[1]), args = process.argv.slice(2);
const root = process.env.QA_ROOT, repo = process.env.QA_REPO, scenario = process.env.QA_SCENARIO;
fs.appendFileSync(root+'/calls.jsonl', JSON.stringify({cmd,args})+'\\n');
if(cmd==='aliyun') {
 if(args[1]==='StartInstance' && scenario==='script-edit') fs.writeFileSync(repo+'/deploy/deploy-cn-services.sh', 'echo MUST_NOT_EXECUTE\\n'.repeat(1000));
 if(args[1]==='StartInstance' && scenario==='advance') cp.execFileSync('git',['reset','--hard',process.env.QA_FUTURE],{cwd:repo});
 if(args[1]==='StartInstance') {
  if(scenario==='start-rejected') { console.error('IncorrectInstanceStatus: fixture'); process.exit(1); }
  fs.writeFileSync(root+'/started', '1');
}
 if(args[1]==='DescribeInstanceStatus') {
  let status=fs.existsSync(root+'/started') ? 'Running' : 'Stopped';
  if(scenario==='stopping' && !fs.existsSync(root+'/stopping-seen')) {
    fs.writeFileSync(root+'/stopping-seen', '1'); status='Stopping';
  }
  console.log(JSON.stringify({InstanceStatuses:{InstanceStatus:[{Status:status}]}}));
 }
 if(args[1]==='DescribeInstances') console.log(JSON.stringify({Instances:{Instance:[{EipAddress:{IpAddress:'127.0.0.1'}}]}}));
} else if(cmd==='node') {
 if(args[1]==='put') {
   const dest = root+'/captured'; fs.mkdirSync(dest);
   cp.execFileSync('tar',['-xzf',args[2],'-C',dest]);
   fs.writeFileSync(root+'/digest',cp.execFileSync('shasum',['-a','256',args[2]],{encoding:'utf8'}).split(' ')[0]);
   console.log('https://fixture.invalid/archive');
 }
} else if(cmd==='ssh') {
 if(scenario==='ssh-disconnected' && args.at(-1).includes('bash /root/cn-remote-build-services.sh')) process.exit(255);
 if(args.at(-1).includes('sha256sum')) console.log(scenario==='checksum' ? 'wrong' : fs.readFileSync(root+'/digest','utf8'));
} else if(cmd==='scp') {
 const source=args.at(-2);
 if(source.endsWith('cn-remote-build-services.sh')) {
  if(fs.readFileSync(source,'utf8')!=='# snapshot A\\n') process.exit(51);
 }
} else if(cmd==='helm') {
 if(args[0]==='get') console.log('{}');
 if(args[0]==='template' || args[0]==='upgrade') {
  if(fs.readFileSync(args[2]+'/values.yaml','utf8')!=='revision: A\\n') process.exit(52);
 }
} else if(cmd==='kubectl') {
 if(args[0]==='get') console.log('registry/image:existing');
 if(args[0]==='diff' && scenario==='edit') fs.appendFileSync(repo+'/source.txt','local edit');
 if(args[0]==='diff') process.exit(scenario==='already-applied' ? 0 : 1);
} else if(cmd==='sleep') {
} else if(cmd!=='curl') process.exit(53);
`,
    { mode: 0o755 }
  );
  for (const cmd of ["aliyun", "node", "ssh", "scp", "helm", "kubectl", "curl", "sleep"])
    symlinkSync(mock, join(bin, cmd));
  const result = spawnSync(
    "/bin/bash",
    [
      "deploy/deploy-cn-services.sh",
      "--full",
      ...(pinned ? ["--tag", revision] : []),
      "--allow-chart-update",
      ...(phase === "all" ? [] : [`--${phase}-only`]),
      "server",
    ],
    {
      cwd: repo,
      encoding: "utf8",
      timeout: 20000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        QA_ROOT: root,
        QA_REPO: repo,
        QA_FUTURE: future,
        QA_SCENARIO: scenario,
        CN_RELEASE_COORDINATED: scenario === "checkpoint" ? "1" : "0",
      },
    }
  );
  assert.equal(result.error, undefined);
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
  const upgrades = calls.filter((c) => c.cmd === "helm" && c.args[0] === "upgrade");
  if (phase === "deploy") {
    assert.equal(
      calls.some((c) => c.cmd === "aliyun" || c.cmd === "scp"),
      false
    );
    const chart = calls.find((c) => c.cmd === "helm" && c.args[0] === "template").args[2];
    assert.equal(existsSync(chart), false, "chart snapshot cleaned up");
    return { result, upgrades, repo, revision, calls };
  }
  if (scenario === "start-rejected" || scenario === "reuse-existing" || scenario === "ssh-blocked") return { result, upgrades, calls };
  const captured = join(root, "captured");
  assert.equal(readFileSync(join(captured, "source.txt"), "utf8"), "A");
  assert.equal(
    readFileSync(join(captured, ".fizzdragon-source-revision"), "utf8").trim(),
    revision
  );
  assert.equal(existsSync(join(captured, "untracked.txt")), false);
  assert.equal(existsSync(join(captured, ".env.private")), false);
  const archive = calls.find((c) => c.cmd === "node" && c.args[1] === "put").args[2];
  assert.equal(existsSync(archive), false, "private archive cleaned up");
  return { result, upgrades, repo, revision, calls };
}
test("normal selective release uses committed source, build script and chart", (t) => {
  const { result, upgrades, revision } = run(t, "normal");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upgrades.length, 1);
  assert.ok(upgrades[0].args.includes("server.image.tag=" + revision));
  assert.ok(upgrades[0].args.includes("web.image.tag=existing"));
});
test("HEAD advance during startup cannot change build-only source", (t) => {
  const { result, upgrades } = run(t, "advance", "build");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upgrades.length, 0);
});
for (const scenario of ["checksum"])
  test("rejects release after " + scenario, (t) => {
    const { result, upgrades } = run(t, scenario);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(upgrades.length, 0);
    assert.match(result.stderr, scenario === "checksum" ? /checksum mismatch/ : /checkout changed/);
  });

test("deploy-only preserves selective release without rebuilding", (t) => {
  const { result, upgrades, revision } = run(t, "normal", "deploy");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upgrades.length, 1);
  assert.ok(upgrades[0].args.includes("server.image.tag=" + revision));
});

test("explicit revision survives a later checkout commit", (t) => {
  const { result, upgrades, revision } = run(t, "advance", "all", true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upgrades.length, 1);
  assert.ok(upgrades[0].args.includes("server.image.tag=" + revision));
});
test("missing image prevents Helm mutation", (t) => {
  const { result, upgrades } = run(t, "missing-image");
  assert.notEqual(result.status, 0);
  assert.equal(upgrades.length, 0);
});

for (const scenario of ["advance", "edit", "script-edit"]) {
  test("isolated CN snapshot survives " + scenario, (t) => {
    const { result, upgrades } = run(t, scenario);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(upgrades.length, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /MUST_NOT_EXECUTE/);
  });
}

test("coordinated deployment checks new source immediately before Helm", (t) => {
  const { result, upgrades } = run(t, "checkpoint", "deploy");
  assert.equal(result.status, 75, result.stdout + result.stderr);
  assert.equal(upgrades.length, 0);
});

test("waits for a previous asynchronous stop before starting ECS", (t) => {
  const { result, calls } = run(t, "stopping", "build");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const ecs = calls.filter((c) => c.cmd === "aliyun").map((c) => c.args[1]);
  assert.deepEqual(ecs.slice(0, 4), [
    "DescribeInstanceStatus",
    "DescribeInstanceStatus",
    "StartInstance",
    "DescribeInstanceStatus",
  ]);
  assert.equal(ecs.filter((x) => x === "StartInstance").length, 1);
});
test("reports a rejected ECS start immediately without attempting upload", (t) => {
  const { result, calls, upgrades } = run(t, "start-rejected", "build");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /IncorrectInstanceStatus/);
  assert.equal(upgrades.length, 0);
  assert.equal(
    calls.some((c) => c.cmd === "ssh"),
    false
  );
});

test("an already applied manifest is verified without another Helm upgrade", (t) => {
  const { result, calls, upgrades } = run(t, "already-applied", "deploy");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upgrades.length, 0);
  assert.ok(calls.some(c => c.cmd === "kubectl" && c.args[0] === "rollout"));
});

test("direct build-only reuses another operator's image without starting ECS", (t) => {
  const { result, calls } = run(t, "reuse-existing", "build");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls.some(c => c.cmd === "aliyun" && c.args[1] === "StartInstance"), false);
  assert.equal(calls.some(c => c.cmd === "ssh"), false);
  assert.match(result.stdout, /reusing verified CN/);
});

test("direct CN deployment restores desired reused images without rebuilding", (t) => {
  const { result, calls, upgrades } = run(t, "reuse-existing", "all");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(upgrades.length, 1);
  assert.equal(calls.some(c => c.cmd === "ssh"), false);
});

test("build uploads only newly acquired credentials from its private release directory", (t) => {
  const { result, calls } = run(t, "normal", "build");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const uploads = calls.filter((c) => c.cmd === "scp" && c.args.some((a) => /\/credentials\/acr-/.test(a)));
  assert.equal(uploads.length, 2);
  assert.equal(calls.some((c) => c.cmd === "scp" && c.args.some((a) => a.includes(".fizzdragon-cn/acr-"))), false);
});
test("failed token refresh prevents credential upload and deployment", (t) => {
  const { result, calls, upgrades } = run(t, "auth-failure");
  assert.notEqual(result.status, 0);
  assert.equal(upgrades.length, 0);
  assert.equal(calls.some((c) => c.cmd === "scp"), false);
});


test("known SSH allowlist mismatch stops before starting builder", (t) => {
  const { result, calls, upgrades } = run(t, "ssh-blocked", "build");
  assert.equal(result.status, 2);
  assert.equal(upgrades.length, 0);
  assert.equal(calls.some(c => c.cmd === "aliyun" && c.args[1] === "StartInstance"), false);
  assert.equal(calls.some(c => c.cmd === "ssh" || c.cmd === "scp"), false);
});


test("SSH build disconnect preserves failure and prevents Helm deployment", (t) => {
  const { result, upgrades } = run(t, "ssh-disconnected");
  assert.equal(result.status, 255);
  assert.equal(upgrades.length, 0);
  assert.doesNotMatch(result.stdout, /images built and pushed/);
});
