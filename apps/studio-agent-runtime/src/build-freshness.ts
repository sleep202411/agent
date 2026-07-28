import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { RuntimePaths } from "./runtime-paths.js";

const SOURCE_EXTENSION = ".ts";
const ARTIFACT_EXTENSION = ".js";
const IGNORED_SOURCE_SUFFIXES = [".spec.ts", ".test.ts", ".d.ts"] as const;
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".turbo"]);

export const BUILD_FRESHNESS_POLL_INTERVAL_MS = 5_000;

export interface BuildTarget {
  /**
   * Workspace name, used verbatim in the rebuild instructions and as the key of
   * the drift baseline, so it must be unique within one set of targets.
   */
  name: string;
  sourceDir: string;
  artifactDir: string;
  /** command that rebuilds this target from the repository root */
  rebuildCommand: string;
}

export type BuildFreshnessIssueKind = "missing-artifacts" | "unbuilt-sources" | "artifact-drift";

export interface BuildFreshnessIssue {
  target: string;
  kind: BuildFreshnessIssueKind;
  message: string;
  rebuildCommand: string;
}

export interface BuildFreshnessReport {
  stale: boolean;
  issues: readonly BuildFreshnessIssue[];
  /** targets whose sources were compared against their build output */
  verified: readonly string[];
  /** targets with no source tree on disk (the production image ships only build output) */
  skipped: readonly string[];
  /** per-target build-output fingerprint, used as the next drift baseline */
  fingerprints: Readonly<Record<string, string>>;
}

interface TreeScan {
  present: boolean;
  fileCount: number;
  newestMtimeMs: number;
  newestRelativePath: string | undefined;
  fingerprint: string;
}

/**
 * Compares the code this process can load against the code on disk.
 *
 * Two independent failures produced a false "verified" result in this
 * repository, so both are reported:
 *
 * - `unbuilt-sources`: a source file is newer than the build output that is
 *   actually loaded, i.e. an edit was never compiled.
 * - `artifact-drift`: the build output changed after this process loaded it,
 *   i.e. somebody rebuilt and the running process is now the old code.
 *
 * Everything is derived from `stat`, so the check is cheap enough to run on an
 * interval for the whole life of the process.
 */
export function inspectBuildFreshness(
  targets: readonly BuildTarget[],
  baseline: Readonly<Record<string, string>> = {}
): BuildFreshnessReport {
  const issues: BuildFreshnessIssue[] = [];
  const verified: string[] = [];
  const skipped: string[] = [];
  const fingerprints: Record<string, string> = {};

  for (const target of targets) {
    const sources = scanTree(target.sourceDir, SOURCE_EXTENSION, isIgnoredSource);
    const artifacts = scanTree(target.artifactDir, ARTIFACT_EXTENSION);
    fingerprints[target.name] = artifacts.fingerprint;

    if (!artifacts.present || artifacts.fileCount === 0) {
      issues.push({
        target: target.name,
        kind: "missing-artifacts",
        message: `${target.name} has no build output in ${target.artifactDir}.`,
        rebuildCommand: target.rebuildCommand,
      });
      continue;
    }

    const previousFingerprint = baseline[target.name];
    if (previousFingerprint !== undefined && previousFingerprint !== artifacts.fingerprint) {
      issues.push({
        target: target.name,
        kind: "artifact-drift",
        message: `${target.name} was rebuilt after this process loaded it; the running code is the previous build. Restart the worker.`,
        rebuildCommand: target.rebuildCommand,
      });
    }

    if (!sources.present) {
      skipped.push(target.name);
      continue;
    }
    verified.push(target.name);
    if (sources.newestMtimeMs > artifacts.newestMtimeMs) {
      issues.push({
        target: target.name,
        kind: "unbuilt-sources",
        message: `${target.name}/src/${sources.newestRelativePath ?? "?"} was modified ${formatAge(
          sources.newestMtimeMs - artifacts.newestMtimeMs
        )} after the newest file in ${target.artifactDir}; the loaded build does not contain that change.`,
        rebuildCommand: target.rebuildCommand,
      });
    }
  }

  return {
    stale: issues.length > 0,
    issues,
    verified,
    skipped,
    fingerprints,
  };
}

/**
 * The build targets whose output this process actually loads.
 *
 * `compiled` mode loads this app's `dist` and `@repo/shared`'s `dist`. `source`
 * mode (tsx) compiles this app's TypeScript on the fly — nothing to verify —
 * but still loads `@repo/shared` from its `dist`, which is exactly the hop that
 * silently went stale.
 */
export function resolveBuildTargets(paths: RuntimePaths): BuildTarget[] {
  const shared: BuildTarget = {
    name: "@repo/shared",
    sourceDir: paths.sharedSourceDir,
    artifactDir: paths.sharedArtifactDir,
    rebuildCommand: "npm run build -w @repo/shared",
  };
  if (paths.mode === "source") {
    return [shared];
  }
  return [
    {
      name: "studio-agent-runtime",
      sourceDir: paths.runtimeSourceDir,
      artifactDir: paths.runtimeArtifactDir,
      rebuildCommand: "npm run build -w studio-agent-runtime",
    },
    shared,
  ];
}

