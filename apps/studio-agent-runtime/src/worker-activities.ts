import { hostname } from "node:os";
import { Worker } from "@temporalio/worker";
import { createStudioAgentActivities } from "./activities.js";
import {
  loadRuntimeGatewayConfig,
  loadRuntimeModelConfig,
  loadRuntimeProcessConfig,
  loadTemporalRuntimeConfig,
} from "./config.js";
import { RuntimeGatewayClient } from "./gateway-client.js";
import { installTemporalRuntimeLogger } from "./runtime-logger.js";
import { connectTemporal } from "./temporal-connection.js";
import { createWorkerDeploymentOptions } from "./worker-deployment.js";
import { runWorkerProcess } from "./worker-process.js";

const processConfig = loadRuntimeProcessConfig();
const temporalConfig = loadTemporalRuntimeConfig();
installTemporalRuntimeLogger("activities", processConfig.metricsBindAddress);
const gateway = new RuntimeGatewayClient(loadRuntimeGatewayConfig());
const activities = createStudioAgentActivities({
  gateway,
  modelConfig: loadRuntimeModelConfig(),
});
const connection = await connectTemporal(temporalConfig);
try {
  const worker = await Worker.create({
    connection,
    namespace: temporalConfig.namespace,
    taskQueue: temporalConfig.activityTaskQueue,
    identity: `studio-agent-activities:${hostname()}:${process.pid}`,
    workerDeploymentOptions: createWorkerDeploymentOptions(temporalConfig, processConfig),
    activities,
    maxConcurrentActivityTaskExecutions: temporalConfig.activityMaxConcurrentTasks,
    maxConcurrentActivityTaskPolls: temporalConfig.activityMaxConcurrentPolls,
    shutdownGraceTime: temporalConfig.shutdownGraceMs,
    shutdownForceTime: temporalConfig.shutdownForceMs,
  });
  await runWorkerProcess({
    role: "activities",
    worker,
    processConfig,
  });
} finally {
  await connection.close();
}
