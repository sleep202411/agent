import { createPrivateKey, type KeyObject } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const requiredString = z.string().trim().min(1);
const requiredPositiveInteger = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const httpUrl = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'must use http or https',
  });
const environmentSchema = z
  .object({
    AGENT_PLATFORM_URL: httpUrl,
    AGENT_PLATFORM_JWT_PRIVATE_KEY_B64: requiredString,
    AGENT_PLATFORM_JWT_KEY_ID: requiredString.regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
    ),
    AGENT_PLATFORM_JWT_ISSUER: httpUrl,
    AGENT_PLATFORM_JWT_AUDIENCE: requiredString,
    AGENT_PLATFORM_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(15 * 60)
      .default(5 * 60),
    AGENT_PLATFORM_ABLY_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(15 * 60)
      .default(5 * 60),
    AGENT_PLATFORM_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(30_000)
      .default(5_000),
    AGENT_INVOCATION_DISPATCH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30_000)
      .default(500),
    AGENT_INVOCATION_DISPATCH_LEASE_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(5 * 60_000)
      .default(45_000),
    AGENT_INVOCATION_DISPATCH_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(32)
      .default(8),
    // A deterministic admission failure must terminalize instead of holding
    // its reserved capacity forever; every queue in this module is bounded.
    AGENT_INVOCATION_DISPATCH_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10),
    // `waiting_for_approval` holds admission capacity and the session
    // Workflow suspends without a deadline, so the product owns the clock.
    AGENT_APPROVAL_WAIT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60_000)
      .default(60 * 60_000),
    // Admission is a correctness boundary, not an optional tuning layer.
    // Every deployment must state the capacity it is willing to reserve.
    AGENT_ADMISSION_PROVIDER_LANE: requiredString.regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    ),
    AGENT_ADMISSION_RETRY_AFTER_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(300),
    AGENT_ADMISSION_RESERVED_TOKEN_UNITS_PER_RUN: requiredPositiveInteger,
    AGENT_ADMISSION_RESERVED_COST_MICROUSD_PER_RUN: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_ACTIVE_GLOBAL: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_ACTIVE_PER_WORKSPACE: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_ACTIVE_PER_ACTOR: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_ACTIVE_PER_PROVIDER_LANE: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE:
      requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_ACTOR: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_PROVIDER_LANE:
      requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_GLOBAL: requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_WORKSPACE:
      requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR:
      requiredPositiveInteger,
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_PROVIDER_LANE:
      requiredPositiveInteger,
    AGENT_ATTACHMENT_PARSER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000),
    AGENT_ATTACHMENT_INGEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(5 * 60_000)
      .default(120_000),
    AGENT_ATTACHMENT_INGEST_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30_000)
      .default(500),
    AGENT_ATTACHMENT_INGEST_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(32)
      .default(4),
    AGENT_ATTACHMENT_PROCESSING_LEASE_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .max(10 * 60_000)
      .default(180_000),
    AGENT_ATTACHMENT_PROCESSING_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3),
    AGENT_ATTACHMENT_PARSER_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(16)
      .default(2),
    AGENT_ATTACHMENT_PARSER_MAX_OLD_MB: z.coerce
      .number()
      .int()
      .min(64)
      .max(512)
      .default(192),
    AGENT_ATTACHMENT_PARSER_MAX_YOUNG_MB: z.coerce
      .number()
      .int()
      .min(16)
      .max(128)
      .default(32),
    AGENT_ATTACHMENT_PARSER_CODE_RANGE_MB: z.coerce
      .number()
      .int()
      .min(16)
      .max(128)
      .default(32),
    AGENT_ATTACHMENT_PARSER_STACK_MB: z.coerce
      .number()
      .int()
      .min(1)
      .max(16)
      .default(4),
    TEMPORAL_ADDRESS: requiredString,
    TEMPORAL_NAMESPACE: requiredString,
    AGENT_PLATFORM_TEMPORAL_TASK_QUEUE: requiredString,
    AGENT_DOCUMENT_ANALYSIS_DISPATCH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30_000)
      .default(500),
    AGENT_DOCUMENT_ANALYSIS_DISPATCH_LEASE_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(5 * 60_000)
      .default(45_000),
    AGENT_DOCUMENT_ANALYSIS_DISPATCH_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(32)
      .default(4),
    AGENT_DOCUMENT_ANALYSIS_DISPATCH_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10),
    // How long a `running` job may go without writing progress before the
    // dispatcher assumes its Worker is gone and re-dispatches it. This bounds
    // the gap BETWEEN progress writes, not the whole analysis, so it can stay
    // well under the longest legitimate document. Raise it if a slow provider
    // makes a single mapped section exceed this window.
    AGENT_DOCUMENT_ANALYSIS_STALE_RUN_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(6 * 60 * 60)
      .default(15 * 60),
  })
  .passthrough();

