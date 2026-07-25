import { z } from "zod";
import {
  STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  STUDIO_AGENT_CONTROL_TASK_QUEUE,
  STUDIO_AGENT_SCHEMA_VERSION,
  STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
} from "@repo/shared/studio-agent";

const trimmedRequired = z.string().trim().min(1);
const positiveInt = z.coerce.number().int().positive();
const port = z.coerce.number().int().min(1_024).max(65_535);

const TemporalEnvironmentSchema = z
  .object({
    TEMPORAL_ADDRESS: trimmedRequired,
    TEMPORAL_NAMESPACE: trimmedRequired,
    TEMPORAL_TLS_MODE: z.enum(["mtls", "disabled"]),
    TEMPORAL_SERVER_NAME: z.string().trim().min(1).optional(),
    TEMPORAL_TLS_CA: z.string().min(1).optional(),
    TEMPORAL_TLS_CERT: z.string().min(1).optional(),
    TEMPORAL_TLS_KEY: z.string().min(1).optional(),
    STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_TASKS: positiveInt.default(64),
    STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_POLLS: positiveInt.default(16),
    STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_TASKS: positiveInt.default(16),
    STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_POLLS: positiveInt.default(8),
    STUDIO_AGENT_WORKER_SHUTDOWN_GRACE_MS: positiveInt.default(30_000),
    STUDIO_AGENT_WORKER_SHUTDOWN_FORCE_MS: positiveInt.default(120_000),
  })
  .strict()
  .superRefine((value, context) => {
    const tlsValues = [value.TEMPORAL_TLS_CA, value.TEMPORAL_TLS_CERT, value.TEMPORAL_TLS_KEY];
    const configured = tlsValues.filter(Boolean).length;
    if (value.TEMPORAL_TLS_MODE === "mtls" && configured !== tlsValues.length) {
      context.addIssue({
        code: "custom",
        message:
          "TEMPORAL_TLS_MODE=mtls requires TEMPORAL_TLS_CA, TEMPORAL_TLS_CERT, and TEMPORAL_TLS_KEY.",
      });
    }
    if (
      value.TEMPORAL_TLS_MODE === "disabled" &&
      (configured !== 0 || value.TEMPORAL_SERVER_NAME)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Temporal TLS material and TEMPORAL_SERVER_NAME are forbidden when TEMPORAL_TLS_MODE=disabled.",
      });
    }
    if (
      value.STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_POLLS >
      value.STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_TASKS
    ) {
      context.addIssue({
        code: "custom",
        message:
          "STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_POLLS cannot exceed workflow task concurrency.",
      });
    }
    if (
      value.STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_POLLS >
      value.STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_TASKS
    ) {
      context.addIssue({
        code: "custom",
        message:
          "STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_POLLS cannot exceed activity task concurrency.",
      });
    }
    if (value.STUDIO_AGENT_WORKER_SHUTDOWN_FORCE_MS < value.STUDIO_AGENT_WORKER_SHUTDOWN_GRACE_MS) {
      context.addIssue({
        code: "custom",
        message:
          "STUDIO_AGENT_WORKER_SHUTDOWN_FORCE_MS cannot be shorter than the graceful shutdown window.",
      });
    }
  });

const GatewayEnvironmentSchema = z
  .object({
    STUDIO_AGENT_INTERNAL_BASE_URL: z.url().refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === ""
      );
    }, "STUDIO_AGENT_INTERNAL_BASE_URL must be an HTTP(S) origin or path without credentials, query, or fragment."),
    STUDIO_AGENT_RUNTIME_TOKEN: trimmedRequired.min(32),
    STUDIO_AGENT_INTERNAL_TIMEOUT_MS: positiveInt.default(30_000),
  })
  .strict();

const RuntimeProcessEnvironmentSchema = z
  .object({
    STUDIO_AGENT_RELEASE: trimmedRequired,
    STUDIO_AGENT_HEALTH_HOST: trimmedRequired.default("0.0.0.0"),
    STUDIO_AGENT_HEALTH_PORT: port.default(3_010),
    STUDIO_AGENT_METRICS_BIND_ADDRESS: trimmedRequired
      .refine(isValidBindAddress, "Expected a host:port metrics bind address.")
      .default("0.0.0.0:9464"),
  })
  .strict();

