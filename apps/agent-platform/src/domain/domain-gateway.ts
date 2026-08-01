import { createHash, randomUUID, sign } from "node:crypto";

import { z } from "zod";

import type { AgentRuntimeConfig } from "../config/env.js";
import type { AgentSessionContext } from "../context/agent-context.js";
import {
  AgentInvocationLifecycleAcknowledgementSchema,
  AgentInvocationLifecycleRequestSchema,
  AgentLongDocumentArtifactRefSchema,
  AgentLongDocumentArtifactsContextSchema,
  AgentLongDocumentManifestSchema,
  AgentLongDocumentSectionContextSchema,
} from "./agent-platform-wire-v1.js";

const MAX_DOMAIN_RESPONSE_BYTES = 2 * 1024 * 1024;
type RuntimeSchema = Readonly<{ parse(value: unknown): unknown }>;

const domainToolResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("succeeded"),
      data: z.unknown(),
      revision: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          retryable: z.literal(false),
          details: z.unknown().optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type DomainToolResult = z.infer<typeof domainToolResponseSchema>;

const resolvedAttachmentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.uuid(),
      kind: z.literal("file"),
      fileName: z.string().min(1).max(255),
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      url: z.url().refine(isSecureOrLocalUrl),
      expiresAt: z.iso.datetime({ offset: true }).nullable(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      kind: z.literal("document"),
      fileName: z.string().min(1).max(255),
      mediaType: z.enum([
        "text/plain",
        "text/markdown",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/pdf",
      ]),
      projection: z
        .object({
          schemaVersion: z.literal("story-source-material-projection/v1"),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
          document: z
            .object({
              format: z.enum(["screenplay", "markdown", "prose"]),
              characterCount: z.number().int().positive().max(200_000),
              lineCount: z.number().int().positive(),
              chunkCount: z.number().int().positive(),
              title: z.string().min(1).max(255),
              abstract: z.string().max(720),
            })
            .strict(),
          hierarchy: z
            .array(
              z
                .object({
                  level: z.number().int().min(1).max(9),
                  heading: z.string().min(1).max(240),
                  firstChunkId: z.string().regex(/^chunk-[0-9]{6}$/u),
                  abstract: z.string().max(420),
                })
                .strict()
            )
            .max(80),
          entities: z
            .object({
              characters: z
                .array(
                  z
                    .object({
                      name: z.string().min(1).max(80),
                      mentions: z.number().int().positive(),
                      firstChunkId: z.string().regex(/^chunk-[0-9]{6}$/u),
                    })
                    .strict()
                )
                .max(64),
              locations: z
                .array(
                  z
                    .object({
                      name: z.string().min(1).max(80),
                      mentions: z.number().int().positive(),
                      firstChunkId: z.string().regex(/^chunk-[0-9]{6}$/u),
                    })
                    .strict()
                )
                .max(64),
            })
            .strict(),
          continuity: z
            .object({
              scenes: z
                .array(
                  z
                    .object({
                      heading: z.string().min(1).max(240),
                      chunkId: z.string().regex(/^chunk-[0-9]{6}$/u),
                      location: z.string().min(1).max(160).nullable(),
                      timeOfDay: z.string().min(1).max(80).nullable(),
                      characters: z.array(z.string().min(1).max(80)).max(32),
                    })
                    .strict()
                )
                .max(96),
              temporalCues: z
                .array(
                  z
                    .object({
                      cue: z.string().min(1).max(160),
                      chunkId: z.string().regex(/^chunk-[0-9]{6}$/u),
                    })
                    .strict()
                )
                .max(96),
            })
            .strict(),
          representativeExcerpts: z
            .array(
              z
                .object({
                  chunkId: z.string().regex(/^chunk-[0-9]{6}$/u),
                  heading: z.string().max(240).nullable(),
                  text: z.string().min(1).max(1_000),
                })
                .strict()
            )
            .max(5),
        })
        .strict(),
    })
    .strict(),
]);
const resolvedAttachmentsSchema = z
  .object({
    schemaVersion: z.literal("agent-attachment-resolve-result/v1"),
    attachments: z.array(resolvedAttachmentSchema).max(8),
  })
  .strict();
const domainDisplayableErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2_000),
    retryable: z.boolean().optional(),
  })
  .passthrough();
const longDocumentFailAcknowledgementSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-fail-ack/v1"),
    jobId: z.uuid(),
  })
  .strict();

export type AgentInvocationLifecycle = Readonly<{
  invocationId: string;
  attemptId: string;
  attemptOrdinal: number;
  conversationId: string;
  runId: string;
  status: "running" | "waiting_for_approval" | "succeeded" | "failed" | "cancelled";
  error: Readonly<{
    code: string;
    messageKey: string;
    message: string;
    retryable: boolean;
    diagnosticId: string;
  }> | null;
}>;