export type AgentPlatformGatewayConfig = Readonly<{
  agentUrl: URL;
  signingPrivateKey: KeyObject;
  signingKeyId: string;
  issuer: string;
  audience: string;
  agentTokenTtlSeconds: number;
  ablyTokenTtlSeconds: number;
  requestTimeoutMs: number;
  invocationDispatchIntervalMs: number;
  invocationDispatchLeaseMs: number;
  invocationDispatchConcurrency: number;
  invocationDispatchMaxAttempts: number;
  approvalWaitTimeoutMs: number;
  admission: Readonly<{
    providerLane: string;
    retryAfterSeconds: number;
    reservation: Readonly<{
      tokenUnits: bigint;
      costMicrousd: bigint;
    }>;
    limits: Readonly<{
      activeRuns: Readonly<{
        global: number;
        workspace: number;
        actor: number;
        providerLane: number;
      }>;
      reservedTokenUnits: Readonly<{
        global: bigint;
        workspace: bigint;
        actor: bigint;
        providerLane: bigint;
      }>;
      reservedCostMicrousd: Readonly<{
        global: bigint;
        workspace: bigint;
        actor: bigint;
        providerLane: bigint;
      }>;
    }>;
  }>;
  attachmentProcessingLeaseMs: number;
  attachmentProcessingMaxAttempts: number;
  attachmentParserConcurrency: number;
  attachmentIngestTimeoutMs: number;
  attachmentIngestIntervalMs: number;
  attachmentIngestBatchSize: number;
  attachmentParser: Readonly<{
    timeoutMs: number;
    resourceLimits: Readonly<{
      maxOldGenerationSizeMb: number;
      maxYoungGenerationSizeMb: number;
      codeRangeSizeMb: number;
      stackSizeMb: number;
    }>;
  }>;
  temporal: Readonly<{
    address: string;
    namespace: string;
    documentTaskQueue: string;
  }>;
  documentAnalysisDispatchIntervalMs: number;
  documentAnalysisDispatchLeaseMs: number;
  documentAnalysisDispatchConcurrency: number;
  documentAnalysisDispatchMaxAttempts: number;
  documentAnalysisStaleRunSeconds: number;
}>;

