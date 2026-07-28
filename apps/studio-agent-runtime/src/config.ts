import { z } from "zod";
import {
  STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  STUDIO_AGENT_CONTROL_TASK_QUEUE,
  STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
} from "@repo/shared/studio-agent";
import type { RuntimeWorkerRole } from "./runtime-role.js";

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

/**
 * Per-role process endpoint defaults.
 *
 * In production the two roles are separate pods and Helm sets both values
 * explicitly, so the defaults are never used there. Locally the two roles are
 * two processes on one host: identical defaults meant the second worker died
 * with EADDRINUSE, which is why the defaults differ by role.
 */
export const ROLE_PROCESS_ENDPOINT_DEFAULTS = {
  control: { healthPort: 3_010, metricsBindAddress: "0.0.0.0:9464" },
  activities: { healthPort: 3_011, metricsBindAddress: "0.0.0.0:9465" },
} as const satisfies Record<RuntimeWorkerRole, { healthPort: number; metricsBindAddress: string }>;

/**
 * One sentence every endpoint-collision message ends with, so the numbers are
 * stated in exactly one place.
 */
export function formatRoleEndpointDefaults(): string {
  return Object.entries(ROLE_PROCESS_ENDPOINT_DEFAULTS)
    .map(([role, defaults]) => `${role} ${defaults.healthPort}/${defaults.metricsBindAddress}`)
    .join(", ");
}

function runtimeProcessEnvironmentSchema(role: RuntimeWorkerRole) {
  const defaults = ROLE_PROCESS_ENDPOINT_DEFAULTS[role];
  return z
    .object({
      STUDIO_AGENT_RELEASE: trimmedRequired,
      STUDIO_AGENT_HEALTH_HOST: trimmedRequired.default("0.0.0.0"),
      STUDIO_AGENT_HEALTH_PORT: port.default(defaults.healthPort),
      STUDIO_AGENT_METRICS_BIND_ADDRESS: trimmedRequired
        .refine(isValidBindAddress, "Expected a host:port metrics bind address.")
        .default(defaults.metricsBindAddress),
    })
    .strict();
}

/**
 * The longest a model call may run, and where the number comes from.
 *
 * `streamText({ timeout })` given a plain number is a TOTAL timeout on the
 * whole streaming call, not a time-to-first-token or an inter-chunk one. At the
 * old 120 000 it aborted a live reply that had streamed 4 802 characters in
 * 117 seconds — the creator watched their answer stop mid-sentence and the turn
 * was recorded as a failure. A ceiling that a normal long reply cannot finish
 * inside is not a safety net, it is a defect.
 *
 * THE ARITHMETIC, against the envelope that actually bounds it. `runModelStep`
 * is a Temporal activity with `startToCloseTimeout: "16 minutes"` and
 * `maximumAttempts: 1` (workflows.ts). The model call is not the only thing in
 * that envelope: one `loadModelPlan`, four `appendEvent`s and one
 * `prepareAction` per tool call all share it, each bounded by the 30 s gateway
 * timeout — call that ~6 × 30 s = 180 s of control-plane HTTP.
 *
 *   default  600 s model + 180 s gateway = 780 s, inside 960 s by three minutes.
 *   ceiling  720 s model + 180 s gateway = 900 s, inside 960 s by one minute.
 *
 * {@link MODEL_TIMEOUT_CEILING_MS} is enforced so an operator cannot configure a
 * model timeout the activity will kill first — which would surface as an opaque
 * Temporal start-to-close rather than as the model call giving up, and would
 * take the run's terminal with it.
 */
export const MODEL_TIMEOUT_DEFAULT_MS = 600_000;
export const MODEL_TIMEOUT_CEILING_MS = 720_000;

/**
 * The output-token ceiling, reconciled with the transport.
 *
 * It used to be a claim the wire could not honour. One text part is one Ably
 * message and an accumulated message is refused above 65 536 bytes, so before
 * `append-ceiling.ts` a reply was truncated somewhere around 16 000 English or
 * 21 000 Chinese tokens no matter what this said — 32 768 was reachable in
 * configuration and unreachable in delivery. With the roll in place the
 * transport carries a reply of any length across as many messages as it takes,
 * so this number is now exactly what it claims to be: the provider's own
 * per-response output ceiling for qwen3-max, and nothing else.
 *
 * The DEFAULT stays 8 192. The failure that motivated D8 was time, not tokens:
 * the aborted reply was ~4 800 characters, far inside 8 192 tokens. Raising the
 * default would lengthen and re-price every turn to fix a bound that was never
 * the one being hit.
 */
export const MODEL_MAX_OUTPUT_TOKENS_CEILING = 32_768;

const ModelEnvironmentSchema = z
  .object({
    ALIBABA_API_KEY: trimmedRequired,
    ALIBABA_BASE_URL: z.url().optional(),
    STUDIO_AGENT_MODEL: z.string().trim().min(1).default("qwen3-max"),
    STUDIO_AGENT_VISION_MODEL: z.string().trim().min(1).default("qwen3-vl-plus"),
    STUDIO_AGENT_MODEL_TIMEOUT_MS: positiveInt
      .min(1_000)
      .max(MODEL_TIMEOUT_CEILING_MS)
      .default(MODEL_TIMEOUT_DEFAULT_MS),
    STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS: positiveInt
      .max(MODEL_MAX_OUTPUT_TOKENS_CEILING)
      .default(8_192),
  })
  .strict();