export type ResolvedAgentAttachment = z.infer<typeof resolvedAttachmentSchema>;
export type LongDocumentArtifactRef = Readonly<{
  artifactId: string;
  kind: "section" | "reduce" | "final";
  level: number;
  ordinal: number;
  sourceChunkIds: readonly string[];
}>;
export type LongDocumentManifest = Readonly<{
  schemaVersion: "agent-long-document-manifest/v1";
  jobId: string;
  attachmentId: string;
  locale: string;
  sourceContentHash: string;
  document: Readonly<{
    title: string;
    format: "screenplay" | "markdown" | "prose";
    characterCount: number;
    chunkCount: number;
  }>;
  sections: readonly Readonly<{
    chunkId: string;
    ordinal: number;
    heading: string | null;
    abstract: string;
  }>[];
  completedArtifacts: readonly LongDocumentArtifactRef[];
}>;
export type LongDocumentSectionContext = Readonly<{
  schemaVersion: "agent-long-document-section-context/v1";
  jobId: string;
  locale: string;
  document: LongDocumentManifest["document"];
  section: Readonly<{
    chunkId: string;
    ordinal: number;
    heading: string | null;
    text: string;
  }>;
}>;
export type LongDocumentArtifactsContext = Readonly<{
  schemaVersion: "agent-long-document-artifacts-context/v1";
  jobId: string;
  artifacts: readonly (LongDocumentArtifactRef & Readonly<{ content: unknown }>)[];
}>;
export type LongDocumentArtifactWrite = Readonly<{
  schemaVersion: "agent-long-document-artifact-write/v1";
  jobId: string;
  kind: "section" | "reduce" | "final";
  level: number;
  ordinal: number;
  sourceChunkIds: readonly string[];
  inputArtifactIds: readonly string[];
  content: unknown;
}>;

export interface AgentRuntimeDomainGateway {
  execute(input: {
    toolId: string;
    arguments: unknown;
    context: AgentSessionContext;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<DomainToolResult>;
  resolveAttachments(input: {
    attachmentIds: readonly string[];
    context: AgentSessionContext;
    signal?: AbortSignal;
  }): Promise<ReadonlyArray<ResolvedAgentAttachment>>;
  reportInvocationLifecycle(input: {
    lifecycle: AgentInvocationLifecycle;
    traceId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  assertReady(): Promise<void>;
}

export interface LongDocumentDomainGateway {
  claimLongDocumentAnalysis(input: {
    jobId: string;
    signal?: AbortSignal;
  }): Promise<LongDocumentManifest>;
  readLongDocumentSection(input: {
    jobId: string;
    chunkId: string;
    signal?: AbortSignal;
  }): Promise<LongDocumentSectionContext>;
  readLongDocumentArtifacts(input: {
    jobId: string;
    artifactIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<LongDocumentArtifactsContext>;
  writeLongDocumentArtifact(input: {
    artifact: LongDocumentArtifactWrite;
    signal?: AbortSignal;
  }): Promise<LongDocumentArtifactRef>;
  completeLongDocumentAnalysis(input: {
    jobId: string;
    finalArtifactId: string;
    signal?: AbortSignal;
  }): Promise<LongDocumentArtifactRef>;
  failLongDocumentAnalysis(input: {
    jobId: string;
    error: Readonly<{
      code: string;
      message: string;
      retryable: boolean;
    }>;
    signal?: AbortSignal;
  }): Promise<void>;
}

export interface DomainGateway extends AgentRuntimeDomainGateway, LongDocumentDomainGateway {
  assertReady(): Promise<void>;
}

export class DomainGatewayUnavailableError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainGatewayUnavailableError";
  }
}

export class DomainAttachmentResolutionError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DomainAttachmentResolutionError";
  }
}

export class DomainLifecycleRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DomainLifecycleRejectedError";
  }
}

export class DomainDocumentAnalysisError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DomainDocumentAnalysisError";
  }
}

export class HttpDomainGateway implements DomainGateway {
  readonly #baseUrl: URL;
  readonly #credentials: AgentRuntimeConfig["domainGateway"];
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(
    config: AgentRuntimeConfig["domainGateway"],
    fetchImplementation: typeof fetch = globalThis.fetch
  ) {
    this.#baseUrl = new URL(config.url);
    this.#credentials = config;
    this.#timeoutMs = config.timeoutMs;
    this.#fetch = fetchImplementation;
  }