export function loadAgentPlatformGatewayConfig(
  environment: NodeJS.ProcessEnv,
): AgentPlatformGatewayConfig {
  const parsed = environmentSchema.parse(environment);
  const privateKeyPem = decodeBase64Secret(
    parsed.AGENT_PLATFORM_JWT_PRIVATE_KEY_B64,
    'AGENT_PLATFORM_JWT_PRIVATE_KEY_B64',
  );
  let signingPrivateKey: KeyObject;
  try {
    signingPrivateKey = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error(
      'AGENT_PLATFORM_JWT_PRIVATE_KEY_B64 must encode a PKCS#8 Ed25519 private key',
    );
  }
  if (signingPrivateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      'AGENT_PLATFORM_JWT_PRIVATE_KEY_B64 must encode an Ed25519 private key',
    );
  }

  if (
    parsed.AGENT_INVOCATION_DISPATCH_LEASE_MS <
    parsed.AGENT_PLATFORM_REQUEST_TIMEOUT_MS + 5_000
  ) {
    throw new Error(
      'AGENT_INVOCATION_DISPATCH_LEASE_MS must exceed AGENT_PLATFORM_REQUEST_TIMEOUT_MS by at least 5000ms',
    );
  }
  if (
    parsed.AGENT_ATTACHMENT_PROCESSING_LEASE_MS <
    parsed.AGENT_ATTACHMENT_INGEST_TIMEOUT_MS + 10_000
  ) {
    throw new Error(
      'AGENT_ATTACHMENT_PROCESSING_LEASE_MS must exceed AGENT_ATTACHMENT_INGEST_TIMEOUT_MS by at least 10000ms',
    );
  }

  assertAdmissionHierarchy(parsed);

  return Object.freeze({
    agentUrl: new URL(parsed.AGENT_PLATFORM_URL),
    signingPrivateKey,
    signingKeyId: parsed.AGENT_PLATFORM_JWT_KEY_ID,
    issuer: parsed.AGENT_PLATFORM_JWT_ISSUER,
    audience: parsed.AGENT_PLATFORM_JWT_AUDIENCE,
    agentTokenTtlSeconds: parsed.AGENT_PLATFORM_TOKEN_TTL_SECONDS,
    ablyTokenTtlSeconds: parsed.AGENT_PLATFORM_ABLY_TOKEN_TTL_SECONDS,
    requestTimeoutMs: parsed.AGENT_PLATFORM_REQUEST_TIMEOUT_MS,
    invocationDispatchIntervalMs: parsed.AGENT_INVOCATION_DISPATCH_INTERVAL_MS,
    invocationDispatchLeaseMs: parsed.AGENT_INVOCATION_DISPATCH_LEASE_MS,
    invocationDispatchConcurrency: parsed.AGENT_INVOCATION_DISPATCH_CONCURRENCY,
    invocationDispatchMaxAttempts:
      parsed.AGENT_INVOCATION_DISPATCH_MAX_ATTEMPTS,
    approvalWaitTimeoutMs: parsed.AGENT_APPROVAL_WAIT_TIMEOUT_MS,
    admission: Object.freeze({
      providerLane: parsed.AGENT_ADMISSION_PROVIDER_LANE,
      retryAfterSeconds: parsed.AGENT_ADMISSION_RETRY_AFTER_SECONDS,
      reservation: Object.freeze({
        tokenUnits: BigInt(parsed.AGENT_ADMISSION_RESERVED_TOKEN_UNITS_PER_RUN),
        costMicrousd: BigInt(
          parsed.AGENT_ADMISSION_RESERVED_COST_MICROUSD_PER_RUN,
        ),
      }),
      limits: Object.freeze({
        activeRuns: Object.freeze({
          global: parsed.AGENT_ADMISSION_MAX_ACTIVE_GLOBAL,
          workspace: parsed.AGENT_ADMISSION_MAX_ACTIVE_PER_WORKSPACE,
          actor: parsed.AGENT_ADMISSION_MAX_ACTIVE_PER_ACTOR,
          providerLane: parsed.AGENT_ADMISSION_MAX_ACTIVE_PER_PROVIDER_LANE,
        }),
        reservedTokenUnits: Object.freeze({
          global: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL,
          ),
          workspace: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE,
          ),
          actor: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_ACTOR,
          ),
          providerLane: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_PROVIDER_LANE,
          ),
        }),
        reservedCostMicrousd: Object.freeze({
          global: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_GLOBAL,
          ),
          workspace: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_WORKSPACE,
          ),
          actor: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR,
          ),
          providerLane: BigInt(
            parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_PROVIDER_LANE,
          ),
        }),
      }),
    }),
    attachmentProcessingLeaseMs: parsed.AGENT_ATTACHMENT_PROCESSING_LEASE_MS,
    attachmentProcessingMaxAttempts:
      parsed.AGENT_ATTACHMENT_PROCESSING_MAX_ATTEMPTS,
    attachmentParserConcurrency: parsed.AGENT_ATTACHMENT_PARSER_CONCURRENCY,
    attachmentIngestTimeoutMs: parsed.AGENT_ATTACHMENT_INGEST_TIMEOUT_MS,
    attachmentIngestIntervalMs: parsed.AGENT_ATTACHMENT_INGEST_INTERVAL_MS,
    attachmentIngestBatchSize: parsed.AGENT_ATTACHMENT_INGEST_BATCH_SIZE,
    attachmentParser: Object.freeze({
      timeoutMs: parsed.AGENT_ATTACHMENT_PARSER_TIMEOUT_MS,
      resourceLimits: Object.freeze({
        maxOldGenerationSizeMb: parsed.AGENT_ATTACHMENT_PARSER_MAX_OLD_MB,
        maxYoungGenerationSizeMb: parsed.AGENT_ATTACHMENT_PARSER_MAX_YOUNG_MB,
        codeRangeSizeMb: parsed.AGENT_ATTACHMENT_PARSER_CODE_RANGE_MB,
        stackSizeMb: parsed.AGENT_ATTACHMENT_PARSER_STACK_MB,
      }),
    }),
    temporal: Object.freeze({
      address: parsed.TEMPORAL_ADDRESS,
      namespace: parsed.TEMPORAL_NAMESPACE,
      documentTaskQueue: `${parsed.AGENT_PLATFORM_TEMPORAL_TASK_QUEUE}-document`,
    }),
    documentAnalysisDispatchIntervalMs:
      parsed.AGENT_DOCUMENT_ANALYSIS_DISPATCH_INTERVAL_MS,
    documentAnalysisDispatchLeaseMs:
      parsed.AGENT_DOCUMENT_ANALYSIS_DISPATCH_LEASE_MS,
    documentAnalysisDispatchConcurrency:
      parsed.AGENT_DOCUMENT_ANALYSIS_DISPATCH_CONCURRENCY,
    documentAnalysisDispatchMaxAttempts:
      parsed.AGENT_DOCUMENT_ANALYSIS_DISPATCH_MAX_ATTEMPTS,
    documentAnalysisStaleRunSeconds:
      parsed.AGENT_DOCUMENT_ANALYSIS_STALE_RUN_SECONDS,
  });
}

