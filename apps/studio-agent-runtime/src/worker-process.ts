import type { Worker } from "@temporalio/worker";
import type { BuildFreshnessMonitor } from "./build-freshness.js";
import { formatRoleEndpointDefaults, type RuntimeProcessConfig } from "./config.js";
import { RuntimeHealthServer } from "./health-server.js";
import { writeRuntimeLog } from "./runtime-logger.js";
import type { RuntimeWorkerRole } from "./runtime-role.js";

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGQUIT", "SIGUSR2"];

export async function runWorkerProcess(input: {
  role: RuntimeWorkerRole;
  worker: Worker;
  processConfig: RuntimeProcessConfig;
  freshness?: BuildFreshnessMonitor;
}): Promise<void> {
  const { role, worker, processConfig, freshness } = input;
  const health = new RuntimeHealthServer(role, processConfig, freshness);
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
    try {
      await health.listen();
    } catch (error) {
      throw describeHealthBindFailure(error, role, processConfig);
    }
    writeRuntimeLog(role, "INFO", "Worker health endpoint listening.", {
      host: processConfig.healthHost,
      port: processConfig.healthPort,
      release: processConfig.release,
    });
    freshness?.start();
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
    freshness?.stop();
    health.beginDraining();
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    await health.close();
  }
}

/**
 * The two roles used to share one health-port default, so starting the second
 * worker on one host died with a bare EADDRINUSE. The defaults differ now, but a
 * pinned `STUDIO_AGENT_HEALTH_PORT` in a shared environment can still collide —
 * say so instead of leaking a socket error.
 */
function describeHealthBindFailure(
  error: unknown,
  role: RuntimeWorkerRole,
  processConfig: RuntimeProcessConfig
): Error {
  if (!isAddressInUse(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new Error(
    [
      `The ${role} worker cannot bind its health endpoint on ${processConfig.healthHost}:${processConfig.healthPort} — the address is already in use.`,
      "Each worker role needs its own health port and metrics bind address.",
      `Unset STUDIO_AGENT_HEALTH_PORT to use the per-role defaults (${formatRoleEndpointDefaults()}), or give this role its own value.`,
    ].join("\n"),
    { cause: error }
  );
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
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
