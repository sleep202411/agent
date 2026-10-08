import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./diagnose-com-server.mjs", import.meta.url));
for (const args of [[], ["a".repeat(40)], ["a".repeat(40), "aks-fizzdragon-com"]]) {
  test(`retired diagnostic rejects ${JSON.stringify(args)} without invoking kubectl`, () => {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, PATH: "/nonexistent" },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /retired.*deploy\/deploy-com\.sh --check/);
    assert.doesNotMatch(result.stderr, /ENOENT|command not found|Traceback/);
  });
}
