import type { RuntimeConfig } from "../config/env.js";
import type { AgentRuntimeDomainGateway } from "../domain/domain-gateway.js";
import { assertTemporalReady } from "./temporal-client.js";

export type DependencyName = "otelCollector" | "temporal" | "agentMemory" | "domainGateway";
export type DependencyStatus = "ready" | "unavailable";

export type ReadinessSnapshot = Readonly<{
  ready: boolean;
  degraded: boolean;
  dependencies: Readonly<Record<DependencyName, DependencyStatus>>;
  checkedAt: string;
}>;

const criticalDependencies = new Set<DependencyName>(["temporal", "agentMemory", "domainGateway"]);

export function summarizeReadiness(
  dependencies: Readonly<Record<DependencyName, DependencyStatus>>
): Readonly<{ ready: boolean; degraded: boolean }> {
  const unavailable = Object.entries(dependencies)
    .filter(([, status]) => status === "unavailable")
    .map(([name]) => name as DependencyName);
  return Object.freeze({
    ready: unavailable.every((name) => !criticalDependencies.has(name)),
    degraded: unavailable.length > 0,
  });
}

export class ReadinessChecker {
  readonly #config: RuntimeConfig;
  readonly #domainGateway: AgentRuntimeDomainGateway;
  readonly #assertAgentMemoryReady: () => Promise<void>;
  #cached: Readonly<{ expiresAt: number; value: ReadinessSnapshot }> | undefined;
  #checking: Promise<ReadinessSnapshot> | undefined;

  constructor(input: {
    config: RuntimeConfig;
    domainGateway: AgentRuntimeDomainGateway;
    assertAgentMemoryReady: () => Promise<void>;
  }) {
    this.#config = input.config;
    this.#domainGateway = input.domainGateway;
    this.#assertAgentMemoryReady = input.assertAgentMemoryReady;
  }

  async check(): Promise<ReadinessSnapshot> {
    if (this.#cached && this.#cached.expiresAt > Date.now()) {
      return this.#cached.value;
    }
    this.#checking ??= this.#runChecks();
    try {
      const value = await this.#checking;
      this.#cached = Object.freeze({
        expiresAt: Date.now() + 5_000,
        value,
      });
      return value;
    } finally {
      this.#checking = undefined;
    }
  }

  async #runChecks(): Promise<ReadinessSnapshot> {
    const checks: ReadonlyArray<readonly [DependencyName, () => Promise<unknown>]> = [
      [
        "otelCollector",
        async () => {
          const response = await fetch(this.#config.observability.healthUrl, {
            headers: { accept: "application/json, text/plain;q=0.9" },
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) {
            throw new Error(`OpenTelemetry Collector health check returned ${response.status}`);
          }
        },
      ],
      ["temporal", () => assertTemporalReady(this.#config)],
      ["agentMemory", this.#assertAgentMemoryReady],
      ["domainGateway", () => this.#domainGateway.assertReady()],
    ];
    const results = await Promise.allSettled(
      checks.map(([, check]) => withDeadline(check(), 10_000))
    );
    const dependencies = Object.fromEntries(
      checks.map(([name], index) => [
        name,
        results[index]?.status === "fulfilled" ? "ready" : "unavailable",
      ])
    ) as Record<DependencyName, DependencyStatus>;
    const summary = summarizeReadiness(dependencies);

    return Object.freeze({
      ...summary,
      dependencies: Object.freeze(dependencies),
      checkedAt: new Date().toISOString(),
    });
  }
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Readiness dependency timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