export class StaleRuntimeCodeError extends Error {
  readonly issues: readonly BuildFreshnessIssue[];

  constructor(issues: readonly BuildFreshnessIssue[]) {
    super(formatStaleMessage(issues));
    this.name = "StaleRuntimeCodeError";
    this.issues = issues;
  }
}

export function formatStaleMessage(issues: readonly BuildFreshnessIssue[]): string {
  const commands = [...new Set(issues.map((issue) => issue.rebuildCommand))];
  return [
    "Refusing to run stale code.",
    ...issues.map((issue) => `  - [${issue.kind}] ${issue.message}`),
    "Rebuild, then restart:",
    ...commands.map((command) => `  ${command}`),
  ].join("\n");
}

export interface BuildFreshnessSnapshot {
  stale: boolean;
  reasons: readonly string[];
}

/**
 * Startup gate plus a live watch for the same conditions.
 *
 * The startup gate refuses to boot on stale code, which is what makes a
 * measurement against pre-fix modules impossible. The watch keeps reporting
 * after boot, because "rebuilt but never restarted" only becomes true while the
 * process is already running.
 */
export class BuildFreshnessMonitor {
  readonly #targets: readonly BuildTarget[];
  readonly #inspect: typeof inspectBuildFreshness;
  readonly #onChange: ((snapshot: BuildFreshnessSnapshot) => void) | undefined;
  #baseline: Readonly<Record<string, string>> = {};
  #snapshot: BuildFreshnessSnapshot = { stale: false, reasons: [] };
  #timer: NodeJS.Timeout | undefined;

  constructor(
    targets: readonly BuildTarget[],
    options: {
      onChange?: (snapshot: BuildFreshnessSnapshot) => void;
      inspect?: typeof inspectBuildFreshness;
    } = {}
  ) {
    this.#targets = targets;
    this.#inspect = options.inspect ?? inspectBuildFreshness;
    this.#onChange = options.onChange;
  }

  /**
   * Throws when the process would run code that no longer matches its sources.
   * Also captures the drift baseline for the rest of the process lifetime.
   */
  verifyOrThrow(): BuildFreshnessReport {
    const report = this.#inspect(this.#targets, {});
    this.#baseline = report.fingerprints;
    this.#snapshot = toSnapshot(report);
    if (report.stale) {
      throw new StaleRuntimeCodeError(report.issues);
    }
    return report;
  }

  tick(): BuildFreshnessSnapshot {
    const report = this.#inspect(this.#targets, this.#baseline);
    const next = toSnapshot(report);
    const changed =
      next.stale !== this.#snapshot.stale ||
      next.reasons.join("\n") !== this.#snapshot.reasons.join("\n");
    this.#snapshot = next;
    if (changed) {
      this.#onChange?.(next);
    }
    return next;
  }

  start(intervalMs: number = BUILD_FRESHNESS_POLL_INTERVAL_MS): void {
    if (this.#timer) {
      return;
    }
    this.#timer = setInterval(() => this.tick(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (!this.#timer) {
      return;
    }
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  snapshot(): BuildFreshnessSnapshot {
    return this.#snapshot;
  }
}

function toSnapshot(report: BuildFreshnessReport): BuildFreshnessSnapshot {
  return {
    stale: report.stale,
    reasons: report.issues.map((issue) => `[${issue.kind}] ${issue.message}`),
  };
}

function scanTree(
  directory: string,
  extension: string,
  isIgnored: (relativePath: string) => boolean = () => false
): TreeScan {
  const entries: string[] = [];
  let newestMtimeMs = 0;
  let newestRelativePath: string | undefined;
  const hash = createHash("sha256");

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          walk(join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(extension)) {
        continue;
      }
      const absolute = join(current, entry.name);
      const relativePath = relative(directory, absolute);
      if (isIgnored(relativePath)) {
        continue;
      }
      const stats = statSync(absolute);
      entries.push(relativePath);
      hash.update(`${relativePath}:${stats.size}:${stats.mtimeMs}\n`);
      if (stats.mtimeMs > newestMtimeMs) {
        newestMtimeMs = stats.mtimeMs;
        newestRelativePath = relativePath;
      }
    }
  };

  try {
    walk(directory);
  } catch (error) {
    if (isMissingDirectory(error)) {
      return {
        present: false,
        fileCount: 0,
        newestMtimeMs: 0,
        newestRelativePath: undefined,
        fingerprint: "absent",
      };
    }
    throw error;
  }

  return {
    present: true,
    fileCount: entries.length,
    newestMtimeMs,
    newestRelativePath,
    fingerprint: hash.digest("hex").slice(0, 16),
  };
}

function isIgnoredSource(relativePath: string): boolean {
  return IGNORED_SOURCE_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));
}

function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function formatAge(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${Math.max(1, Math.round(milliseconds))}ms`;
  }
  if (milliseconds < 60_000) {
    return `${Math.round(milliseconds / 1_000)}s`;
  }
  if (milliseconds < 3_600_000) {
    return `${Math.round(milliseconds / 60_000)}m`;
  }
  return `${Math.round(milliseconds / 3_600_000)}h`;
}
