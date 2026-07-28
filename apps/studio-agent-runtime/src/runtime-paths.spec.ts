import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveRuntimePaths, resolveWorkflowSource } from "./runtime-paths.js";

describe("runtime paths", () => {
  it("derives compiled mode and the workspace layout from a dist entrypoint", () => {
    const paths = resolveRuntimePaths(
      pathToFileURL("/repo/apps/studio-agent-runtime/dist/worker-control.js").href
    );

    expect(paths.mode).toBe("compiled");
    expect(paths.appRoot).toBe("/repo/apps/studio-agent-runtime");
    expect(paths.repoRoot).toBe("/repo");
    expect(paths.sharedArtifactDir).toBe("/repo/packages/shared/dist");
    expect(paths.sharedSourceDir).toBe("/repo/packages/shared/src");
  });

  it("derives source mode from a TypeScript entrypoint", () => {
    const paths = resolveRuntimePaths(
      pathToFileURL("/repo/apps/studio-agent-runtime/src/worker-control.ts").href
    );

    expect(paths.mode).toBe("source");
    expect(paths.appRoot).toBe("/repo/apps/studio-agent-runtime");
  });

  it("loads the precompiled bundle for compiled output and never bundles at startup", () => {
    const paths = resolveRuntimePaths(
      pathToFileURL("/repo/apps/studio-agent-runtime/dist/worker-control.js").href
    );

    expect(resolveWorkflowSource(paths, () => true)).toEqual({
      kind: "bundle",
      codePath: "/repo/apps/studio-agent-runtime/dist/studio-agent-workflow-bundle.js",
    });
  });

  it("names the build command instead of failing obscurely when the bundle is missing", () => {
    const paths = resolveRuntimePaths(
      pathToFileURL("/repo/apps/studio-agent-runtime/dist/worker-control.js").href
    );

    expect(() => resolveWorkflowSource(paths, () => false)).toThrow(
      /npm run build -w studio-agent-runtime/
    );
  });

  it("bundles from TypeScript in source mode, which is what makes dev:control runnable", () => {
    const paths = resolveRuntimePaths(
      pathToFileURL("/repo/apps/studio-agent-runtime/src/worker-control.ts").href
    );

    expect(resolveWorkflowSource(paths, () => true)).toEqual({
      kind: "source",
      workflowsPath: "/repo/apps/studio-agent-runtime/src/workflows.ts",
    });
  });
});
