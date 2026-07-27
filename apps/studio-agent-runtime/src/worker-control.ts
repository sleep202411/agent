import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import { loadRuntimeProcessConfig, loadTemporalRuntimeConfig } from "./config.js";
import { installTemporalRuntimeLogger } from "./runtime-logger.js";
import { connectTemporal } from "./temporal-connection.js";
import { createWorkerDeploymentOptions } from "./worker-deployment.js";
import { runWorkerProcess } from "./worker-process.js";

const processConfig = loadRuntimeProcessConfig();
const config = loadTemporalRuntimeConfig();
installTemporalRuntimeLogger("control", processConfig.metricsBindAddress);
const connection = await connectTemporal(config);
try {
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.controlTaskQueue,
    identity: `studio-agent-control:${hostname()}:${process.pid}`,
    workerDeploymentOptions: createWorkerDeploymentOptions(config, processConfig),
    workflowBundle: {
      codePath: fileURLToPath(new URL("./studio-agent-workflow-bundle.js", import.meta.url)),
    },
    maxConcurrentWorkflowTaskExecutions: config.controlMaxConcurrentWorkflowTasks,
    maxConcurrentWorkflowTaskPolls: config.controlMaxConcurrentWorkflowPolls,
    shutdownGraceTime: config.shutdownGraceMs,
    shutdownForceTime: config.shutdownForceMs,
  });
  await runWorkerProcess({
    role: "control",
    worker,
    processConfig,
  });
} finally {
  await connection.close();
}
