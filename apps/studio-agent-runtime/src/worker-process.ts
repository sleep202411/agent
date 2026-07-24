import type { Worker } from "@temporalio/worker";
import type { RuntimeProcessConfig } from "./config.js";
import { RuntimeHealthServer, type RuntimeWorkerRole } from "./health-server.js";
import { writeRuntimeLog } from "./runtime-logger.js";

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGQUIT", "SIGUSR2"];

export async function runWorkerProcess(input: {
  role: RuntimeWorkerRole;
  worker: Worker;
  processConfig: RuntimeProcessConfig;
}): Promise<void> {
  const { role, worker, processConfig } = input;
  const health = new RuntimeHealthServer(role, processConfig);
  health.attachWorker(worker);

  const beginDraining = (signal: NodeJS.Signals): void => {
    health.beginDraining();
    writeRuntimeLog(role, "INFO", "Worker shutdown signal received.", {
      signal,
    });
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>(
    SHUTDOWN_SIGNALS.map((signal) => [signal, () => beginDraining(signal)])
  );

  for (const [signal, handler] of signalHandlers) {
    process.on(signal, handler);
  }

  try {
    await health.listen();
    writeRuntimeLog(role, "INFO", "Worker health endpoint listening.", {
      host: processConfig.healthHost,
      port: processConfig.healthPort,
      release: processConfig.release,
    });
    await worker.run();
    writeRuntimeLog(role, "INFO", "Worker stopped.", {
      state: worker.getState(),
    });
  } catch (error) {
    health.markFailed();
    writeRuntimeLog(role, "ERROR", "Worker process failed.", {
      error: toSafeError(error),
      state: worker.getState(),
    });
    throw error;
  } finally {
    health.beginDraining();
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    await health.close();
  }
}

function toSafeError(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) {
    return { name: "UnknownError" };
  }
  return {
    name: error.name,
    message: error.message.slice(0, 2_000),
  };
}
