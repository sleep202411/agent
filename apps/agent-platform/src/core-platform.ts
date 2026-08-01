import type { Mastra } from "@mastra/core/mastra";
import type { MastraModelConfig } from "@mastra/core/llm";
import { Observability } from "@mastra/observability";
import { OtelExporter } from "@mastra/otel-exporter";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

import type { SensitiveDataFilterOptions } from "@mastra/observability";

import type { AgentRuntimeConfig } from "./config/env.js";
import { HttpDomainGateway } from "./domain/domain-gateway.js";
import { createAgentMemory } from "./memory/agent-memory.js";
import { privacyPreservingSpanFormatter } from "./observability/privacy.js";

/**
 * Mastra's SensitiveDataFilter compares normalized field names for exact
 * equality and *replaces* its default list when `sensitiveFields` is supplied,
 * so anything omitted here is silently exported in the clear. These are the
 * framework defaults plus FizzDragon's own fields; core-platform.test.ts pins
 * that superset so a framework upgrade cannot quietly narrow it.
 */
export const sensitiveDataFilterOptions: SensitiveDataFilterOptions = Object.freeze({
  redactionStyle: "full",
  sensitiveFields: [
    "password",
    "token",
    "secret",
    "key",
    "apikey",
    "auth",
    "authorization",
    "bearer",
    "bearertoken",
    "jwt",
    "credential",
    "clientsecret",
    "privatekey",
    "refresh",
    "ssn",
    "cookie",
  ],
});

export function createAgentInfrastructure(
  config: AgentRuntimeConfig,
  options: Readonly<{ observerModel?: MastraModelConfig }> = {}
) {
  assertOtelRuntimeDependencies();
  const observability = new Observability({
    sensitiveDataFilter: sensitiveDataFilterOptions,
    configs: {
      default: {
        serviceName: "fizzdragon-agent-platform",
        exporters: [
          new OtelExporter({
            provider: {
              custom: {
                endpoint: config.observability.endpoint,
                protocol: "http/protobuf",
              },
            },
            timeout: 10_000,
            batchSize: 200,
            signals: { traces: true, logs: true },
            logLevel: "warn",
            customSpanFormatter: privacyPreservingSpanFormatter,
          }),
        ],
        requestContextKeys: ["surface", "scope", "traceId"],
        serializationOptions: {
          maxStringLength: 8_000,
          maxDepth: 8,
          maxArrayLength: 200,
          maxObjectKeys: 200,
        },
        logging: {
          enabled: true,
          level: "info",
        },
      },
    },
  });
  const domainGateway = new HttpDomainGateway(config.domainGateway);
  const agentMemory = createAgentMemory(config.memory, options.observerModel);
  const infrastructureMastraOptions: ConstructorParameters<typeof Mastra>[0] = {
    // This dedicated framework store is not a business source of truth:
    // Temporal owns execution durability and the product database owns domain
    // state. It is still registered globally so Mastra never falls back to
    // process-local persistence and every framework domain is schema-managed.
    storage: agentMemory.storage,
    observability,
    environment: config.nodeEnv,
    workers: false,
    recovery: { durableAgents: "off" },
    bundler: {
      // Preserve runtime package boundaries in production. Mastra recommends
      // this mode for native and dynamically loaded dependencies.
      externals: true,
      sourcemap: true,
    },
  };

  return Object.freeze({
    infrastructureMastraOptions,
    agentMemory,
    observability,
    domainGateway,
  });
}

function assertOtelRuntimeDependencies(): void {
  // Mastra loads these protocol adapters dynamically. Import them explicitly so
  // a deploy artifact cannot silently disable a signal because an optional peer
  // was omitted by the package manager.
  if (typeof OTLPTraceExporter !== "function" || typeof OTLPLogExporter !== "function") {
    throw new Error("OTLP HTTP/Protobuf signal exporters are unavailable");
  }
}
