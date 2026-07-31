import { createPrivateKey, type KeyObject } from "node:crypto";

import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const googleCloudProjectId = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u,
    "must be a Google Cloud project ID, not a display name or project number"
  );
const googleCloudLocation = z
  .string()
  .trim()
  .regex(
    /^(?:global|us|eu|[a-z]+(?:-[a-z0-9]+)+[0-9])$/u,
    "must be global, us, eu, or a Google Cloud region"
  );
const geminiModelId = z
  .string()
  .trim()
  .regex(/^gemini-[a-z0-9][a-z0-9._-]{0,126}$/u, "must be a Gemini model ID");
const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "must use http or https");

const runtimeEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    OTEL_EXPORTER_ENDPOINT: httpUrl,
    TEMPORAL_ADDRESS: nonEmpty,
    TEMPORAL_NAMESPACE: nonEmpty,
    TEMPORAL_TASK_QUEUE: nonEmpty,
    TEMPORAL_WORKER_DEPLOYMENT_NAME: nonEmpty.default("fizzdragon-agent-platform"),
    AGENT_RELEASE: nonEmpty.optional(),
    AGENT_MEMORY_DATABASE_URL: nonEmpty,
    AGENT_MEMORY_DATABASE_ROLE: nonEmpty.regex(
      /^[a-z_][a-z0-9_]{0,62}$/u,
      "must be a lowercase PostgreSQL role identifier"
    ),
    AGENT_MEMORY_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
    AGENT_MEMORY_POOL_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(30_000),
    DOMAIN_GATEWAY_URL: httpUrl,
    DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64: nonEmpty,
    DOMAIN_GATEWAY_JWT_KEY_ID: nonEmpty.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    DOMAIN_GATEWAY_JWT_ISSUER: nonEmpty,
    DOMAIN_GATEWAY_JWT_AUDIENCE: nonEmpty,
    DOMAIN_GATEWAY_JWT_TTL_SECONDS: z.coerce.number().int().min(10).max(120).default(30),
    AGENT_MAX_MODEL_STEPS: z.coerce.number().int().min(1).max(128).default(48),
    DOMAIN_GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(250).max(120_000).default(15_000),
    TEMPORAL_MAX_CONCURRENT_WORKFLOWS: z.coerce.number().int().min(2).max(2_000).default(128),
    TEMPORAL_MAX_CONCURRENT_CONTROL_ACTIVITIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(16),
    TEMPORAL_MAX_CONCURRENT_INFERENCE_ACTIVITIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(16),
    TEMPORAL_MAX_CONCURRENT_TOOL_ACTIVITIES: z.coerce.number().int().min(1).max(1_000).default(32),
    TEMPORAL_MAX_CONCURRENT_LIFECYCLE_ACTIVITIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(8),
    TEMPORAL_MAX_CONCURRENT_CLEANUP_ACTIVITIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(8),
    // The document lane runs on its own Worker and task queue, so it never
    // takes an execution slot from an interactive turn; what it does share is
    // the process and the provider's concurrency. Map wall clock is
    // sections/lane rounded up, so 4 made a 39-section document ten sequential
    // waves. Matching the interactive inference lane caps a large document at
    // one interactive lane's worth of provider concurrency and no more.
    TEMPORAL_MAX_CONCURRENT_DOCUMENT_ACTIVITIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(16),
    TEMPORAL_MAX_CONCURRENT_DOCUMENT_WORKFLOWS: z.coerce
      .number()
      .int()
      .min(1)
      .max(2_000)
      .default(16),
  })
  .passthrough();

const coreEnvironmentSchema = runtimeEnvironmentSchema.extend({
  GOOGLE_CLOUD_PROJECT: googleCloudProjectId,
  GOOGLE_CLOUD_LOCATION: googleCloudLocation,
  GOOGLE_VERTEX_API_KEY: z.string().optional(),
  AGENT_INTERACTIVE_MODEL_ID: geminiModelId,
  AGENT_REASONING_MODEL_ID: geminiModelId,
  AGENT_MEMORY_OBSERVER_MODEL_ID: geminiModelId,
  ABLY_API_KEY: nonEmpty.regex(/^[^:]+:[^:]+$/, "must be an Ably keyName:keySecret pair"),
});

const apiEnvironmentSchema = runtimeEnvironmentSchema.extend({
  AGENT_AUTH_MODE: z.enum(["jwks", "local"]),
  OTEL_COLLECTOR_HEALTH_URL: httpUrl,
  AGENT_JWKS_URL: httpUrl.optional(),
  AGENT_JWT_ISSUER: nonEmpty.optional(),
  AGENT_JWT_AUDIENCE: nonEmpty.optional(),
  AGENT_LOCAL_JWT_SECRET: nonEmpty.min(32).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4111),
});

