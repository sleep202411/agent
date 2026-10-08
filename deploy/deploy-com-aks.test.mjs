import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./deploy-com-aks.sh", import.meta.url));

for (const args of [[], ["web"], ["all"], ["--resume-build", "a".repeat(40), "web=old-run"]]) {
  test(`retired Azure entrypoint refuses ${args.join(" ") || "an empty request"} without invoking another tool`, () => {
    const result = spawnSync("/bin/bash", [script, ...args], {
      encoding: "utf8",
      env: { PATH: "/nonexistent", FORCE: "1", FD_REGIONAL_LOCK_COM: "old-lock" },
      timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Azure \.com deployment has retired/);
    assert.match(result.stderr, /deploy\/deploy-com\.sh/);
    assert.doesNotMatch(result.stderr, /command not found|Traceback|ArgoCD/);
  });
}
