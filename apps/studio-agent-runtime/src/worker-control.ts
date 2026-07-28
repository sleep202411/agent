import { hostname } from "node:os";
import { Worker } from "@temporalio/worker";
import { loadTemporalRuntimeConfig } from "./config.js";
import { installTemporalRuntimeLogger, writeRuntimeLog } from "./runtime-logger.js";
import { resolveWorkflowSource } from "./runtime-paths.js";
import { connectTemporal } from "./temporal-connection.js";
import { bootstrapWorker } from "./worker-bootstrap.js";
import { createWorkerDeploymentOptions } from "./worker-deployment.js";
import { runWorkerProcess } from "./worker-process.js";

const { paths, processConfig, freshness } = bootstrapWorker("control", import.meta.url);
const config = loadTemporalRuntimeConfig();
const workflowSource = resolveWorkflowSource(paths);
if (workflowSource.kind === "source") {
  writeRuntimeLog(
    "control",
    "WARN",
    "Bundling deterministic workflow code from TypeScript at startup. This is the local development entrypoint; compiled output loads the precompiled bundle.",
    { workflowsPath: workflowSource.workflowsPath }
  );
}
installTemporalRuntimeLogger("control", processConfig.metricsBindAddress);
const connection = await connectTemporal(config);
try {
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.controlTaskQueue,
    identity: `studio-agent-control:${hostname()}:${process.pid}`,
    workerDeploymentOptions: createWorkerDeploymentOptions(config, processConfig),
    ...(workflowSource.kind === "bundle"
      ? { workflowBundle: { codePath: workflowSource.codePath } }
      : { workflowsPath: workflowSource.workflowsPath }),
    maxConcurrentWorkflowTaskExecutions: config.controlMaxConcurrentWorkflowTasks,
    maxConcurrentWorkflowTaskPolls: config.controlMaxConcurrentWorkflowPolls,
    shutdownGraceTime: config.shutdownGraceMs,
    shutdownForceTime: config.shutdownForceMs,
  });
  await runWorkerProcess({
    role: "control",
    worker,
    processConfig,
    freshness,
  });
} finally {
  await connection.close();
}
