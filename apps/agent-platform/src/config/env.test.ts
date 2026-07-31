import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadAgentCoreConfig, loadAgentWorkerConfig, loadRuntimeConfig } from "./env.js";

const environment = (): NodeJS.ProcessEnv => {
  const { privateKey } = generateKeyPairSync("ed25519");
  return {
    NODE_ENV: "development",
    AGENT_AUTH_MODE: "local",
    GOOGLE_CLOUD_PROJECT: "glass-proxy-501907-d2",
    GOOGLE_CLOUD_LOCATION: "global",
    AGENT_INTERACTIVE_MODEL_ID: "gemini-2.5-flash",
    AGENT_REASONING_MODEL_ID: "gemini-2.5-pro",
    AGENT_MEMORY_OBSERVER_MODEL_ID: "gemini-2.5-flash",
    OTEL_EXPORTER_ENDPOINT: "http://localhost:4318/v1/traces",
    OTEL_COLLECTOR_HEALTH_URL: "http://localhost:13133/",
    TEMPORAL_ADDRESS: "localhost:7233",
    TEMPORAL_NAMESPACE: "default",
    TEMPORAL_TASK_QUEUE: "fizzdragon-agent",
    ABLY_API_KEY: "app.key:secret",
    AGENT_MEMORY_DATABASE_URL: "postgresql://agent:secret@localhost:5433/agent",
    AGENT_MEMORY_DATABASE_ROLE: "agent_runtime",
    DOMAIN_GATEWAY_URL: "http://localhost:4399",
    DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64: Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" })
    ).toString("base64"),
    DOMAIN_GATEWAY_JWT_KEY_ID: "domain-key-1",
    DOMAIN_GATEWAY_JWT_ISSUER: "fizzdragon-agent-platform",
    DOMAIN_GATEWAY_JWT_AUDIENCE: "fizzdragon-domain-gateway",
    AGENT_LOCAL_JWT_SECRET: "a".repeat(32),
  };
};

describe("loadRuntimeConfig", () => {
  it("fails loudly when required configuration is absent", () => {
    const input = environment();
    delete input.TEMPORAL_TASK_QUEUE;
    expect(() => loadRuntimeConfig(input)).toThrow();
  });

  it("forbids local symmetric authentication in production", () => {
    expect(() =>
      loadRuntimeConfig({
        ...environment(),
        NODE_ENV: "production",
        AGENT_RELEASE: "release-1",
      })
    ).toThrow(/AGENT_AUTH_MODE must be "jwks"/);
  });

  it("requires an immutable release identity in production", () => {
    expect(() =>
      loadRuntimeConfig({
        ...environment(),
        NODE_ENV: "production",
        AGENT_AUTH_MODE: "jwks",
        AGENT_JWKS_URL: "https://identity.example.com/.well-known/jwks.json",
        AGENT_JWT_ISSUER: "https://identity.example.com",
        AGENT_JWT_AUDIENCE: "fizzdragon-agent",
      })
    ).toThrow(/AGENT_RELEASE is required/);
  });

  it("forbids Vertex Express Mode API keys", () => {
    expect(() =>
      loadAgentCoreConfig({
        ...environment(),
        GOOGLE_VERTEX_API_KEY: "must-not-be-used",
      })
    ).toThrow(/must authenticate through ADC/);
  });

  it("does not couple the platform configuration to Gemini", () => {
    const input = environment();
    delete input.GOOGLE_CLOUD_PROJECT;
    delete input.GOOGLE_CLOUD_LOCATION;
    delete input.AGENT_INTERACTIVE_MODEL_ID;
    delete input.AGENT_REASONING_MODEL_ID;
    delete input.AGENT_MEMORY_OBSERVER_MODEL_ID;
    delete input.ABLY_API_KEY;

    expect(loadRuntimeConfig(input).temporal.taskQueue).toBe("fizzdragon-agent");
  });

  it("loads the Worker core without API authentication or health-probe configuration", () => {
    const input = environment();
    delete input.AGENT_AUTH_MODE;
    delete input.AGENT_LOCAL_JWT_SECRET;
    delete input.OTEL_COLLECTOR_HEALTH_URL;

    const config = loadAgentCoreConfig(input);

    expect(config.temporal.taskQueue).toBe("fizzdragon-agent");
    expect(config.observability.endpoint).toBe("http://localhost:4318/v1/traces");
    expect(config.inference).toEqual({
      provider: "google-vertex",
      project: "glass-proxy-501907-d2",
      location: "global",
      interactiveModelId: "gemini-2.5-flash",
      reasoningModelId: "gemini-2.5-pro",
      observerModelId: "gemini-2.5-flash",
    });
    expect(config.domainGateway.signingPrivateKey.asymmetricKeyType).toBe("ed25519");
  });

  it("rejects a Google Cloud display name where a project ID is required", () => {
    expect(() =>
      loadAgentCoreConfig({
        ...environment(),
        GOOGLE_CLOUD_PROJECT: "FizzDragon",
      })
    ).toThrow(/project ID/);
  });

  it("requires unprefixed Gemini model IDs for the explicit Vertex provider", () => {
    expect(() =>
      loadAgentCoreConfig({
        ...environment(),
        AGENT_REASONING_MODEL_ID: "google/gemini-2.5-pro",
      })
    ).toThrow(/Gemini model ID/);
  });

  it("loads independent Worker health and Temporal metrics listeners", () => {
    const input = environment();
    delete input.AGENT_AUTH_MODE;
    delete input.AGENT_LOCAL_JWT_SECRET;
    delete input.OTEL_COLLECTOR_HEALTH_URL;

    const config = loadAgentWorkerConfig(input);

    expect(config.health).toEqual({ host: "0.0.0.0", port: 3010 });
    expect(config.metricsBindAddress).toBe("0.0.0.0:9464");
  });

  it("rejects a Worker health listener that collides with the metrics exporter", () => {
    expect(() =>
      loadAgentWorkerConfig({
        ...environment(),
        AGENT_WORKER_HEALTH_PORT: "9464",
        AGENT_WORKER_METRICS_BIND_ADDRESS: "0.0.0.0:9464",
      })
    ).toThrow(/must use different ports/);
  });
});