const ModelEnvironmentSchema = z
  .object({
    ALIBABA_API_KEY: trimmedRequired,
    ALIBABA_BASE_URL: z.url().optional(),
    STUDIO_AGENT_MODEL: z.string().trim().min(1).default("qwen3-max"),
    STUDIO_AGENT_VISION_MODEL: z.string().trim().min(1).default("qwen3-vl-plus"),
    STUDIO_AGENT_MODEL_TIMEOUT_MS: positiveInt.default(120_000),
    STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS: positiveInt.max(32_768).default(8_192),
    STUDIO_AGENT_MODEL_DELTA_BYTES: positiveInt.max(64 * 1024).default(1_024),
    STUDIO_AGENT_MODEL_DELTA_INTERVAL_MS: positiveInt.max(5_000).default(50),
  })
  .strict();

export interface TemporalRuntimeConfig {
  address: string;
  namespace: string;
  serverName: string | undefined;
  tls:
    | {
        serverRootCACertificate: Buffer;
        clientCertPair: {
          crt: Buffer;
          key: Buffer;
        };
      }
    | undefined;
  controlTaskQueue: string;
  activityTaskQueue: string;
  workerDeploymentName: string;
  controlMaxConcurrentWorkflowTasks: number;
  controlMaxConcurrentWorkflowPolls: number;
  activityMaxConcurrentTasks: number;
  activityMaxConcurrentPolls: number;
  shutdownGraceMs: number;
  shutdownForceMs: number;
}

export interface RuntimeGatewayConfig {
  baseUrl: URL;
  token: string;
  timeoutMs: number;
}

export interface RuntimeProcessConfig {
  release: string;
  healthHost: string;
  healthPort: number;
  metricsBindAddress: string;
}

export interface RuntimeModelConfig {
  apiKey: string;
  baseUrl: string | undefined;
  textModelId: string;
  visionModelId: string;
  timeoutMs: number;
  maxOutputTokens: number;
  deltaBytes: number;
  deltaIntervalMs: number;
}

export function loadTemporalRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): TemporalRuntimeConfig {
  const parsed = TemporalEnvironmentSchema.parse(
    selectEnvironment(environment, [
      "TEMPORAL_ADDRESS",
      "TEMPORAL_NAMESPACE",
      "TEMPORAL_TLS_MODE",
      "TEMPORAL_SERVER_NAME",
      "TEMPORAL_TLS_CA",
      "TEMPORAL_TLS_CERT",
      "TEMPORAL_TLS_KEY",
      "STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_TASKS",
      "STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_POLLS",
      "STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_TASKS",
      "STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_POLLS",
      "STUDIO_AGENT_WORKER_SHUTDOWN_GRACE_MS",
      "STUDIO_AGENT_WORKER_SHUTDOWN_FORCE_MS",
    ])
  );
  // The task queues and Worker Deployment name are pinned to the schema
  // version (they identify PINNED workflow histories, so they cannot vary per
  // deployment). They are sourced directly from the shared constants rather
  // than exposed as env knobs that could only ever hold the one valid value.
  return {
    address: parsed.TEMPORAL_ADDRESS,
    namespace: parsed.TEMPORAL_NAMESPACE,
    serverName: parsed.TEMPORAL_SERVER_NAME,
    tls:
      parsed.TEMPORAL_TLS_CA && parsed.TEMPORAL_TLS_CERT && parsed.TEMPORAL_TLS_KEY
        ? {
            serverRootCACertificate: Buffer.from(parsed.TEMPORAL_TLS_CA),
            clientCertPair: {
              crt: Buffer.from(parsed.TEMPORAL_TLS_CERT),
              key: Buffer.from(parsed.TEMPORAL_TLS_KEY),
            },
          }
        : undefined,
    controlTaskQueue: STUDIO_AGENT_CONTROL_TASK_QUEUE,
    activityTaskQueue: STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
    workerDeploymentName: STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
    controlMaxConcurrentWorkflowTasks: parsed.STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_TASKS,
    controlMaxConcurrentWorkflowPolls: parsed.STUDIO_AGENT_CONTROL_MAX_CONCURRENT_WORKFLOW_POLLS,
    activityMaxConcurrentTasks: parsed.STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_TASKS,
    activityMaxConcurrentPolls: parsed.STUDIO_AGENT_ACTIVITY_MAX_CONCURRENT_POLLS,
    shutdownGraceMs: parsed.STUDIO_AGENT_WORKER_SHUTDOWN_GRACE_MS,
    shutdownForceMs: parsed.STUDIO_AGENT_WORKER_SHUTDOWN_FORCE_MS,
  };
}

