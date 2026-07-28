import { hostname } from "node:os";
import { Worker } from "@temporalio/worker";
import { createStudioAgentActivities } from "./activities.js";
import { createStudioAgentDeliveryClient } from "./agent-session.js";
import {
  loadRuntimeDeliveryConfig,
  loadRuntimeGatewayConfig,
  loadRuntimeModelConfig,
  loadTemporalRuntimeConfig,
} from "./config.js";
import { RuntimeGatewayClient } from "./gateway-client.js";
import { installTemporalRuntimeLogger } from "./runtime-logger.js";
import { connectTemporal } from "./temporal-connection.js";
import { bootstrapWorker } from "./worker-bootstrap.js";
import { createWorkerDeploymentOptions } from "./worker-deployment.js";
import { runWorkerProcess } from "./worker-process.js";

const { processConfig, freshness } = bootstrapWorker("activities", import.meta.url);
const temporalConfig = loadTemporalRuntimeConfig();
installTemporalRuntimeLogger("activities", processConfig.metricsBindAddress);
const gateway = new RuntimeGatewayClient(loadRuntimeGatewayConfig());
// Fails at boot without a complete ABLY_API_KEY. Delivery IS Ably; a worker
// that came up without it would run turns nobody can see.
const delivery = createStudioAgentDeliveryClient(loadRuntimeDeliveryConfig(), (message) =>
  console.error(message)
);
const activities = createStudioAgentActivities({
  gateway,
  modelConfig: loadRuntimeModelConfig(),
  delivery,
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
    freshness,
  });
} finally {
  delivery.close();
  await connection.close();
}
