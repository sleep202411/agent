import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function run(args, stopAtConfig = false) {
  const dir = mkdtempSync(join(tmpdir(), "release-target-"));
  try {
    const mobile = join(dir, "apps/mobile");
    mkdirSync(join(mobile, "scripts"), { recursive: true });
    copyFileSync(
      new URL("./build-release.sh", import.meta.url),
      join(mobile, "scripts/build-release.sh")
    );
    writeFileSync(
      join(mobile, "app.config.js"),
      "module.exports = () => ({version:'fixture',ios:{buildNumber:'1'}});"
    );
    // Valid-target tests stop at configuration, before any native command.
    writeFileSync(
      join(mobile, "fixture.env"),
      'touch "$FIXTURE_MARKER"\n' + (stopAtConfig ? "exit 73\n" : "")
    );
    const marker = join(dir, "config-read");
    const result = spawnSync("bash", [join(mobile, "scripts/build-release.sh"), ...args], {
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        FD_RELEASE_ENV: join(mobile, "fixture.env"),
        FD_OUT_DIR: join(dir, "out"),
        FD_ANDROID_SDK: join(dir, "sdk"),
        FIXTURE_MARKER: marker,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    return {
      ...result,
      configRead: existsSync(marker),
      outputCreated: existsSync(join(dir, "out")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const args of [
  ["gloabl", "android"],
  ["cn", "andriod"],
  [],
  ["global"],
  ["global", "android", "extra"],
]) {
  test(`reject invalid target before configuration: ${JSON.stringify(args)}`, () => {
    const result = run(args, args.length === 3);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /usage:/i);
    assert.equal(result.configRead, false);
    assert.equal(result.outputCreated, false);
    assert.doesNotMatch(result.stdout, /DONE/);
  });
}
for (const region of ["global", "cn", "all"]) {
  for (const platform of ["ios", "android", "all"]) {
    test(`accept supported target ${region}/${platform}`, () => {
      const result = run([region, platform], true);
      assert.equal(result.status, 73, result.stdout + result.stderr);
      assert.equal(result.configRead, true);
    });
  }
}
