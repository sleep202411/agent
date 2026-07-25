import type { WorkerDeploymentOptions } from "@temporalio/worker";
import type { RuntimeProcessConfig, TemporalRuntimeConfig } from "./config.js";

/**
 * One stable Worker Deployment contains immutable release versions.
 *
 * PINNED is intentional: a workflow history never migrates to a new bundle
 * implicitly. The Nest start command pins new executions to the release it
 * has verified has both workflow and activity pollers.
 */
export function createWorkerDeploymentOptions(
  temporal: TemporalRuntimeConfig,
  process: RuntimeProcessConfig
): WorkerDeploymentOptions {
  return {
    version: {
      deploymentName: temporal.workerDeploymentName,
      buildId: process.release,
    },
    useWorkerVersioning: true,
    defaultVersioningBehavior: "PINNED",
  };
}
