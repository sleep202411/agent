import { DefaultLogger, Runtime, type LogEntry } from "@temporalio/worker";
import type { RuntimeWorkerRole } from "./health-server.js";

export function installTemporalRuntimeLogger(
  role: RuntimeWorkerRole,
  metricsBindAddress: string
): void {
  Runtime.install({
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