const workerEnvironmentSchema = coreEnvironmentSchema.extend({
  AGENT_WORKER_HEALTH_HOST: nonEmpty.max(255).default("0.0.0.0"),
  AGENT_WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3010),
  AGENT_WORKER_METRICS_BIND_ADDRESS: nonEmpty
    .regex(/^[A-Za-z0-9.[\]:_-]+:[0-9]{1,5}$/u, "must be a host:port bind address")
    .default("0.0.0.0:9464"),
});

export type AgentRuntimeConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  observability: Readonly<{
    endpoint: string;
  }>;
  temporal: Readonly<{
    address: string;
    namespace: string;
    taskQueue: string;
    deploymentName: string;
    buildId: string;
    maxConcurrentWorkflows: number;
    maxConcurrentDocumentWorkflows: number;
    activityConcurrency: Readonly<{
      control: number;
      inference: number;
      tool: number;
      lifecycle: number;
      cleanup: number;
      document: number;
    }>;
  }>;
  memory: Readonly<{
    databaseUrl: string;
    databaseRole: string;
    poolMax: number;
    poolIdleTimeoutMs: number;
  }>;
  domainGateway: Readonly<{
    url: string;
    signingPrivateKey: KeyObject;
    signingKeyId: string;
    issuer: string;
    audience: string;
    tokenTtlSeconds: number;
    timeoutMs: number;
  }>;
  maxModelSteps: number;
}>;

export type AgentCoreConfig = AgentRuntimeConfig &
  Readonly<{
    inference: Readonly<{
      provider: "google-vertex";
      project: string;
      location: string;
      interactiveModelId: string;
      reasoningModelId: string;
      observerModelId: string;
    }>;
    ablyApiKey: string;
  }>;

export type RuntimeConfig = Omit<AgentRuntimeConfig, "observability"> &
  Readonly<{
    auth:
      | Readonly<{
          mode: "jwks";
          jwksUrl: string;
          issuer: string;
          audience: string;
        }>
      | Readonly<{
          mode: "local";
          secret: string;
        }>;
    observability: Readonly<{
      endpoint: string;
      healthUrl: string;
    }>;
    port: number;
  }>;

export type AgentWorkerConfig = AgentCoreConfig &
  Readonly<{
    health: Readonly<{
      host: string;
      port: number;
    }>;
    metricsBindAddress: string;
  }>;

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = apiEnvironmentSchema.parse(environment);

  if (parsed.NODE_ENV === "production" && parsed.AGENT_AUTH_MODE !== "jwks") {
    throw new Error('AGENT_AUTH_MODE must be "jwks" in production');
  }

  const auth =
    parsed.AGENT_AUTH_MODE === "jwks"
      ? {
          mode: "jwks" as const,
          jwksUrl: requiredForMode(parsed.AGENT_JWKS_URL, "AGENT_JWKS_URL", "jwks"),
          issuer: requiredForMode(parsed.AGENT_JWT_ISSUER, "AGENT_JWT_ISSUER", "jwks"),
          audience: requiredForMode(parsed.AGENT_JWT_AUDIENCE, "AGENT_JWT_AUDIENCE", "jwks"),
        }
      : {
          mode: "local" as const,
          secret: requiredForMode(parsed.AGENT_LOCAL_JWT_SECRET, "AGENT_LOCAL_JWT_SECRET", "local"),
        };
  const runtime = createRuntimeConfigValues(parsed);

  return Object.freeze({
    ...runtime,
    auth: Object.freeze(auth),
    observability: Object.freeze({
      ...runtime.observability,
      healthUrl: parsed.OTEL_COLLECTOR_HEALTH_URL,
    }),
    port: parsed.PORT,
  });
}

export function loadAgentCoreConfig(environment: NodeJS.ProcessEnv = process.env): AgentCoreConfig {
  return createCoreConfig(coreEnvironmentSchema.parse(environment));
}

export function loadAgentWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env
): AgentWorkerConfig {
  const parsed = workerEnvironmentSchema.parse(environment);
  const metricsPort = Number(parsed.AGENT_WORKER_METRICS_BIND_ADDRESS.split(":").at(-1));
  if (!Number.isInteger(metricsPort) || metricsPort < 1 || metricsPort > 65_535) {
    throw new Error("AGENT_WORKER_METRICS_BIND_ADDRESS contains an invalid port");
  }
  if (metricsPort === parsed.AGENT_WORKER_HEALTH_PORT) {
    throw new Error(
      "AGENT_WORKER_METRICS_BIND_ADDRESS and AGENT_WORKER_HEALTH_PORT must use different ports"
    );
  }
  return Object.freeze({
    ...createCoreConfig(parsed),
    health: Object.freeze({
      host: parsed.AGENT_WORKER_HEALTH_HOST,
      port: parsed.AGENT_WORKER_HEALTH_PORT,
    }),
    metricsBindAddress: parsed.AGENT_WORKER_METRICS_BIND_ADDRESS,
  });
}