  async assertReady(): Promise<void> {
    const path = "/v1/agent/health/ready";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Domain gateway readiness timed out")),
      this.#timeoutMs
    );
    try {
      const response = await this.#fetch(new URL(path, this.#baseUrl), {
        headers: {
          authorization: `Bearer ${issueDomainGatewayJwt(this.#credentials, {
            method: "GET",
            path,
            body: "",
          })}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Domain gateway readiness returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async execute(input: {
    toolId: string;
    arguments: unknown;
    context: AgentSessionContext;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<DomainToolResult> {
    const path = `/v1/agent/tools/${encodeURIComponent(input.toolId)}/execute`;
    const body = JSON.stringify({
      schemaVersion: "agent-tool-request/v2",
      arguments: input.arguments,
      actor: {
        id: input.context.actorId,
        displayName: input.context.actorDisplayName,
        roles: input.context.roles,
        permissions: input.context.permissions,
      },
      scope: {
        surface: input.context.surface,
        conversationId: input.context.conversationId,
        sessionName: input.context.sessionName,
        ...input.context.scope,
      },
    });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Domain gateway request timed out")),
      this.#timeoutMs
    );
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;

    try {
      const response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${issueDomainGatewayJwt(this.#credentials, {
            method: "POST",
            path,
            body,
            toolId: input.toolId,
            idempotencyKey: input.idempotencyKey,
          })}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "x-fizzdragon-trace-id": input.context.traceId,
        },
        body,
        signal,
      });

      const payload = await readJson(response);
      const result = domainToolResponseSchema.parse(payload);
      if (response.ok && result.status === "succeeded") {
        return result;
      }
      if (
        (response.status === 403 || response.status === 409 || response.status === 422) &&
        result.status === "rejected"
      ) {
        return result;
      }

      if (
        response.ok ||
        response.status === 403 ||
        response.status === 409 ||
        response.status === 422
      ) {
        throw new DomainGatewayUnavailableError(
          `Domain gateway returned a response contract inconsistent with HTTP ${response.status}`
        );
      }
      throw new DomainGatewayUnavailableError(`Domain gateway returned HTTP ${response.status}`);
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason;
      if (error instanceof DomainGatewayUnavailableError) throw error;
      throw new DomainGatewayUnavailableError("Domain gateway request failed", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveAttachments(input: {
    attachmentIds: readonly string[];
    context: AgentSessionContext;
    signal?: AbortSignal;
  }): Promise<ReadonlyArray<ResolvedAgentAttachment>> {
    const path = "/v1/agent/attachments/resolve";
    const body = JSON.stringify({
      schemaVersion: "agent-attachment-resolve/v1",
      actor: {
        id: input.context.actorId,
        displayName: input.context.actorDisplayName,
      },
      scope: {
        surface: input.context.surface,
        conversationId: input.context.conversationId,
        sessionName: input.context.sessionName,
        ...input.context.scope,
      },
      locale: input.context.locale,
      attachmentIds: [...input.attachmentIds],
    });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Domain gateway request timed out")),
      this.#timeoutMs
    );
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;

    try {
      const response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${issueDomainGatewayJwt(this.#credentials, {
            method: "POST",
            path,
            body,
          })}`,
          "content-type": "application/json",
          "x-fizzdragon-trace-id": input.context.traceId,
        },
        body,
        signal,
      });
      const payload = await readJson(response);
      if (response.ok) {
        const parsed = resolvedAttachmentsSchema.parse(payload);
        if (
          parsed.attachments.length !== input.attachmentIds.length ||
          parsed.attachments.some(
            (attachment, index) => attachment.id !== input.attachmentIds[index]
          )
        ) {
          throw new DomainGatewayUnavailableError(
            "Domain gateway returned attachments out of canonical order"
          );
        }
        return parsed.attachments;
      }
      if ([403, 404, 409, 413, 415, 422].includes(response.status)) {
        const error = domainDisplayableErrorSchema.safeParse(payload);
        if (error.success) {
          throw new DomainAttachmentResolutionError(error.data.code, error.data.message);
        }
      }
      throw new DomainGatewayUnavailableError(`Domain gateway returned HTTP ${response.status}`);
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason;
      if (
        error instanceof DomainGatewayUnavailableError ||
        error instanceof DomainAttachmentResolutionError
      ) {
        throw error;
      }
      throw new DomainGatewayUnavailableError("Domain gateway request failed", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async reportInvocationLifecycle(input: {
    lifecycle: AgentInvocationLifecycle;
    traceId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const path = `/v1/agent/invocations/${encodeURIComponent(
      input.lifecycle.invocationId
    )}/lifecycle`;
    const body = JSON.stringify(
      AgentInvocationLifecycleRequestSchema.parse({
        schemaVersion: "agent-invocation-lifecycle/v1",
        ...input.lifecycle,
      })
    );
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Domain gateway request timed out")),
      this.#timeoutMs
    );
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;

    try {
      const response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${issueDomainGatewayJwt(this.#credentials, {
            method: "POST",
            path,
            body,
          })}`,
          "content-type": "application/json",
          "x-fizzdragon-trace-id": input.traceId,
        },
        body,
        signal,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        // A structured 404/409/422 is the product's own verdict on this
        // transition. Reporting it as unavailable would make the projector
        // repair a callback that will never be accepted, forever.
        if ([404, 409, 422].includes(response.status)) {
          const rejection = domainDisplayableErrorSchema.safeParse(payload);
          if (rejection.success) {
            throw new DomainLifecycleRejectedError(
              rejection.data.code,
              rejection.data.message,
              rejection.data.retryable ?? false
            );
          }
        }
        throw new DomainGatewayUnavailableError(`Domain gateway returned HTTP ${response.status}`);
      }
      const acknowledgement = AgentInvocationLifecycleAcknowledgementSchema.parse(payload);
      if (
        acknowledgement.invocationId !== input.lifecycle.invocationId ||
        acknowledgement.attemptId !== input.lifecycle.attemptId ||
        acknowledgement.attemptOrdinal !== input.lifecycle.attemptOrdinal
      ) {
        throw new DomainGatewayUnavailableError(
          "Domain gateway acknowledged a different Agent invocation attempt"
        );
      }
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason;
      if (
        error instanceof DomainGatewayUnavailableError ||
        error instanceof DomainLifecycleRejectedError
      ) {
        throw error;
      }
      throw new DomainGatewayUnavailableError("Domain gateway request failed", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async claimLongDocumentAnalysis(input: {
    jobId: string;
    signal?: AbortSignal;
  }): Promise<LongDocumentManifest> {
    const jobId = z.uuid().parse(input.jobId);
    return (await this.#postDocumentAnalysis(
      `/v1/agent/document-analysis/${encodeURIComponent(jobId)}/claim`,
      {
        schemaVersion: "agent-long-document-analysis-workflow/v1",
        jobId,
      },
      AgentLongDocumentManifestSchema as unknown as RuntimeSchema,
      input.signal
    )) as LongDocumentManifest;
  }

  async readLongDocumentSection(input: {
    jobId: string;
    chunkId: string;
    signal?: AbortSignal;
  }): Promise<LongDocumentSectionContext> {
    const jobId = z.uuid().parse(input.jobId);
    const chunkId = z
      .string()
      .regex(/^chunk-[0-9]{6}$/u)
      .parse(input.chunkId);
    return (await this.#postDocumentAnalysis(
      `/v1/agent/document-analysis/${encodeURIComponent(
        jobId
      )}/sections/${encodeURIComponent(chunkId)}/read`,
      {
        schemaVersion: "agent-long-document-section-read/v1",
        jobId,
        chunkId,
      },
      AgentLongDocumentSectionContextSchema as unknown as RuntimeSchema,
      input.signal
    )) as LongDocumentSectionContext;
  }

  async readLongDocumentArtifacts(input: {
    jobId: string;
    artifactIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<LongDocumentArtifactsContext> {
    const jobId = z.uuid().parse(input.jobId);
    return (await this.#postDocumentAnalysis(
      `/v1/agent/document-analysis/${encodeURIComponent(jobId)}/artifacts/context`,
      {
        schemaVersion: "agent-long-document-artifacts-context-request/v1",
        jobId,
        artifactIds: [...input.artifactIds],
      },
      AgentLongDocumentArtifactsContextSchema as unknown as RuntimeSchema,
      input.signal
    )) as LongDocumentArtifactsContext;
  }

  async writeLongDocumentArtifact(input: {
    artifact: LongDocumentArtifactWrite;
    signal?: AbortSignal;
  }): Promise<LongDocumentArtifactRef> {
    return (await this.#postDocumentAnalysis(
      `/v1/agent/document-analysis/${encodeURIComponent(input.artifact.jobId)}/artifacts`,
      input.artifact,
      AgentLongDocumentArtifactRefSchema as unknown as RuntimeSchema,
      input.signal
    )) as LongDocumentArtifactRef;
  }

  async completeLongDocumentAnalysis(input: {
    jobId: string;
    finalArtifactId: string;
    signal?: AbortSignal;
  }): Promise<LongDocumentArtifactRef> {
    const body = {
      schemaVersion: "agent-long-document-complete/v1",
      jobId: z.uuid().parse(input.jobId),
      finalArtifactId: z.uuid().parse(input.finalArtifactId),
    } as const;
    return (await this.#postDocumentAnalysis(
      `/v1/agent/document-analysis/${encodeURIComponent(body.jobId)}/complete`,
      body,
      AgentLongDocumentArtifactRefSchema as unknown as RuntimeSchema,
      input.signal
    )) as LongDocumentArtifactRef;
  }

  async failLongDocumentAnalysis(input: {
    jobId: string;
    error: Readonly<{
      code: string;
      message: string;
      retryable: boolean;
    }>;
    signal?: AbortSignal;
  }): Promise<void> {
    const body = {
      schemaVersion: "agent-long-document-fail/v1",
      jobId: z.uuid().parse(input.jobId),
      error: {
        code: z.string().min(1).max(128).parse(input.error.code),
        message: z.string().min(1).max(2_000).parse(input.error.message),
        retryable: input.error.retryable,
      },
    } as const;
    const acknowledgement = (await this.#postDocumentAnalysis(
      `/v1/agent/document-analysis/${encodeURIComponent(body.jobId)}/fail`,
      body,
      longDocumentFailAcknowledgementSchema as unknown as RuntimeSchema,
      input.signal
    )) as z.infer<typeof longDocumentFailAcknowledgementSchema>;
    if (acknowledgement.jobId !== body.jobId) {
      throw new DomainGatewayUnavailableError(
        "Domain gateway acknowledged a different document analysis job"
      );
    }
  }

  async #postDocumentAnalysis(
    path: string,
    value: unknown,
    responseSchema: RuntimeSchema,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    const body = JSON.stringify(value);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Document analysis request timed out")),
      this.#timeoutMs
    );
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;

    try {
      const response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${issueDomainGatewayJwt(this.#credentials, {
            method: "POST",
            path,
            body,
          })}`,
          "content-type": "application/json",
        },
        body,
        signal,
      });
      const payload = await readJson(response);
      if (response.ok) return responseSchema.parse(payload);

      const publicError = domainDisplayableErrorSchema.safeParse(payload);
      if (publicError.success && response.status >= 400 && response.status < 500) {
        throw new DomainDocumentAnalysisError(
          publicError.data.code,
          publicError.data.message,
          publicError.data.retryable ?? false
        );
      }
      throw new DomainGatewayUnavailableError(`Domain gateway returned HTTP ${response.status}`);
    } catch (error) {
      if (externalSignal?.aborted) throw externalSignal.reason;
      if (
        error instanceof DomainGatewayUnavailableError ||
        error instanceof DomainDocumentAnalysisError
      ) {
        throw error;
      }
      throw new DomainGatewayUnavailableError("Document analysis domain request failed", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

type DomainRequestBinding = Readonly<{
  method: "GET" | "POST";
  path: string;
  body: string;
  toolId?: string;
  idempotencyKey?: string;
}>;

function issueDomainGatewayJwt(
  config: AgentRuntimeConfig["domainGateway"],
  binding: DomainRequestBinding
): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = {
    alg: "EdDSA",
    kid: config.signingKeyId,
    typ: "JWT",
  };
  const payload = {
    iss: config.issuer,
    aud: config.audience,
    sub: "fizzdragon-agent-platform",
    iat: now,
    exp: now + config.tokenTtlSeconds,
    jti: randomUUID(),
    request_method: binding.method,
    request_path: binding.path,
    body_sha256: createHash("sha256").update(binding.body).digest("hex"),
    ...(binding.toolId ? { tool_id: binding.toolId } : {}),
    ...(binding.idempotencyKey ? { idempotency_key: binding.idempotencyKey } : {}),
  };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString(
    "base64url"
  )}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const signature = sign(null, Buffer.from(signingInput), config.signingPrivateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOMAIN_RESPONSE_BYTES) {
    throw new DomainGatewayUnavailableError(
      `Domain gateway response exceeded ${MAX_DOMAIN_RESPONSE_BYTES} bytes`
    );
  }

  try {
    if (!response.body) {
      throw new Error("response body is empty");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let body = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_DOMAIN_RESPONSE_BYTES) {
        await reader.cancel();
        throw new DomainGatewayUnavailableError(
          `Domain gateway response exceeded ${MAX_DOMAIN_RESPONSE_BYTES} bytes`
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof DomainGatewayUnavailableError) throw error;
    throw new DomainGatewayUnavailableError(
      `Domain gateway returned a non-JSON HTTP ${response.status} response`,
      { cause: error }
    );
  }
}

function isSecureOrLocalUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
  );
}
