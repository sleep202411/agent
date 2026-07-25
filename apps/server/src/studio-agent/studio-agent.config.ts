import { Injectable } from '@nestjs/common';
import {
  STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  STUDIO_AGENT_CONTROL_TASK_QUEUE,
  STUDIO_AGENT_SCHEMA_VERSION,
  STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
} from '@repo/shared/studio-agent';
import { z } from 'zod';

const requiredString = z.string().trim().min(1);
const positiveInteger = z.coerce.number().int().positive();
const nonnegativeInteger = z.coerce.number().int().nonnegative();
const ratio = z.coerce.number().min(0.5).max(0.95);
const StudioAgentServerEnvironmentSchema = z
  .object({
    TEMPORAL_ADDRESS: requiredString,
    TEMPORAL_NAMESPACE: requiredString,
    TEMPORAL_TLS_MODE: z.enum(['mtls', 'disabled']),
    TEMPORAL_SERVER_NAME: requiredString.optional(),
    TEMPORAL_TLS_CA: z.string().min(1).optional(),
    TEMPORAL_TLS_CERT: z.string().min(1).optional(),
    TEMPORAL_TLS_KEY: z.string().min(1).optional(),
    STUDIO_AGENT_CONTROL_TASK_QUEUE: requiredString.default(
      STUDIO_AGENT_CONTROL_TASK_QUEUE,
    ),
    STUDIO_AGENT_ACTIVITY_TASK_QUEUE: requiredString.default(
      STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
    ),
    STUDIO_AGENT_WORKER_DEPLOYMENT_NAME: requiredString.default(
      STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
    ),
    STUDIO_AGENT_RELEASE: requiredString,
    STUDIO_AGENT_TEMPORAL_CONNECT_TIMEOUT_MS: positiveInteger
      .max(60_000)
      .default(5_000),
    STUDIO_AGENT_TEMPORAL_HEALTH_PROBE_INTERVAL_MS: positiveInteger
      .max(60_000)
      .default(5_000),
    STUDIO_AGENT_TEMPORAL_RECONNECT_MIN_DELAY_MS: positiveInteger
      .max(60_000)
      .default(500),
    STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS: positiveInteger
      .max(300_000)
      .default(30_000),
    STUDIO_AGENT_TEMPORAL_POLLER_STALE_MS: positiveInteger
      .min(5_000)
      .max(300_000)
      .default(30_000),
    STUDIO_AGENT_RUNTIME_TOKEN: requiredString.min(32),
    STUDIO_AGENT_COMMAND_POLL_INTERVAL_MS: positiveInteger.default(250),
    STUDIO_AGENT_COMMAND_LEASE_MS: positiveInteger.default(30_000),
    STUDIO_AGENT_COMMAND_BATCH_SIZE: positiveInteger.max(100).default(20),
    STUDIO_AGENT_ADMISSION_LEASE_MS: positiveInteger
      .min(10_000)
      .max(900_000)
      .default(120_000),
    STUDIO_AGENT_ADMISSION_RECONCILE_INTERVAL_MS: positiveInteger
      .min(500)
      .max(60_000)
      .default(5_000),
    STUDIO_AGENT_ADMISSION_RECONCILE_BATCH_SIZE: positiveInteger
      .max(500)
      .default(50),
    STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_GLOBAL: positiveInteger
      .max(100_000)
      .default(512),
    STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_WORKSPACE: positiveInteger
      .max(10_000)
      .default(64),
    STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_USER: positiveInteger
      .max(1_000)
      .default(4),
    STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL: positiveInteger
      .max(2_000_000_000)
      .default(512_000_000),
    STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE:
      positiveInteger.max(2_000_000_000).default(64_000_000),
    STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER: positiveInteger
      .max(2_000_000_000)
      .default(4_000_000),
    STUDIO_AGENT_ATTACHMENT_TTL_MS: positiveInteger
      .min(60_000)
      .default(86_400_000),
    STUDIO_AGENT_ATTACHMENT_CLEANUP_POLL_INTERVAL_MS: positiveInteger
      .min(100)
      .default(30_000),
    STUDIO_AGENT_ATTACHMENT_CLEANUP_BATCH_SIZE: positiveInteger
      .max(100)
      .default(25),
    // Bounds rows *examined* per sweep, not orphans reclaimed: examining one
    // is an index tuple plus an artifact probe, so it runs far ahead of the
    // reclamation batch and only has to keep pace with the upload rate.
    STUDIO_AGENT_ATTACHMENT_CLEANUP_DISCOVERY_BATCH_SIZE: positiveInteger
      .max(5_000)
      .default(500),
    STUDIO_AGENT_ATTACHMENT_CLEANUP_LEASE_MS: positiveInteger
      .min(5_000)
      .default(60_000),
    STUDIO_AGENT_ATTACHMENT_CLEANUP_MAX_ATTEMPTS: positiveInteger
      .max(100)
      .default(12),
    STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_BASE_MS: positiveInteger
      .min(100)
      .default(10_000),
    STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_MAX_MS: positiveInteger
      .min(1_000)
      .default(1_800_000),
    STUDIO_AGENT_DOCUMENT_INGEST_GLOBAL_CONCURRENCY: positiveInteger
      .max(64)
      .default(4),
    STUDIO_AGENT_DOCUMENT_INGEST_MAX_ATTEMPTS: positiveInteger
      .max(50)
      .default(12),
    STUDIO_AGENT_DOCUMENT_PARSER_TIMEOUT_MS: positiveInteger
      .min(1_000)
      .max(90_000)
      .default(45_000),
    STUDIO_AGENT_DOCUMENT_PARSER_MAX_OLD_GENERATION_MB: positiveInteger
      .min(32)
      .max(512)
      .default(96),
    STUDIO_AGENT_DOCUMENT_PARSER_MAX_YOUNG_GENERATION_MB: positiveInteger
      .min(8)
      .max(128)
      .default(24),
    STUDIO_AGENT_DOCUMENT_PARSER_CODE_RANGE_MB: positiveInteger
      .min(8)
      .max(128)
      .default(32),
    STUDIO_AGENT_DOCUMENT_PARSER_STACK_MB: z.coerce
      .number()
      .positive()
      .min(1)
      .max(16)
      .default(4),
    STUDIO_AGENT_SSE_HEARTBEAT_MS: positiveInteger.default(15_000),
    STUDIO_AGENT_SSE_BATCH_SIZE: positiveInteger.max(1_000).default(250),
    STUDIO_AGENT_MODEL_PROVIDER: requiredString.default('alibaba'),
    STUDIO_AGENT_MODEL: requiredString.default('qwen3-max'),
    STUDIO_AGENT_VISION_MODEL: requiredString.default('qwen3-vl-plus'),
    STUDIO_AGENT_MODEL_TIMEOUT_MS: positiveInteger
      .min(1_000)
      .max(900_000)
      .default(120_000),
    STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS: positiveInteger
      .max(65_536)
      .default(8_192),
    STUDIO_AGENT_CONTEXT_COMPACTION_TRIGGER_RATIO: ratio.default(0.82),
    STUDIO_AGENT_CONTEXT_COMPACTION_RETAIN_TAIL_UNITS: positiveInteger
      .max(1_024)
      .default(8),
    STUDIO_AGENT_CONTEXT_COMPACTION_MAX_OUTPUT_TOKENS: positiveInteger
      .max(65_536)
      .default(2_048),
    STUDIO_AGENT_BUDGET_MAX_CHILD_DEPTH: positiveInteger.max(64).default(4),
    STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS: positiveInteger.max(10_000).default(24),
    STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS: positiveInteger
      .max(1_000)
      .default(8),
    STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN: positiveInteger
      .max(10_000)
      .default(32),
    STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT: positiveInteger
      .max(100_000)
      .default(128),
    STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS: positiveInteger
      .max(2_000_000_000)
      .default(1_000_000),
    STUDIO_AGENT_BUDGET_MAX_CONTEXT_BYTES_PER_STEP: positiveInteger
      .max(100_000_000)
      .default(2_000_000),
    STUDIO_AGENT_BUDGET_IMAGE_TOKEN_RESERVE_UNITS: nonnegativeInteger
      .max(100_000_000)
      .default(8_192),
    STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP: positiveInteger
      .max(65_536)
      .default(256),
    STUDIO_AGENT_BUDGET_WALL_TIME_MS: positiveInteger
      .min(1_000)
      .max(86_400_000)
      .default(3_600_000),
  })
  .strict()
  .superRefine((value, context) => {
    const tlsMaterial = [
      value.TEMPORAL_TLS_CA,
      value.TEMPORAL_TLS_CERT,
      value.TEMPORAL_TLS_KEY,
    ];
    const configured = tlsMaterial.filter(Boolean).length;
    if (
      value.TEMPORAL_TLS_MODE === 'mtls' &&
      configured !== tlsMaterial.length
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'TEMPORAL_TLS_MODE=mtls requires TEMPORAL_TLS_CA, TEMPORAL_TLS_CERT, and TEMPORAL_TLS_KEY.',
      });
    }
    if (
      value.TEMPORAL_TLS_MODE === 'disabled' &&
      (configured !== 0 || value.TEMPORAL_SERVER_NAME)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Temporal TLS material and TEMPORAL_SERVER_NAME are forbidden when TEMPORAL_TLS_MODE=disabled.',
      });
    }
    if (
      value.STUDIO_AGENT_CONTROL_TASK_QUEUE !== STUDIO_AGENT_CONTROL_TASK_QUEUE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_CONTROL_TASK_QUEUE'],
        message: `STUDIO_AGENT_CONTROL_TASK_QUEUE must equal ${STUDIO_AGENT_CONTROL_TASK_QUEUE} for ${STUDIO_AGENT_SCHEMA_VERSION}.`,
      });
    }
    if (
      value.STUDIO_AGENT_ACTIVITY_TASK_QUEUE !==
      STUDIO_AGENT_ACTIVITY_TASK_QUEUE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_ACTIVITY_TASK_QUEUE'],
        message: `STUDIO_AGENT_ACTIVITY_TASK_QUEUE must equal ${STUDIO_AGENT_ACTIVITY_TASK_QUEUE} for ${STUDIO_AGENT_SCHEMA_VERSION}.`,
      });
    }
    if (
      value.STUDIO_AGENT_WORKER_DEPLOYMENT_NAME !==
      STUDIO_AGENT_WORKER_DEPLOYMENT_NAME
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_WORKER_DEPLOYMENT_NAME'],
        message: `STUDIO_AGENT_WORKER_DEPLOYMENT_NAME must equal ${STUDIO_AGENT_WORKER_DEPLOYMENT_NAME} for ${STUDIO_AGENT_SCHEMA_VERSION}.`,
      });
    }
    if (
      value.STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS <
      value.STUDIO_AGENT_TEMPORAL_RECONNECT_MIN_DELAY_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS'],
        message:
          'STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS must be greater than or equal to STUDIO_AGENT_TEMPORAL_RECONNECT_MIN_DELAY_MS.',
      });
    }
    if (
      value.STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_MAX_MS <
      value.STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_BASE_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_MAX_MS'],
        message:
          'STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_MAX_MS must be greater than or equal to STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_BASE_MS.',
      });
    }
    if (
      value.STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS >
      value.STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS'],
        message:
          'STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS must not exceed STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS.',
      });
    }
    if (
      value.STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN >
      value.STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN'],
        message:
          'STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN must not exceed STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT.',
      });
    }
    if (
      value.STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP >
      value.STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP'],
        message:
          'STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP must not exceed STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS.',
      });
    }
    if (
      value.STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS >
      value.STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS'],
        message:
          'STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS must not exceed STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS.',
      });
    }
    if (
      value.STUDIO_AGENT_CONTEXT_COMPACTION_MAX_OUTPUT_TOKENS >
      value.STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_CONTEXT_COMPACTION_MAX_OUTPUT_TOKENS'],
        message:
          'STUDIO_AGENT_CONTEXT_COMPACTION_MAX_OUTPUT_TOKENS must not exceed STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS.',
      });
    }
    if (
      value.STUDIO_AGENT_BUDGET_IMAGE_TOKEN_RESERVE_UNITS +
        value.STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP >
      value.STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_BUDGET_IMAGE_TOKEN_RESERVE_UNITS'],
        message:
          'The image reservation plus minimum output reservation must fit inside STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS.',
      });
    }
    if (
      value.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_USER >
        value.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_WORKSPACE ||
      value.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_WORKSPACE >
        value.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_GLOBAL
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_USER'],
        message:
          'Studio Agent active-root limits must be ordered user <= workspace <= global.',
      });
    }
    if (
      value.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER <
        value.STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS ||
      value.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER >
        value.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE ||
      value.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE >
        value.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER'],
        message:
          'Studio Agent token-reservation limits must fit one root budget and be ordered user <= workspace <= global.',
      });
    }
  });

