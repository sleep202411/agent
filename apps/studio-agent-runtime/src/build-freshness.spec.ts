import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BuildFreshnessMonitor,
  StaleRuntimeCodeError,
  inspectBuildFreshness,
  resolveBuildTargets,
  type BuildTarget,
} from "./build-freshness.js";
import { resolveRuntimePaths } from "./runtime-paths.js";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("build freshness", () => {
  it("accepts a build that is newer than its sources", () => {
    const target = buildTarget({
      sources: { "config.ts": 1_000 },
      artifacts: { "config.js": 2_000 },
    });

    const report = inspectBuildFreshness([target]);

    expect(report.stale).toBe(false);
    expect(report.verified).toEqual([target.name]);
  });

  it("reports a source edit that was never compiled", () => {
    const target = buildTarget({
      sources: { "story-agent.ts": 5_000 },
      artifacts: { "story-agent.js": 2_000 },
    });

    const report = inspectBuildFreshness([target]);

    expect(report.stale).toBe(true);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.kind).toBe("unbuilt-sources");
    expect(report.issues[0]?.message).toContain("story-agent.ts");
    expect(report.issues[0]?.rebuildCommand).toBe(target.rebuildCommand);
  });

  it("ignores test files, which never reach the build output", () => {
    const target = buildTarget({
      sources: { "config.ts": 1_000, "config.spec.ts": 9_000 },
      artifacts: { "config.js": 2_000 },
    });

    expect(inspectBuildFreshness([target]).stale).toBe(false);
  });

  it("reports a rebuild that happened after the process loaded the code", () => {
    const target = buildTarget({
      sources: { "config.ts": 1_000 },
      artifacts: { "config.js": 2_000 },
    });
    const baseline = inspectBuildFreshness([target]).fingerprints;

    writeArtifact(target, "config.js", "rebuilt", 3_000);
    const report = inspectBuildFreshness([target], baseline);

    expect(report.stale).toBe(true);
    expect(report.issues[0]?.kind).toBe("artifact-drift");
    expect(report.issues[0]?.message).toContain("Restart the worker");
  });

  it("treats a missing build output as stale, not as an empty success", () => {
    const target = buildTarget({ sources: { "config.ts": 1_000 }, artifacts: {} });

    const report = inspectBuildFreshness([target]);

    expect(report.stale).toBe(true);
    expect(report.issues[0]?.kind).toBe("missing-artifacts");
  });

  it("skips the source comparison in an image that ships only build output", () => {
    const target = buildTarget({ artifacts: { "config.js": 2_000 } });

    const report = inspectBuildFreshness([target]);

    expect(report.stale).toBe(false);
    expect(report.skipped).toEqual([target.name]);
    expect(report.verified).toEqual([]);
  });

  it("starts clean in the production image shape, where both targets are build-output only", () => {
    const runtime = buildTarget({
      name: "studio-agent-runtime",
      artifacts: { "worker-control.js": 2_000 },
    });
    const shared = buildTarget({ artifacts: { "studio-agent.js": 2_000 } });
    const monitor = new BuildFreshnessMonitor([runtime, shared]);

    const report = monitor.verifyOrThrow();

    expect(report.stale).toBe(false);
    expect(report.skipped).toHaveLength(2);
    expect(monitor.tick().stale).toBe(false);
  });

  it("refuses to start on stale code and names the rebuild command", () => {
    const target = buildTarget({
      sources: { "studio-agent.ts": 5_000 },
      artifacts: { "studio-agent.js": 1_000 },
    });
    const monitor = new BuildFreshnessMonitor([target]);

    expect(() => monitor.verifyOrThrow()).toThrow(StaleRuntimeCodeError);
    expect(() => monitor.verifyOrThrow()).toThrow(new RegExp(target.rebuildCommand));
  });

  it("goes stale after startup when the loaded build is replaced", () => {
    const target = buildTarget({
      sources: { "config.ts": 1_000 },
      artifacts: { "config.js": 2_000 },
    });
    const changes: boolean[] = [];
    const monitor = new BuildFreshnessMonitor([target], {
      onChange: (snapshot) => changes.push(snapshot.stale),
    });

    monitor.verifyOrThrow();
    expect(monitor.snapshot().stale).toBe(false);

    writeArtifact(target, "config.js", "rebuilt", 4_000);
    monitor.tick();

    expect(monitor.snapshot().stale).toBe(true);
    expect(monitor.snapshot().reasons.join("\n")).toContain("artifact-drift");
    expect(changes).toEqual([true]);
  });

  it("watches @repo/shared in both execution modes and this app only when compiled", () => {
    const compiled = resolveBuildTargets(
      resolveRuntimePaths(
        pathToFileURL("/repo/apps/studio-agent-runtime/dist/worker-control.js").href
      )
    );
    const source = resolveBuildTargets(
      resolveRuntimePaths(
        pathToFileURL("/repo/apps/studio-agent-runtime/src/worker-control.ts").href
      )
    );

    expect(compiled.map((target) => target.name)).toEqual(["studio-agent-runtime", "@repo/shared"]);
    expect(source.map((target) => target.name)).toEqual(["@repo/shared"]);
    expect(source[0]?.artifactDir).toBe("/repo/packages/shared/dist");
  });
});

function buildTarget(input: {
  name?: string;
  sources?: Record<string, number>;
  artifacts?: Record<string, number>;
}): BuildTarget {
  const root = mkdtempSync(join(tmpdir(), "studio-agent-freshness-"));
  created.push(root);
  const target: BuildTarget = {
    name: input.name ?? "@repo/shared",
    sourceDir: join(root, "src"),
    artifactDir: join(root, "dist"),
    rebuildCommand: "npm run build -w @repo/shared",
  };
  if (input.sources) {
    mkdirSync(target.sourceDir, { recursive: true });
    for (const [name, mtimeSeconds] of Object.entries(input.sources)) {
      writeAt(join(target.sourceDir, name), name, mtimeSeconds);
    }
  }
  if (input.artifacts) {
    mkdirSync(target.artifactDir, { recursive: true });
    for (const [name, mtimeSeconds] of Object.entries(input.artifacts)) {
      writeAt(join(target.artifactDir, name), name, mtimeSeconds);
    }
  }
  return target;
}

function writeArtifact(
  target: BuildTarget,
  name: string,
  contents: string,
  mtimeSeconds: number
): void {
  writeAt(join(target.artifactDir, name), contents, mtimeSeconds);
}

function writeAt(path: string, contents: string, mtimeSeconds: number): void {
  writeFileSync(path, contents, "utf8");
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}
