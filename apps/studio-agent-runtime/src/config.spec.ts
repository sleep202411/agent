import { describe, expect, it } from "vitest";
import {
  assertRoleEndpointsAreDistinct,
  loadRuntimeGatewayConfig,
  loadRuntimeModelConfig,
  loadRuntimeProcessConfig,
  loadTemporalRuntimeConfig,
  MODEL_MAX_OUTPUT_TOKENS_CEILING,
  MODEL_TIMEOUT_CEILING_MS,
  MODEL_TIMEOUT_DEFAULT_MS,
  preflightRuntimeConfiguration,
} from "./config.js";

const COMPLETE_ACTIVITIES_ENVIRONMENT = {
  TEMPORAL_ADDRESS: "temporal:7233",
  TEMPORAL_NAMESPACE: "fizzdragon",
  TEMPORAL_TLS_MODE: "disabled",
  STUDIO_AGENT_RELEASE: "git-0123456789abcdef",
  STUDIO_AGENT_INTERNAL_BASE_URL: "http://server:3001",
  STUDIO_AGENT_RUNTIME_TOKEN: "x".repeat(32),
  ALIBABA_API_KEY: "secret",
  ABLY_API_KEY: "app.key:c2VjcmV0",
} as const;

/**
 * THE PREFLIGHT THAT LET A BROKEN WORKER REPORT ITSELF HEALTHY.
 *
 * The activities worker loads the Ably credential at module scope, but the
 * launcher validated only the gateway and the model — so a `.env` with no
 * ABLY_API_KEY produced a worker that answered `/ready` with 200 and then
 * failed at the creator's first turn. A missing credential must stop the
 * process before it starts, not surface as a dead turn minutes later.
 */
describe("runtime boot preflight", () => {
  it("refuses to start the activities role without the delivery credential", () => {
    const withoutAbly = Object.fromEntries(
      Object.entries(COMPLETE_ACTIVITIES_ENVIRONMENT).filter(([key]) => key !== "ABLY_API_KEY")
    );

    expect(() => preflightRuntimeConfiguration("activities", withoutAbly)).toThrow(/ABLY_API_KEY/);
  });

  it("refuses a key NAME, which looks plausible and cannot publish", () => {
    expect(() =>
      preflightRuntimeConfiguration("activities", {
        ...COMPLETE_ACTIVITIES_ENVIRONMENT,
        ABLY_API_KEY: "app.key",
      })
    ).toThrow(/complete Ably API key/);
  });

  it("passes on a complete activities environment", () => {
    expect(() =>
      preflightRuntimeConfiguration("activities", COMPLETE_ACTIVITIES_ENVIRONMENT)
    ).not.toThrow();
  });

  /**
   * The control worker holds no run and publishes nothing, so requiring the
   * delivery credential there would be a boot failure with no defect behind it.
   */
  it("does not require delivery or model credentials for the control role", () => {
    expect(() =>
      preflightRuntimeConfiguration("control", {
        TEMPORAL_ADDRESS: "temporal:7233",
        TEMPORAL_NAMESPACE: "fizzdragon",
        TEMPORAL_TLS_MODE: "disabled",
        STUDIO_AGENT_RELEASE: "git-0123456789abcdef",
      })
    ).not.toThrow();
  });
});