export interface StudioAgentServerConfig {
  temporal: {
    address: string;
    namespace: string;
    tlsMode: 'mtls' | 'disabled';
    serverName: string | undefined;
    tls:
      | {
          serverRootCACertificate: Buffer;
          clientCertPair: { crt: Buffer; key: Buffer };
        }
      | undefined;
    controlTaskQueue: string;
    activityTaskQueue: string;
    workerDeploymentName: string;
    buildId: string;
    connectTimeoutMs: number;
    healthProbeIntervalMs: number;
    reconnectMinDelayMs: number;
    reconnectMaxDelayMs: number;
    pollerStaleMs: number;
  };
  runtimeToken: string;
  commandPollIntervalMs: number;
  commandLeaseMs: number;
  commandBatchSize: number;
  admission: {
    leaseMs: number;
    reconcileIntervalMs: number;
    reconcileBatchSize: number;
    maxActiveRootRuns: {
      global: number;
      workspace: number;
      user: number;
    };
    maxReservedTokenUnits: {
      global: number;
      workspace: number;
      user: number;
    };
  };
  attachmentCleanup: {
    ttlMs: number;
    pollIntervalMs: number;
    batchSize: number;
    discoveryBatchSize: number;
    leaseMs: number;
    maxAttempts: number;
    retryBaseMs: number;
    retryMaxMs: number;
  };
  documentIngest: {
    globalConcurrency: number;
    maxAttempts: number;
    parser: {
      timeoutMs: number;
      maxOldGenerationSizeMb: number;
      maxYoungGenerationSizeMb: number;
      codeRangeSizeMb: number;
      stackSizeMb: number;
    };
  };
  sseHeartbeatMs: number;
  sseBatchSize: number;
  model: {
    provider: string;
    textModelId: string;
    visionModelId: string;
    timeoutMs: number;
    maxOutputTokens: number;
  };
  contextCompaction: {
    triggerRatio: number;
    retainTailUnits: number;
    maxOutputTokens: number;
  };
  budget: {
    maxChildDepth: number;
    maxChildRuns: number;
    maxConcurrentChildRuns: number;
    maxModelStepsPerRun: number;
    maxModelStepsPerRoot: number;
    maxTotalTokenUnits: number;
    maxContextBytesPerStep: number;
    imageTokenReserveUnits: number;
    minOutputTokenUnitsPerStep: number;
    wallTimeMs: number;
  };
}

