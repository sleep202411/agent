import { join } from "node:path";
import {
  BuildFreshnessMonitor,
  StaleRuntimeCodeError,
  resolveBuildTargets,
  type BuildFreshnessSnapshot,
} from "./build-freshness.js";
import { loadRuntimeProcessConfig, type RuntimeProcessConfig } from "./config.js";
import { loadRuntimeDotEnv } from "./runtime-env.js";
import { writeRuntimeLog } from "./runtime-logger.js";
import { resolveRuntimePaths, type RuntimePaths } from "./runtime-paths.js";
import type { RuntimeWorkerRole } from "./runtime-role.js";

export interface WorkerBootstrap {
  paths: RuntimePaths;
  processConfig: RuntimeProcessConfig;
  freshness: BuildFreshnessMonitor;
}

/**
 * Everything both worker entrypoints must do before they are allowed to touch
 * Temporal, in one place and in one order:
 *
 * 1. load this app's own `.env`, so the documented bare `node dist/worker-*.js`
 *    works without a `--env-file` flag;
 * 2. refuse to start when the code on disk is newer than the build that would
 *    be loaded — a stale worker silently measuring pre-fix modules is how a
 *    false "verified" result gets produced;
 * 3. keep watching for the same conditions, because "rebuilt but never
 *    restarted" can only become true after startup.
 */
export function bootstrapWorker(role: RuntimeWorkerRole, moduleUrl: string): WorkerBootstrap {
  const paths = resolveRuntimePaths(moduleUrl);
  const dotEnv = loadRuntimeDotEnv({ path: join(paths.appRoot, ".env") });
  writeRuntimeLog(role, "INFO", "Runtime environment file resolved.", {
    path: dotEnv.path,
    loaded: dotEnv.loaded,
    applied: dotEnv.applied,
    ignoredBecauseAlreadySet: dotEnv.ignored,
  });

  const freshness = new BuildFreshnessMonitor(resolveBuildTargets(paths), {
    onChange: (snapshot) => reportFreshnessChange(role, snapshot),
  });
  try {
    const report = freshness.verifyOrThrow();
    writeRuntimeLog(role, "INFO", "Runtime code freshness verified.", {
      executionMode: paths.mode,
      verified: report.verified,
      skippedNoSourceTree: report.skipped,
    });
  } catch (error) {
    if (error instanceof StaleRuntimeCodeError) {
      writeRuntimeLog(role, "ERROR", "Refusing to start on stale runtime code.", {
        executionMode: paths.mode,
        issues: error.issues.map((issue) => `[${issue.kind}] ${issue.message}`),
        rebuild: [...new Set(error.issues.map((issue) => issue.rebuildCommand))],
      });
    }
    throw error;
  }

  return {
    paths,
    processConfig: loadRuntimeProcessConfig(role),
    freshness,
  };
}

function reportFreshnessChange(role: RuntimeWorkerRole, snapshot: BuildFreshnessSnapshot): void {
  if (snapshot.stale) {
    writeRuntimeLog(role, "ERROR", "Runtime code is stale; this worker is no longer ready.", {
      issues: snapshot.reasons,
    });
    return;
  }
  writeRuntimeLog(role, "INFO", "Runtime code matches the sources on disk again.");
}