describe("studio agent runtime configuration", () => {
  it("fails loudly when durable runtime configuration is absent", () => {
    expect(() => loadTemporalRuntimeConfig({})).toThrow();
    expect(() => loadRuntimeGatewayConfig({})).toThrow();
    expect(() => loadRuntimeModelConfig({})).toThrow();
    expect(() => loadRuntimeProcessConfig("control", {})).toThrow();
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
    const processConfig = loadRuntimeProcessConfig("control", {
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

  /**
   * D8, the timeout half.
   *
   * 120 000 ms was a total timeout on the whole streaming call, and it killed a
   * live reply at 4 802 characters in 117 seconds. These two assertions pin the
   * replacement to the thing that actually bounds it — the model activity's
   * 16-minute Temporal envelope — rather than to a number somebody liked.
   */
  it("gives a long reply a timeout it can finish inside, bounded by the model activity's envelope", () => {
    const model = loadRuntimeModelConfig({ ALIBABA_API_KEY: "secret" });

    expect(model.timeoutMs).toBe(MODEL_TIMEOUT_DEFAULT_MS);
    expect(model.timeoutMs).toBeGreaterThanOrEqual(300_000);
    // `runModelStep`: startToCloseTimeout 16 minutes, maximumAttempts 1. The
    // model call shares that envelope with one loadModelPlan, four appendEvents
    // and one prepareAction per tool call, each bounded by the 30s gateway
    // timeout — so the ceiling has to leave those six calls room.
    const MODEL_ACTIVITY_START_TO_CLOSE_MS = 16 * 60_000;
    const GATEWAY_CALLS_IN_THE_SAME_ACTIVITY_MS = 6 * 30_000;
    expect(MODEL_TIMEOUT_CEILING_MS + GATEWAY_CALLS_IN_THE_SAME_ACTIVITY_MS).toBeLessThan(
      MODEL_ACTIVITY_START_TO_CLOSE_MS
    );
    expect(model.timeoutMs).toBeLessThanOrEqual(MODEL_TIMEOUT_CEILING_MS);
  });

  it("refuses a model timeout the activity would kill first", () => {
    expect(() =>
      loadRuntimeModelConfig({
        ALIBABA_API_KEY: "secret",
        STUDIO_AGENT_MODEL_TIMEOUT_MS: String(MODEL_TIMEOUT_CEILING_MS + 1),
      })
    ).toThrow();
  });

  /**
   * The ceiling is the PROVIDER's now. It used to be a claim the wire could not
   * honour: one text part is one Ably message, refused above 65 536 bytes, so a
   * 32 768-token reply was truncated on delivery whatever this said.
   */
  it("keeps the output ceiling at the provider's number, not the transport's", () => {
    expect(MODEL_MAX_OUTPUT_TOKENS_CEILING).toBe(32_768);
    expect(loadRuntimeModelConfig({ ALIBABA_API_KEY: "secret" }).maxOutputTokens).toBe(8_192);
    expect(() =>
      loadRuntimeModelConfig({
        ALIBABA_API_KEY: "secret",
        STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS: String(MODEL_MAX_OUTPUT_TOKENS_CEILING + 1),
      })
    ).toThrow();
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

  it("gives each worker role its own process endpoints so both can run on one host", () => {
    const environment = { STUDIO_AGENT_RELEASE: "git-0123456789abcdef" };
    const control = loadRuntimeProcessConfig("control", environment);
    const activities = loadRuntimeProcessConfig("activities", environment);

    expect(control.healthPort).toBe(3_010);
    expect(control.metricsBindAddress).toBe("0.0.0.0:9464");
    expect(activities.healthPort).toBe(3_011);
    expect(activities.metricsBindAddress).toBe("0.0.0.0:9465");
    expect(() => assertRoleEndpointsAreDistinct([control, activities])).not.toThrow();
  });

  it("refuses a shared environment that would make both roles bind the same endpoint", () => {
    const environment = {
      STUDIO_AGENT_RELEASE: "git-0123456789abcdef",
      STUDIO_AGENT_HEALTH_PORT: "3010",
    };

    expect(() =>
      assertRoleEndpointsAreDistinct([
        loadRuntimeProcessConfig("control", environment),
        loadRuntimeProcessConfig("activities", environment),
      ])
    ).toThrow(/STUDIO_AGENT_HEALTH_PORT is set in the shared process environment/);
  });

  it("keeps an explicit deployment-provided endpoint over the role default", () => {
    const activities = loadRuntimeProcessConfig("activities", {
      STUDIO_AGENT_RELEASE: "git-0123456789abcdef",
      STUDIO_AGENT_HEALTH_PORT: "3010",
      STUDIO_AGENT_METRICS_BIND_ADDRESS: "0.0.0.0:9464",
    });

    expect(activities.healthPort).toBe(3_010);
    expect(activities.metricsBindAddress).toBe("0.0.0.0:9464");
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