export function studioAgentRootBudgetData(
  config: StudioAgentServerConfig,
  createdAt: Date,
) {
  return {
    maxChildDepth: config.budget.maxChildDepth,
    maxChildRuns: config.budget.maxChildRuns,
    maxConcurrentChildRuns: config.budget.maxConcurrentChildRuns,
    maxModelStepsPerRun: config.budget.maxModelStepsPerRun,
    maxModelStepsPerRoot: config.budget.maxModelStepsPerRoot,
    maxTotalTokenUnits: config.budget.maxTotalTokenUnits,
    maxContextBytesPerStep: config.budget.maxContextBytesPerStep,
    contextCompactionTriggerRatio: config.contextCompaction.triggerRatio,
    contextCompactionRetainTailUnits: config.contextCompaction.retainTailUnits,
    contextCompactionMaxOutputTokens: config.contextCompaction.maxOutputTokens,
    imageTokenReserveUnits: config.budget.imageTokenReserveUnits,
    minOutputTokenUnitsPerStep: config.budget.minOutputTokenUnitsPerStep,
    maxOutputTokenUnitsPerStep: config.model.maxOutputTokens,
    deadlineAt: new Date(createdAt.getTime() + config.budget.wallTimeMs),
    createdAt,
  };
}

export function loadStudioAgentServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): StudioAgentServerConfig {
  const parsed = StudioAgentServerEnvironmentSchema.parse({
    TEMPORAL_ADDRESS: environment.TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: environment.TEMPORAL_NAMESPACE,
    TEMPORAL_TLS_MODE: environment.TEMPORAL_TLS_MODE,
    TEMPORAL_SERVER_NAME: environment.TEMPORAL_SERVER_NAME,
    TEMPORAL_TLS_CA: environment.TEMPORAL_TLS_CA,
    TEMPORAL_TLS_CERT: environment.TEMPORAL_TLS_CERT,
    TEMPORAL_TLS_KEY: environment.TEMPORAL_TLS_KEY,
    STUDIO_AGENT_CONTROL_TASK_QUEUE:
      environment.STUDIO_AGENT_CONTROL_TASK_QUEUE,
    STUDIO_AGENT_ACTIVITY_TASK_QUEUE:
      environment.STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
    STUDIO_AGENT_WORKER_DEPLOYMENT_NAME:
      environment.STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
    STUDIO_AGENT_RELEASE: environment.STUDIO_AGENT_RELEASE,
    STUDIO_AGENT_TEMPORAL_CONNECT_TIMEOUT_MS:
      environment.STUDIO_AGENT_TEMPORAL_CONNECT_TIMEOUT_MS,
    STUDIO_AGENT_TEMPORAL_HEALTH_PROBE_INTERVAL_MS:
      environment.STUDIO_AGENT_TEMPORAL_HEALTH_PROBE_INTERVAL_MS,
    STUDIO_AGENT_TEMPORAL_RECONNECT_MIN_DELAY_MS:
      environment.STUDIO_AGENT_TEMPORAL_RECONNECT_MIN_DELAY_MS,
    STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS:
      environment.STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS,
    STUDIO_AGENT_TEMPORAL_POLLER_STALE_MS:
      environment.STUDIO_AGENT_TEMPORAL_POLLER_STALE_MS,
    STUDIO_AGENT_RUNTIME_TOKEN: environment.STUDIO_AGENT_RUNTIME_TOKEN,
    STUDIO_AGENT_COMMAND_POLL_INTERVAL_MS:
      environment.STUDIO_AGENT_COMMAND_POLL_INTERVAL_MS,
    STUDIO_AGENT_COMMAND_LEASE_MS: environment.STUDIO_AGENT_COMMAND_LEASE_MS,
    STUDIO_AGENT_COMMAND_BATCH_SIZE:
      environment.STUDIO_AGENT_COMMAND_BATCH_SIZE,
    STUDIO_AGENT_ADMISSION_LEASE_MS:
      environment.STUDIO_AGENT_ADMISSION_LEASE_MS,
    STUDIO_AGENT_ADMISSION_RECONCILE_INTERVAL_MS:
      environment.STUDIO_AGENT_ADMISSION_RECONCILE_INTERVAL_MS,
    STUDIO_AGENT_ADMISSION_RECONCILE_BATCH_SIZE:
      environment.STUDIO_AGENT_ADMISSION_RECONCILE_BATCH_SIZE,
    STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_GLOBAL:
      environment.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_GLOBAL,
    STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_WORKSPACE:
      environment.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_WORKSPACE,
    STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_USER:
      environment.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_USER,
    STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL:
      environment.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL,
    STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE:
      environment.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE,
    STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER:
      environment.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER,
    STUDIO_AGENT_ATTACHMENT_TTL_MS: environment.STUDIO_AGENT_ATTACHMENT_TTL_MS,
    STUDIO_AGENT_ATTACHMENT_CLEANUP_POLL_INTERVAL_MS:
      environment.STUDIO_AGENT_ATTACHMENT_CLEANUP_POLL_INTERVAL_MS,
    STUDIO_AGENT_ATTACHMENT_CLEANUP_BATCH_SIZE:
      environment.STUDIO_AGENT_ATTACHMENT_CLEANUP_BATCH_SIZE,
    STUDIO_AGENT_ATTACHMENT_CLEANUP_DISCOVERY_BATCH_SIZE:
      environment.STUDIO_AGENT_ATTACHMENT_CLEANUP_DISCOVERY_BATCH_SIZE,
    STUDIO_AGENT_ATTACHMENT_CLEANUP_LEASE_MS:
      environment.STUDIO_AGENT_ATTACHMENT_CLEANUP_LEASE_MS,
    STUDIO_AGENT_ATTACHMENT_CLEANUP_MAX_ATTEMPTS:
      environment.STUDIO_AGENT_ATTACHMENT_CLEANUP_MAX_ATTEMPTS,
    STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_BASE_MS:
      environment.STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_BASE_MS,
    STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_MAX_MS:
      environment.STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_MAX_MS,
    STUDIO_AGENT_DOCUMENT_INGEST_GLOBAL_CONCURRENCY:
      environment.STUDIO_AGENT_DOCUMENT_INGEST_GLOBAL_CONCURRENCY,
    STUDIO_AGENT_DOCUMENT_INGEST_MAX_ATTEMPTS:
      environment.STUDIO_AGENT_DOCUMENT_INGEST_MAX_ATTEMPTS,
    STUDIO_AGENT_DOCUMENT_PARSER_TIMEOUT_MS:
      environment.STUDIO_AGENT_DOCUMENT_PARSER_TIMEOUT_MS,
    STUDIO_AGENT_DOCUMENT_PARSER_MAX_OLD_GENERATION_MB:
      environment.STUDIO_AGENT_DOCUMENT_PARSER_MAX_OLD_GENERATION_MB,
    STUDIO_AGENT_DOCUMENT_PARSER_MAX_YOUNG_GENERATION_MB:
      environment.STUDIO_AGENT_DOCUMENT_PARSER_MAX_YOUNG_GENERATION_MB,
    STUDIO_AGENT_DOCUMENT_PARSER_CODE_RANGE_MB:
      environment.STUDIO_AGENT_DOCUMENT_PARSER_CODE_RANGE_MB,
    STUDIO_AGENT_DOCUMENT_PARSER_STACK_MB:
      environment.STUDIO_AGENT_DOCUMENT_PARSER_STACK_MB,
    STUDIO_AGENT_SSE_HEARTBEAT_MS: environment.STUDIO_AGENT_SSE_HEARTBEAT_MS,
    STUDIO_AGENT_SSE_BATCH_SIZE: environment.STUDIO_AGENT_SSE_BATCH_SIZE,
    STUDIO_AGENT_MODEL_PROVIDER: environment.STUDIO_AGENT_MODEL_PROVIDER,
    STUDIO_AGENT_MODEL: environment.STUDIO_AGENT_MODEL,
    STUDIO_AGENT_VISION_MODEL: environment.STUDIO_AGENT_VISION_MODEL,
    STUDIO_AGENT_MODEL_TIMEOUT_MS: environment.STUDIO_AGENT_MODEL_TIMEOUT_MS,
    STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS:
      environment.STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS,
    STUDIO_AGENT_CONTEXT_COMPACTION_TRIGGER_RATIO:
      environment.STUDIO_AGENT_CONTEXT_COMPACTION_TRIGGER_RATIO,
    STUDIO_AGENT_CONTEXT_COMPACTION_RETAIN_TAIL_UNITS:
      environment.STUDIO_AGENT_CONTEXT_COMPACTION_RETAIN_TAIL_UNITS,
    STUDIO_AGENT_CONTEXT_COMPACTION_MAX_OUTPUT_TOKENS:
      environment.STUDIO_AGENT_CONTEXT_COMPACTION_MAX_OUTPUT_TOKENS,
    STUDIO_AGENT_BUDGET_MAX_CHILD_DEPTH:
      environment.STUDIO_AGENT_BUDGET_MAX_CHILD_DEPTH,
    STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS:
      environment.STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS,
    STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS:
      environment.STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS,
    STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN:
      environment.STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN,
    STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT:
      environment.STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT,
    STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS:
      environment.STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS,
    STUDIO_AGENT_BUDGET_MAX_CONTEXT_BYTES_PER_STEP:
      environment.STUDIO_AGENT_BUDGET_MAX_CONTEXT_BYTES_PER_STEP,
    STUDIO_AGENT_BUDGET_IMAGE_TOKEN_RESERVE_UNITS:
      environment.STUDIO_AGENT_BUDGET_IMAGE_TOKEN_RESERVE_UNITS,
    STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP:
      environment.STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP,
    STUDIO_AGENT_BUDGET_WALL_TIME_MS:
      environment.STUDIO_AGENT_BUDGET_WALL_TIME_MS,
  });

  return {
    temporal: {
      address: parsed.TEMPORAL_ADDRESS,
      namespace: parsed.TEMPORAL_NAMESPACE,
      tlsMode: parsed.TEMPORAL_TLS_MODE,
      serverName: parsed.TEMPORAL_SERVER_NAME,
      tls:
        parsed.TEMPORAL_TLS_MODE === 'mtls'
          ? {
              serverRootCACertificate: Buffer.from(parsed.TEMPORAL_TLS_CA!),
              clientCertPair: {
                crt: Buffer.from(parsed.TEMPORAL_TLS_CERT!),
                key: Buffer.from(parsed.TEMPORAL_TLS_KEY!),
              },
            }
          : undefined,
      controlTaskQueue: parsed.STUDIO_AGENT_CONTROL_TASK_QUEUE,
      activityTaskQueue: parsed.STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
      workerDeploymentName: parsed.STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
      buildId: parsed.STUDIO_AGENT_RELEASE,
      connectTimeoutMs: parsed.STUDIO_AGENT_TEMPORAL_CONNECT_TIMEOUT_MS,
      healthProbeIntervalMs:
        parsed.STUDIO_AGENT_TEMPORAL_HEALTH_PROBE_INTERVAL_MS,
      reconnectMinDelayMs: parsed.STUDIO_AGENT_TEMPORAL_RECONNECT_MIN_DELAY_MS,
      reconnectMaxDelayMs: parsed.STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS,
      pollerStaleMs: parsed.STUDIO_AGENT_TEMPORAL_POLLER_STALE_MS,
    },
    runtimeToken: parsed.STUDIO_AGENT_RUNTIME_TOKEN,
    commandPollIntervalMs: parsed.STUDIO_AGENT_COMMAND_POLL_INTERVAL_MS,
    commandLeaseMs: parsed.STUDIO_AGENT_COMMAND_LEASE_MS,
    commandBatchSize: parsed.STUDIO_AGENT_COMMAND_BATCH_SIZE,
    admission: {
      leaseMs: parsed.STUDIO_AGENT_ADMISSION_LEASE_MS,
      reconcileIntervalMs: parsed.STUDIO_AGENT_ADMISSION_RECONCILE_INTERVAL_MS,
      reconcileBatchSize: parsed.STUDIO_AGENT_ADMISSION_RECONCILE_BATCH_SIZE,
      maxActiveRootRuns: {
        global: parsed.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_GLOBAL,
        workspace:
          parsed.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_WORKSPACE,
        user: parsed.STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_USER,
      },
      maxReservedTokenUnits: {
        global: parsed.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL,
        workspace:
          parsed.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE,
        user: parsed.STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER,
      },
    },
    attachmentCleanup: {
      ttlMs: parsed.STUDIO_AGENT_ATTACHMENT_TTL_MS,
      pollIntervalMs: parsed.STUDIO_AGENT_ATTACHMENT_CLEANUP_POLL_INTERVAL_MS,
      batchSize: parsed.STUDIO_AGENT_ATTACHMENT_CLEANUP_BATCH_SIZE,
      discoveryBatchSize:
        parsed.STUDIO_AGENT_ATTACHMENT_CLEANUP_DISCOVERY_BATCH_SIZE,
      leaseMs: parsed.STUDIO_AGENT_ATTACHMENT_CLEANUP_LEASE_MS,
      maxAttempts: parsed.STUDIO_AGENT_ATTACHMENT_CLEANUP_MAX_ATTEMPTS,
      retryBaseMs: parsed.STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_BASE_MS,
      retryMaxMs: parsed.STUDIO_AGENT_ATTACHMENT_CLEANUP_RETRY_MAX_MS,
    },
    documentIngest: {
      globalConcurrency: parsed.STUDIO_AGENT_DOCUMENT_INGEST_GLOBAL_CONCURRENCY,
      maxAttempts: parsed.STUDIO_AGENT_DOCUMENT_INGEST_MAX_ATTEMPTS,
      parser: {
        timeoutMs: parsed.STUDIO_AGENT_DOCUMENT_PARSER_TIMEOUT_MS,
        maxOldGenerationSizeMb:
          parsed.STUDIO_AGENT_DOCUMENT_PARSER_MAX_OLD_GENERATION_MB,
        maxYoungGenerationSizeMb:
          parsed.STUDIO_AGENT_DOCUMENT_PARSER_MAX_YOUNG_GENERATION_MB,
        codeRangeSizeMb: parsed.STUDIO_AGENT_DOCUMENT_PARSER_CODE_RANGE_MB,
        stackSizeMb: parsed.STUDIO_AGENT_DOCUMENT_PARSER_STACK_MB,
      },
    },
    sseHeartbeatMs: parsed.STUDIO_AGENT_SSE_HEARTBEAT_MS,
    sseBatchSize: parsed.STUDIO_AGENT_SSE_BATCH_SIZE,
    model: {
      provider: parsed.STUDIO_AGENT_MODEL_PROVIDER,
      textModelId: parsed.STUDIO_AGENT_MODEL,
      visionModelId: parsed.STUDIO_AGENT_VISION_MODEL,
      timeoutMs: parsed.STUDIO_AGENT_MODEL_TIMEOUT_MS,
      maxOutputTokens: parsed.STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS,
    },
    contextCompaction: {
      triggerRatio: parsed.STUDIO_AGENT_CONTEXT_COMPACTION_TRIGGER_RATIO,
      retainTailUnits: parsed.STUDIO_AGENT_CONTEXT_COMPACTION_RETAIN_TAIL_UNITS,
      maxOutputTokens: parsed.STUDIO_AGENT_CONTEXT_COMPACTION_MAX_OUTPUT_TOKENS,
    },
    budget: {
      maxChildDepth: parsed.STUDIO_AGENT_BUDGET_MAX_CHILD_DEPTH,
      maxChildRuns: parsed.STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS,
      maxConcurrentChildRuns:
        parsed.STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS,
      maxModelStepsPerRun: parsed.STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN,
      maxModelStepsPerRoot: parsed.STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT,
      maxTotalTokenUnits: parsed.STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS,
      maxContextBytesPerStep:
        parsed.STUDIO_AGENT_BUDGET_MAX_CONTEXT_BYTES_PER_STEP,
      imageTokenReserveUnits:
        parsed.STUDIO_AGENT_BUDGET_IMAGE_TOKEN_RESERVE_UNITS,
      minOutputTokenUnitsPerStep:
        parsed.STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP,
      wallTimeMs: parsed.STUDIO_AGENT_BUDGET_WALL_TIME_MS,
    },
  };
}

@Injectable()
export class StudioAgentConfigService {
  readonly value = loadStudioAgentServerConfig();
}
