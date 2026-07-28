import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How this process is executing its own code.
 *
 * `compiled` is the only production shape: `node dist/worker-*.js` loads
 * emitted JavaScript and the precompiled deterministic workflow bundle.
 * `source` exists for the local development loop (`tsx src/worker-*.ts`),
 * where the workflow bundle is produced in-process from TypeScript.
 *
 * The mode is derived from the extension of the loaded module, never from an
 * environment variable: the production image contains no `src` tree and its
 * entrypoint is always `dist/worker-*.js`, so it cannot select `source` by
 * accident or by misconfiguration.
 */
export type RuntimeExecutionMode = "compiled" | "source";

export interface RuntimePaths {
  mode: RuntimeExecutionMode;
  /** `apps/studio-agent-runtime` */
  appRoot: string;
  /** monorepo root; `packages/shared` is resolved from here */
  repoRoot: string;
  /** the directory the running modules were loaded from (`dist` or `src`) */
  entryDir: string;
  runtimeSourceDir: string;
  runtimeArtifactDir: string;
  sharedSourceDir: string;
  sharedArtifactDir: string;
  workflowBundlePath: string;
  workflowsSourcePath: string;
}

export type WorkflowSource =
  | { kind: "bundle"; codePath: string }
  | { kind: "source"; workflowsPath: string };

/**
 * Resolves every path this process needs from the location of the module that
 * is actually running, so a stale-code check and the workflow source can never
 * disagree with what was loaded.
 */
export function resolveRuntimePaths(moduleUrl: string = import.meta.url): RuntimePaths {
  const modulePath = fileURLToPath(moduleUrl);
  const entryDir = dirname(modulePath);
  const appRoot = dirname(entryDir);
  const repoRoot = resolve(appRoot, "..", "..");
  const mode: RuntimeExecutionMode = modulePath.endsWith(".ts") ? "source" : "compiled";
  return {
    mode,
    appRoot,
    repoRoot,
    entryDir,
    runtimeSourceDir: join(appRoot, "src"),
    runtimeArtifactDir: join(appRoot, "dist"),
    sharedSourceDir: join(repoRoot, "packages", "shared", "src"),
    sharedArtifactDir: join(repoRoot, "packages", "shared", "dist"),
    workflowBundlePath: join(appRoot, "dist", "studio-agent-workflow-bundle.js"),
    workflowsSourcePath: join(appRoot, "src", "workflows.ts"),
  };
}

/**
 * Production loads the precompiled bundle and never bundles at startup. A
 * missing bundle is a half-built deployment, so it fails with the command that
 * produces it instead of an opaque module-resolution error from the SDK.
 */
export function resolveWorkflowSource(
  paths: RuntimePaths,
  fileExists: (path: string) => boolean = existsSync
): WorkflowSource {
  if (paths.mode === "source") {
    if (!fileExists(paths.workflowsSourcePath)) {
      throw new Error(`Workflow source is missing at ${paths.workflowsSourcePath}.`);
    }
    return { kind: "source", workflowsPath: paths.workflowsSourcePath };
  }
  if (!fileExists(paths.workflowBundlePath)) {
    throw new Error(
      [
        `The deterministic workflow bundle is missing at ${paths.workflowBundlePath}.`,
        "The control worker never bundles workflow code at startup when running compiled output.",
        "Build it first: npm run build -w studio-agent-runtime",
      ].join("\n")
    );
  }
  return { kind: "bundle", codePath: paths.workflowBundlePath };
}