export function loadRuntimeProcessConfig(
  environment: NodeJS.ProcessEnv = process.env
): RuntimeProcessConfig {
  const parsed = RuntimeProcessEnvironmentSchema.parse(
    selectEnvironment(environment, [
      "STUDIO_AGENT_RELEASE",
      "STUDIO_AGENT_HEALTH_HOST",
      "STUDIO_AGENT_HEALTH_PORT",
      "STUDIO_AGENT_METRICS_BIND_ADDRESS",
    ])
  );
  return {
    release: parsed.STUDIO_AGENT_RELEASE,
    healthHost: parsed.STUDIO_AGENT_HEALTH_HOST,
    healthPort: parsed.STUDIO_AGENT_HEALTH_PORT,
    metricsBindAddress: parsed.STUDIO_AGENT_METRICS_BIND_ADDRESS,
  };
}

export function loadRuntimeGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env
): RuntimeGatewayConfig {
  const parsed = GatewayEnvironmentSchema.parse(
    selectEnvironment(environment, [
      "STUDIO_AGENT_INTERNAL_BASE_URL",
      "STUDIO_AGENT_RUNTIME_TOKEN",
      "STUDIO_AGENT_INTERNAL_TIMEOUT_MS",
    ])
  );
  return {
    baseUrl: new URL(parsed.STUDIO_AGENT_INTERNAL_BASE_URL),
    token: parsed.STUDIO_AGENT_RUNTIME_TOKEN,
    timeoutMs: parsed.STUDIO_AGENT_INTERNAL_TIMEOUT_MS,
  };
}

export function loadRuntimeModelConfig(
  environment: NodeJS.ProcessEnv = process.env
): RuntimeModelConfig {
  const parsed = ModelEnvironmentSchema.parse(
    selectEnvironment(environment, [
      "ALIBABA_API_KEY",
      "ALIBABA_BASE_URL",
      "STUDIO_AGENT_MODEL",
      "STUDIO_AGENT_VISION_MODEL",
      "STUDIO_AGENT_MODEL_TIMEOUT_MS",
      "STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS",
      "STUDIO_AGENT_MODEL_DELTA_BYTES",
      "STUDIO_AGENT_MODEL_DELTA_INTERVAL_MS",
    ])
  );
  return {
    apiKey: parsed.ALIBABA_API_KEY,
    baseUrl: parsed.ALIBABA_BASE_URL,
    textModelId: parsed.STUDIO_AGENT_MODEL,
    visionModelId: parsed.STUDIO_AGENT_VISION_MODEL,
    timeoutMs: parsed.STUDIO_AGENT_MODEL_TIMEOUT_MS,
    maxOutputTokens: parsed.STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS,
    deltaBytes: parsed.STUDIO_AGENT_MODEL_DELTA_BYTES,
    deltaIntervalMs: parsed.STUDIO_AGENT_MODEL_DELTA_INTERVAL_MS,
  };
}

function selectEnvironment(
  environment: NodeJS.ProcessEnv,
  keys: readonly string[]
): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, environment[key]]));
}

function isValidBindAddress(value: string): boolean {
  const delimiter = value.lastIndexOf(":");
  if (delimiter <= 0) {
    return false;
  }
  const host = value.slice(0, delimiter);
  const rawPort = value.slice(delimiter + 1);
  if (host.trim() !== host || rawPort.trim() !== rawPort || !/^\d+$/.test(rawPort)) {
    return false;
  }
  const parsedPort = Number(rawPort);
  return (
    host.length > 0 && Number.isInteger(parsedPort) && parsedPort >= 1_024 && parsedPort <= 65_535
  );
}
