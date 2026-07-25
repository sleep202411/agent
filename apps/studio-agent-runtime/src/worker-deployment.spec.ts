import { describe, expect, it } from "vitest";
import { createWorkerDeploymentOptions } from "./worker-deployment.js";

describe("createWorkerDeploymentOptions", () => {
  it("uses a stable deployment name and immutable pinned release", () => {
    expect(
      createWorkerDeploymentOptions(
        {
          address: "temporal:7233",
          namespace: "fizzdragon",
          serverName: undefined,
          tls: undefined,
          controlTaskQueue: "studio-agent-control-v1",
          activityTaskQueue: "studio-agent-activities-v1",
          workerDeploymentName: "fizzdragon-studio-agent",
          controlMaxConcurrentWorkflowTasks: 64,
          controlMaxConcurrentWorkflowPolls: 16,
          activityMaxConcurrentTasks: 16,
          activityMaxConcurrentPolls: 8,
          shutdownGraceMs: 30_000,
          shutdownForceMs: 120_000,
        },
        {
          release: "git-0123456789abcdef",
          healthHost: "0.0.0.0",
          healthPort: 3_010,
          metricsBindAddress: "0.0.0.0:9464",
        }
      )
    ).toEqual({
      version: {
        deploymentName: "fizzdragon-studio-agent",
        buildId: "git-0123456789abcdef",
      },
      useWorkerVersioning: true,
      defaultVersioningBehavior: "PINNED",
    });
  });
});
