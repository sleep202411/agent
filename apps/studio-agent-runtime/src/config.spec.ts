import { describe, expect, it } from "vitest";
import {
  loadRuntimeGatewayConfig,
  loadRuntimeModelConfig,
  loadRuntimeProcessConfig,
  loadTemporalRuntimeConfig,
} from "./config.js";

describe("studio agent runtime configuration", () => {
  it("fails loudly when durable runtime configuration is absent", () => {
    expect(() => loadTemporalRuntimeConfig({})).toThrow();
    expect(() => loadRuntimeGatewayConfig({})).toThrow();
    expect(() => loadRuntimeModelConfig({})).toThrow();
    expect(() => loadRuntimeProcessConfig({})).toThrow();
  });

  it("requires an explicit Temporal transport mode and a complete mTLS tuple", () => {
    expect(() =>
      loadTemporalRuntimeConfig({
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_NAMESPACE: "fizzdragon",
        TEMPORAL_TLS_MODE: "mtls",
        TEMPORAL_TLS_CA: "ca",
      })
    ).toThrow(/requires TEMPORAL_TLS_CA/);

    expect(() =>
      loadTemporalRuntimeConfig({
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_NAMESPACE: "fizzdragon",
        TEMPORAL_TLS_MODE: "disabled",
        TEMPORAL_TLS_CA: "ca",
        TEMPORAL_TLS_CERT: "cert",
        TEMPORAL_TLS_KEY: "key",
      })
    ).toThrow(/forbidden/);
  });

  it("uses operational defaults without inventing credentials", () => {
    const temporal = loadTemporalRuntimeConfig({
      TEMPORAL_ADDRESS: "temporal:7233",
      TEMPORAL_NAMESPACE: "fizzdragon",
      TEMPORAL_TLS_MODE: "disabled",
    });
    const gateway = loadRuntimeGatewayConfig({
      STUDIO_AGENT_INTERNAL_BASE_URL: "http://server:3001",
      STUDIO_AGENT_RUNTIME_TOKEN: "x".repeat(32),
    });
    const model = loadRuntimeModelConfig({
      ALIBABA_API_KEY: "secret",
    });
    const processConfig = loadRuntimeProcessConfig({
      STUDIO_AGENT_RELEASE: "git-0123456789abcdef",
    });

    expect(temporal.controlTaskQueue).toBe("studio-agent-control-v1");
    expect(temporal.activityTaskQueue).toBe("studio-agent-activities-v1");
    expect(temporal.workerDeploymentName).toBe("fizzdragon-studio-agent");
    expect(temporal.controlMaxConcurrentWorkflowTasks).toBe(64);
    expect(temporal.controlMaxConcurrentWorkflowPolls).toBe(16);
    expect(temporal.activityMaxConcurrentTasks).toBe(16);
    expect(temporal.activityMaxConcurrentPolls).toBe(8);
    expect(gateway.timeoutMs).toBe(30_000);
    expect(model.textModelId).toBe("qwen3-max");
    expect(model.visionModelId).toBe("qwen3-vl-plus");
    expect(processConfig.healthPort).toBe(3_010);
    expect(processConfig.metricsBindAddress).toBe("0.0.0.0:9464");
  });

  it("rejects impossible worker concurrency and shutdown ordering", () => {
    expect(() =>
      loadTemporalRuntimeConfig({
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_NAMESPACE: "fizzdragon",
        TEMPORAL_TLS_MODE: "disabled",
        STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_TASKS: "2",
        STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_POLLS: "3",
      })
    ).toThrow(/cannot exceed activity task concurrency/);

    expect(() =>
      loadTemporalRuntimeConfig({
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_NAMESPACE: "fizzdragon",
        TEMPORAL_TLS_MODE: "disabled",
        STUDIO_AGENT_WORKER_SHUTDOWN_GRACE_MS: "5000",
        STUDIO_AGENT_WORKER_SHUTDOWN_FORCE_MS: "4999",
      })
    ).toThrow(/cannot be shorter/);
  });

  it("pins the task queues and worker deployment name to the schema version", () => {
    const temporal = loadTemporalRuntimeConfig({
      TEMPORAL_ADDRESS: "temporal:7233",
      TEMPORAL_NAMESPACE: "fizzdragon",
      TEMPORAL_TLS_MODE: "disabled",
    });
    expect(temporal.controlTaskQueue).toBe("studio-agent-control-v1");
    expect(temporal.activityTaskQueue).toBe("studio-agent-activities-v1");
    expect(temporal.workerDeploymentName).toBe("fizzdragon-studio-agent");
  });
});
