import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/cleanup-branches.yml", import.meta.url),
  "utf8"
);
const script = workflow
  .split("          script: |\n")[1]
  .split("\n")
  .map((line) => line.replace(/^            /, ""))
  .join("\n");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("github", "context", "require", "console", script);

for (const mode of [
  "merged",
  "advanced-after-comparison",
  "advanced-before-comparison",
  "unmerged",
]) {
  test(`cleanup: ${mode}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "cleanup-lease-test-"));
    const bare = join(dir, "remote.git");
    const work = join(dir, "work");
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: work,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    try {
      execFileSync("git", ["init", "--bare", bare], { stdio: "ignore" });
      execFileSync("git", ["init", "-b", "main", work], { stdio: "ignore" });
      git("config", "user.name", "Local audit");
      git("config", "user.email", "audit@example.invalid");
      git("commit", "--allow-empty", "-m", "base");
      const checkedSha = git("rev-parse", "HEAD");
      git("remote", "add", "origin", bare);
      git("push", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/feature/example");
      const advance = () => {
        git("commit", "--allow-empty", "-m", "new work");
        git("push", "origin", "HEAD:refs/heads/feature/example");
      };
      const comments = [];
      const heads = [];
      const github = {
        rest: {
          repos: {
            listBranches: async () => ({
              data: [
                { name: "main", commit: { sha: checkedSha } },
                { name: "feature/example", commit: { sha: checkedSha } },
              ],
            }),
            compareCommits: async ({ head }) => {
              heads.push(head);
              if (mode === "advanced-before-comparison") advance();
              const actualSha =
                head === checkedSha
                  ? checkedSha
                  : git("ls-remote", "--heads", "origin", `refs/heads/${head}`).split(/\s+/)[0];
              const status =
                mode === "unmerged" || actualSha !== checkedSha ? "ahead" : "identical";
              if (mode === "advanced-after-comparison") advance();
              return { data: { status } };
            },
          },
          git: {
            deleteRef: async () => {
              git("push", "origin", ":refs/heads/feature/example");
            },
          },
          issues: {
            createComment: async (value) => {
              comments.push(value);
            },
          },
        },
      };
      const realRequire = createRequire(import.meta.url);
      const localRequire = (id) =>
        id === "node:child_process"
          ? {
              execFileSync: (command, args, options) => {
                assert.equal(command, "git");
                return execFileSync(command, args, {
                  ...options,
                  cwd: work,
                  stdio: ["ignore", "pipe", "pipe"],
                });
              },
            }
          : realRequire(id);
      await run(
        github,
        { repo: { owner: "test", repo: "fixture" }, issue: { number: 1 } },
        localRequire,
        { log() {} }
      );
      const remaining = git("ls-remote", "--heads", "origin", "refs/heads/feature/example");
      if (mode === "merged") {
        assert.equal(remaining, "");
        assert.equal(comments.length, 1);
      } else {
        assert.notEqual(remaining, "", "Concurrent or unmerged work must not be deleted");
        assert.equal(comments.length, 0);
      }
      assert.notEqual(git("ls-remote", "--heads", "origin", "refs/heads/main"), "");
      if (mode !== "merged" && mode !== "unmerged")
        assert.equal(heads[0], checkedSha, "Compare the same SHA guarded by deletion");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
