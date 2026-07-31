import { hostname } from "node:os";

import { VersioningBehavior } from "@temporalio/common";
import { loadClientConnectConfig } from "@temporalio/envconfig";
import { NativeConnection, Runtime, Worker } from "@temporalio/worker";

import { loadAgentWorkerConfig } from "../config/env.js";
import { closeRuntimeDependencies, initializeRuntimeDependencies } from "./dependencies.js";
import { agentTaskQueues } from "./task-queues.js";
import { agentActivityRegistrations, temporalWorkflowRegistration } from "./worker-registration.js";
import { WorkerHealthServer } from "./worker-health.js";

const config = loadAgentWorkerConfig();
const temporalEnvironment = loadClientConnectConfig({ disableFile: true });

if (temporalEnvironment.connectionOptions.address !== config.temporal.address) {
  throw new Error("Temporal address configuration is inconsistent");
}
if (temporalEnvironment.namespace && temporalEnvironment.namespace !== config.temporal.namespace) {
  throw new Error("Temporal namespace configuration is inconsistent");
}

const runtimeDependencies = initializeRuntimeDependencies(config);
await runtimeDependencies.assertReady();

Runtime.install({
  telemetryOptions: {
    metrics: {
      prometheus: {
        bindAddress: config.metricsBindAddress,
        countersTotalSuffix: true,
        unitSuffix: true,
        useSecondsForDurations: true,
      },
    },
  },
});

const connection = await NativeConnection.connect(temporalEnvironment.connectionOptions);

try {
  const queues = agentTaskQueues(config.temporal.taskQueue);
  const sharedWorkerOptions = {
    connection,
    namespace: config.temporal.namespace,
    workerDeploymentOptions: {
      version: {
        deploymentName: config.temporal.deploymentName,
        buildId: config.temporal.buildId,
      },
      useWorkerVersioning: true,
      defaultVersioningBehavior: VersioningBehavior.PINNED,
    },
    // Temporal delivers remote Activity cancellation through heartbeat
    // responses. Keep every lane below the product's one-second cancellation
    // control-plane SLO.
    maxHeartbeatThrottleInterval: "1 second",
    shutdownGraceTime: "2 minutes",
    shutdownForceTime: "3 minutes",
  } as const;

  const workers = {
    workflow: await Worker.create({
      ...sharedWorkerOptions,
      taskQueue: queues.workflow,
      ...temporalWorkflowRegistration({ nodeEnv: config.nodeEnv }),
      identity: workerIdentity("workflow"),
      maxConcurrentWorkflowTaskExecutions: config.temporal.maxConcurrentWorkflows,
    }),
    control: await Worker.create({
      ...sharedWorkerOptions,
      taskQueue: queues.control,
      activities: agentActivityRegistrations.control,
      identity: workerIdentity("control"),
      maxConcurrentActivityTaskExecutions: config.temporal.activityConcurrency.control,
    }),
    inference: await Worker.create({
      ...sharedWorkerOptions,
      taskQueue: queues.inference,
      activities: agentActivityRegistrations.inference,
      identity: workerIdentity("inference"),
      maxConcurrentActivityTaskExecutions: config.temporal.activityConcurrency.inference,
    }),
    tool: await Worker.create({
      ...sharedWorkerOptions,
      taskQueue: queues.tool,
      activities: agentActivityRegistrations.tool,
      identity: workerIdentity("tool"),
      maxConcurrentActivityTaskExecutions: config.temporal.activityConcurrency.tool,
    }),
    lifecycle: await Worker.create({
      ...sharedWorkerOptions,
      taskQueue: queues.lifecycle,
      activities: agentActivityRegistrations.lifecycle,
      identity: workerIdentity("lifecycle"),
      maxConcurrentActivityTaskExecutions: config.temporal.activityConcurrency.lifecycle,
    }),
    cleanup: await Worker.create({
      ...sharedWorkerOptions,
      taskQueue: queues.cleanup,
      activities: agentActivityRegistrations.cleanup,
      identity: workerIdentity("cleanup"),
      maxConcurrentActivityTaskExecutions: config.temporal.activityConcurrency.cleanup,
    }),
    document: await Worker.create({
      ...sharedWorkerOptions,
      taskQueue: queues.document,
      ...temporalWorkflowRegistration({ nodeEnv: config.nodeEnv }),
      activities: agentActivityRegistrations.document,
      identity: workerIdentity("document"),
      maxConcurrentWorkflowTaskExecutions: config.temporal.maxConcurrentDocumentWorkflows,
      maxConcurrentActivityTaskExecutions: config.temporal.activityConcurrency.document,
    }),
  };

  const healthServer = new WorkerHealthServer({
    ...config.health,
    workers,
  });
  const workerRuns = Object.values(workers).map((worker) => worker.run());
  await healthServer.start();
  try {
    await Promise.all(workerRuns);
  } finally {
    for (const worker of Object.values(workers)) worker.shutdown();
    await Promise.allSettled(workerRuns);
    await healthServer.stop();
  }
} finally {
  try {
    await closeRuntimeDependencies();
  } finally {
    await connection.close();
  }
}

function workerIdentity(lane: string): string {
  return `${config.temporal.buildId}:${lane}:${process.pid}@${hostname()}`;
}