function createCoreConfig(parsed: z.infer<typeof coreEnvironmentSchema>): AgentCoreConfig {
  if (parsed.GOOGLE_VERTEX_API_KEY?.trim()) {
    throw new Error(
      "GOOGLE_VERTEX_API_KEY is forbidden; Google Vertex must authenticate through ADC"
    );
  }

  return Object.freeze({
    ...createRuntimeConfigValues(parsed),
    inference: Object.freeze({
      provider: "google-vertex" as const,
      project: parsed.GOOGLE_CLOUD_PROJECT,
      location: parsed.GOOGLE_CLOUD_LOCATION,
      interactiveModelId: parsed.AGENT_INTERACTIVE_MODEL_ID,
      reasoningModelId: parsed.AGENT_REASONING_MODEL_ID,
      observerModelId: parsed.AGENT_MEMORY_OBSERVER_MODEL_ID,
    }),
    ablyApiKey: parsed.ABLY_API_KEY,
  });
}

function createRuntimeConfigValues(
  parsed: z.infer<typeof runtimeEnvironmentSchema>
): AgentRuntimeConfig {
  if (parsed.NODE_ENV === "production" && !parsed.AGENT_RELEASE) {
    throw new Error("AGENT_RELEASE is required in production");
  }
  const domainGatewaySigningKey = parseEd25519PrivateKey(parsed.DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64);

  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    observability: Object.freeze({
      endpoint: parsed.OTEL_EXPORTER_ENDPOINT,
    }),
    temporal: Object.freeze({
      address: parsed.TEMPORAL_ADDRESS,
      namespace: parsed.TEMPORAL_NAMESPACE,
      taskQueue: parsed.TEMPORAL_TASK_QUEUE,
      deploymentName: parsed.TEMPORAL_WORKER_DEPLOYMENT_NAME,
      buildId: parsed.AGENT_RELEASE ?? "local-dev",
      maxConcurrentWorkflows: parsed.TEMPORAL_MAX_CONCURRENT_WORKFLOWS,
      maxConcurrentDocumentWorkflows: parsed.TEMPORAL_MAX_CONCURRENT_DOCUMENT_WORKFLOWS,
      activityConcurrency: Object.freeze({
        control: parsed.TEMPORAL_MAX_CONCURRENT_CONTROL_ACTIVITIES,
        inference: parsed.TEMPORAL_MAX_CONCURRENT_INFERENCE_ACTIVITIES,
        tool: parsed.TEMPORAL_MAX_CONCURRENT_TOOL_ACTIVITIES,
        lifecycle: parsed.TEMPORAL_MAX_CONCURRENT_LIFECYCLE_ACTIVITIES,
        cleanup: parsed.TEMPORAL_MAX_CONCURRENT_CLEANUP_ACTIVITIES,
        document: parsed.TEMPORAL_MAX_CONCURRENT_DOCUMENT_ACTIVITIES,
      }),
    }),
    memory: Object.freeze({
      databaseUrl: parsed.AGENT_MEMORY_DATABASE_URL,
      databaseRole: parsed.AGENT_MEMORY_DATABASE_ROLE,
      poolMax: parsed.AGENT_MEMORY_POOL_MAX,
      poolIdleTimeoutMs: parsed.AGENT_MEMORY_POOL_IDLE_TIMEOUT_MS,
    }),
    domainGateway: Object.freeze({
      url: parsed.DOMAIN_GATEWAY_URL,
      signingPrivateKey: domainGatewaySigningKey,
      signingKeyId: parsed.DOMAIN_GATEWAY_JWT_KEY_ID,
      issuer: parsed.DOMAIN_GATEWAY_JWT_ISSUER,
      audience: parsed.DOMAIN_GATEWAY_JWT_AUDIENCE,
      tokenTtlSeconds: parsed.DOMAIN_GATEWAY_JWT_TTL_SECONDS,
      timeoutMs: parsed.DOMAIN_GATEWAY_TIMEOUT_MS,
    }),
    maxModelSteps: parsed.AGENT_MAX_MODEL_STEPS,
  });
}

function parseEd25519PrivateKey(encoded: string): KeyObject {
  const decoded = Buffer.from(encoded, "base64");
  if (
    decoded.length === 0 ||
    decoded.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")
  ) {
    throw new Error("DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64 must be canonical base64");
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(decoded);
  } catch {
    throw new Error("DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64 must encode a PKCS#8 Ed25519 private key");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64 must encode a PKCS#8 Ed25519 private key");
  }
  return key;
}

function requiredForMode(
  value: string | undefined,
  variableName: string,
  mode: "jwks" | "local"
): string {
  if (!value) {
    throw new Error(`${variableName} is required when AGENT_AUTH_MODE=${mode}`);
  }
  return value;
}