/**
 * A complete Ably API key: `<appId>.<keyId>:<secret>`.
 *
 * Rejecting a key NAME (everything before the colon, which is what Ably's
 * dashboard shows first) matters because a key name is a plausible-looking
 * value that cannot publish anything — the worker would come up healthy and
 * silently deliver no assistant text at all.
 */
const ABLY_API_KEY_PATTERN = /^[\w-]+\.[\w-]+:[\w+/=-]+$/;

const DeliveryEnvironmentSchema = z
  .object({
    ABLY_API_KEY: trimmedRequired
      .regex(
        ABLY_API_KEY_PATTERN,
        'ABLY_API_KEY must be a complete Ably API key of the form "<appId>.<keyId>:<secret>" — a key name or a token cannot publish.'
      )
      .describe(
        "Root Ably credential. Required: Studio Agent delivery IS Ably, and a worker that started without it would run turns nobody can see."
      ),
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
  role: RuntimeWorkerRole;
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
}

export interface RuntimeDeliveryConfig {
  ablyApiKey: string;
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
  role: RuntimeWorkerRole,
  environment: NodeJS.ProcessEnv = process.env
): RuntimeProcessConfig {
  const parsed = runtimeProcessEnvironmentSchema(role).parse(
    selectEnvironment(environment, [
      "STUDIO_AGENT_RELEASE",
      "STUDIO_AGENT_HEALTH_HOST",
      "STUDIO_AGENT_HEALTH_PORT",
      "STUDIO_AGENT_METRICS_BIND_ADDRESS",
    ])
  );
  return {
    role,
    release: parsed.STUDIO_AGENT_RELEASE,
    healthHost: parsed.STUDIO_AGENT_HEALTH_HOST,
    healthPort: parsed.STUDIO_AGENT_HEALTH_PORT,
    metricsBindAddress: parsed.STUDIO_AGENT_METRICS_BIND_ADDRESS,
  };
}

/**
 * Both roles read one process environment. Locally that is one `.env` file, so
 * pinning `STUDIO_AGENT_HEALTH_PORT` or `STUDIO_AGENT_METRICS_BIND_ADDRESS`
 * there silently re-creates the collision the per-role defaults remove. The
 * local launcher refuses to start a stack that cannot bind both roles rather
 * than leaving one worker dead with an EADDRINUSE stack trace.
 */
export function assertRoleEndpointsAreDistinct(configs: readonly RuntimeProcessConfig[]): void {
  const seen = new Map<string, RuntimeWorkerRole>();
  for (const config of configs) {
    for (const [variable, endpoint] of [
      ["STUDIO_AGENT_HEALTH_PORT", `${config.healthHost}:${config.healthPort}`],
      ["STUDIO_AGENT_METRICS_BIND_ADDRESS", config.metricsBindAddress],
    ] as const) {
      const key = `${variable}=${endpoint}`;
      const owner = seen.get(key);
      if (owner) {
        throw new Error(
          [
            `The ${owner} and ${config.role} workers would both bind ${endpoint}.`,
            `${variable} is set in the shared process environment, which overrides the per-role default.`,
            `Unset it to use the per-role defaults (${formatRoleEndpointDefaults()}), or give each role its own value.`,
          ].join("\n")
        );
      }
      seen.set(key, config.role);
    }
  }
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
    ])
  );
  return {
    apiKey: parsed.ALIBABA_API_KEY,
    baseUrl: parsed.ALIBABA_BASE_URL,
    textModelId: parsed.STUDIO_AGENT_MODEL,
    visionModelId: parsed.STUDIO_AGENT_VISION_MODEL,
    timeoutMs: parsed.STUDIO_AGENT_MODEL_TIMEOUT_MS,
    maxOutputTokens: parsed.STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS,
  };
}

export function loadRuntimeDeliveryConfig(
  environment: NodeJS.ProcessEnv = process.env
): RuntimeDeliveryConfig {
  const parsed = DeliveryEnvironmentSchema.parse(selectEnvironment(environment, ["ABLY_API_KEY"]));
  return { ablyApiKey: parsed.ABLY_API_KEY };
}

/**
 * Everything a role must be able to load before it is allowed to start.
 *
 * ONE list, here, rather than one list in the launcher and another implied by
 * whatever each worker entrypoint happens to import at module scope. They had
 * drifted: `worker-activities.ts` loads the delivery credential, the launcher
 * checked only the gateway and the model, and the consequence was a local
 * worker that answered `/ready` with 200 and then failed at the creator's first
 * turn — a config error delivered as a dead turn minutes later instead of as a
 * refusal to start. A role's requirements belong beside the loaders.
 *
 * Throws the first failure, with the zod message intact.
 */
export function preflightRuntimeConfiguration(
  role: RuntimeWorkerRole,
  environment: NodeJS.ProcessEnv = process.env
): void {
  loadTemporalRuntimeConfig(environment);
  loadRuntimeProcessConfig(role, environment);
  if (role !== "activities") {
    return;
  }
  loadRuntimeGatewayConfig(environment);
  loadRuntimeModelConfig(environment);
  // Delivery IS Ably. A worker without this key runs turns nobody can see.
  loadRuntimeDeliveryConfig(environment);
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