type ParsedEnvironment = z.infer<typeof environmentSchema>;

function assertAdmissionHierarchy(parsed: ParsedEnvironment): void {
  assertDescendingLimits(
    'AGENT_ADMISSION_MAX_ACTIVE',
    parsed.AGENT_ADMISSION_MAX_ACTIVE_GLOBAL,
    parsed.AGENT_ADMISSION_MAX_ACTIVE_PER_WORKSPACE,
    parsed.AGENT_ADMISSION_MAX_ACTIVE_PER_ACTOR,
  );
  assertDescendingLimits(
    'AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS',
    parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL,
    parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE,
    parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_ACTOR,
  );
  assertDescendingLimits(
    'AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD',
    parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_GLOBAL,
    parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_WORKSPACE,
    parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR,
  );

  const tokenReservation = parsed.AGENT_ADMISSION_RESERVED_TOKEN_UNITS_PER_RUN;
  const costReservation = parsed.AGENT_ADMISSION_RESERVED_COST_MICROUSD_PER_RUN;
  if (
    parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_ACTOR <
      tokenReservation ||
    parsed.AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_PROVIDER_LANE <
      tokenReservation
  ) {
    throw new Error(
      'Agent admission token limits must each contain one per-run reservation',
    );
  }
  if (
    parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR <
      costReservation ||
    parsed.AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_PROVIDER_LANE <
      costReservation
  ) {
    throw new Error(
      'Agent admission cost limits must each contain one per-run reservation',
    );
  }
}

function assertDescendingLimits(
  label: string,
  global: number,
  workspace: number,
  actor: number,
): void {
  if (global < workspace || workspace < actor) {
    throw new Error(`${label} must satisfy global >= workspace >= actor`);
  }
}

@Injectable()
export class AgentPlatformGatewayConfigService {
  readonly values = loadAgentPlatformGatewayConfig(process.env);
}

function decodeBase64Secret(value: string, variable: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length === 0 ||
    decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
  ) {
    throw new Error(`${variable} must be canonical base64`);
  }
  return decoded;
}
