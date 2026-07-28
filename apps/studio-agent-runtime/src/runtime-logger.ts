import { DefaultLogger, Runtime, type LogEntry, type RuntimeOptions } from "@temporalio/worker";
import { formatRoleEndpointDefaults } from "./config.js";
import type { RuntimeWorkerRole } from "./runtime-role.js";

export function installTemporalRuntimeLogger(
  role: RuntimeWorkerRole,
  metricsBindAddress: string,
  install: (options: RuntimeOptions) => void = (options) => Runtime.install(options)
): void {
  try {
    install({
      logger: new DefaultLogger("INFO", (entry) => {
        process.stderr.write(`${serializeLogEntry(role, entry)}\n`);
      }),
      telemetryOptions: {
        logging: {
          filter: { core: "INFO", other: "WARN" },
          forward: {},
        },
        metrics: {
          prometheus: {
            bindAddress: metricsBindAddress,
            countersTotalSuffix: true,
            unitSuffix: true,
            useSecondsForDurations: true,
          },
        },
      },
      workerHeartbeatInterval: "30 seconds",
    });
  } catch (error) {
    throw describeMetricsBindFailure(error, role, metricsBindAddress);
  }
}

/**
 * The Prometheus exporter binds inside Temporal's native runtime, before any of
 * this app's own listeners, so a metrics-address collision is the first thing a
 * developer running both roles on one host hits. The SDK reports it as a bare
 * "Address already in use", which names neither the address nor the variable.
 */
export function describeMetricsBindFailure(
  error: unknown,
  role: RuntimeWorkerRole,
  metricsBindAddress: string
): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  if (!/address already in use/i.test(cause.message)) {
    return cause;
  }
  return new Error(
    [
      `The ${role} worker cannot export metrics on ${metricsBindAddress} — the address is already in use.`,
      "Each worker role needs its own metrics bind address.",
      `Unset STUDIO_AGENT_METRICS_BIND_ADDRESS to use the per-role defaults (${formatRoleEndpointDefaults()}), or give this role its own value.`,
    ].join("\n"),
    { cause }
  );
}

export function writeRuntimeLog(
  role: RuntimeWorkerRole,
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  attributes: Readonly<Record<string, unknown>> = {}
): void {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "studio-agent-runtime",
      role,
      message,
      attributes,
    })}\n`
  );
}

function serializeLogEntry(role: RuntimeWorkerRole, entry: LogEntry): string {
  return JSON.stringify(
    {
      timestamp: new Date(Number(entry.timestampNanos / 1_000_000n)).toISOString(),
      level: entry.level,
      service: "studio-agent-runtime",
      role,
      message: entry.message,
      ...(entry.meta ? { attributes: entry.meta } : {}),
    },
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value)
  );
}
