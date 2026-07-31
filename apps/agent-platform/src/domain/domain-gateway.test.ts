import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AgentSessionContext } from "../context/agent-context.js";
import { DomainGatewayUnavailableError, HttpDomainGateway } from "./domain-gateway.js";

const context: AgentSessionContext = {
  actorId: "actor-1",
  actorDisplayName: "Actor One",
  conversationId: "0197f4a2-0800-7000-8000-000000000004",
  surface: "story-studio",
  sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
  permissionMode: "smart",
  scope: {
    kind: "story-project",
    workspaceId: "workspace-1",
    projectId: "project-1",
  },
  locale: "en-US",
  roles: ["creator"],
  permissions: ["story.read"],
  traceId: "trace-1",
};
const domainKeyPair = generateKeyPairSync("ed25519");

describe("HttpDomainGateway", () => {
  it("forwards idempotency and signed scope and validates the response", async () => {
    const responseBody = {
      status: "succeeded",
      data: { storyId: "story-1" },
      revision: 8,
    } as const;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(responseBody));
    const gateway = createGateway(fetchImplementation);

    await expect(
      gateway.execute({
        toolId: "story_get_snapshot",
        arguments: { storyId: "story-1" },
        context,
        idempotencyKey: "run-1:tool-1",
      })
    ).resolves.toEqual(responseBody);

    const [, request] = fetchImplementation.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    const token = headers.get("authorization")?.replace(/^Bearer /u, "");
    expect(token).toBeTruthy();
    const [headerPart, payloadPart, signaturePart] = token!.split(".");
    const claims = JSON.parse(Buffer.from(payloadPart!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(
      verify(
        null,
        Buffer.from(`${headerPart}.${payloadPart}`),
        createPublicKey(domainKeyPair.privateKey),
        Buffer.from(signaturePart!, "base64url")
      )
    ).toBe(true);
    expect(claims).toMatchObject({
      iss: "fizzdragon-agent-platform",
      aud: "fizzdragon-domain-gateway",
      sub: "fizzdragon-agent-platform",
      request_method: "POST",
      request_path: "/v1/agent/tools/story_get_snapshot/execute",
      tool_id: "story_get_snapshot",
      idempotency_key: "run-1:tool-1",
    });
    expect(claims.body_sha256).toBe(
      createHash("sha256").update(String(request?.body)).digest("hex")
    );
    expect(Number(claims.exp) - Number(claims.iat)).toBe(30);
    expect(headers.get("idempotency-key")).toBe("run-1:tool-1");
    expect(headers.get("x-fizzdragon-trace-id")).toBe("trace-1");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      scope: {
        conversationId: context.conversationId,
        sessionName: context.sessionName,
      },
    });
  });

  it("returns a structured domain rejection instead of retrying it", async () => {
    const responseBody = {
      status: "rejected",
      error: {
        code: "STORY_REVISION_CONFLICT",
        message: "The story revision changed.",
        retryable: false,
      },
    } as const;
    const gateway = createGateway(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(responseBody, { status: 409 }))
    );

    await expect(
      gateway.execute({
        toolId: "story_apply_change_set",
        arguments: {},
        context,
        idempotencyKey: "run-1:tool-2",
      })
    ).resolves.toEqual(responseBody);
  });

  it("resolves attachments through a body-bound non-idempotent workload request", async () => {
    const attachmentId = "0197f4a2-0800-7000-8000-000000000009";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        schemaVersion: "agent-attachment-resolve-result/v1",
        attachments: [
          {
            id: attachmentId,
            kind: "file",
            fileName: "reference.png",
            mediaType: "image/png",
            url: "https://media.example.com/reference.png?signature=secret",
            expiresAt: "2026-07-30T12:05:00.000Z",
          },
        ],
      })
    );
    const gateway = createGateway(fetchImplementation);

    await expect(
      gateway.resolveAttachments({
        attachmentIds: [attachmentId],
        context,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: attachmentId,
        kind: "file",
      }),
    ]);

    const [, request] = fetchImplementation.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    const token = headers.get("authorization")?.replace(/^Bearer /u, "");
    const [, payloadPart] = token!.split(".");
    const claims = JSON.parse(Buffer.from(payloadPart!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      request_method: "POST",
      request_path: "/v1/agent/attachments/resolve",
    });
    expect(claims).not.toHaveProperty("tool_id");
    expect(claims).not.toHaveProperty("idempotency_key");
    expect(headers.has("idempotency-key")).toBe(false);
    expect(JSON.parse(String(request?.body))).toMatchObject({
      schemaVersion: "agent-attachment-resolve/v1",
      actor: { id: context.actorId },
      scope: {
        conversationId: context.conversationId,
        sessionName: context.sessionName,
      },
      attachmentIds: [attachmentId],
    });
  });

  it("fails closed when attachment resolution order changes", async () => {
    const first = "0197f4a2-0800-7000-8000-000000000009";
    const second = "0197f4a2-0800-7000-8000-000000000010";
    const gateway = createGateway(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          schemaVersion: "agent-attachment-resolve-result/v1",
          attachments: [
            {
              id: second,
              kind: "document",
              fileName: "second.md",
              mediaType: "text/markdown",
              projection: documentProjection("second"),
            },
            {
              id: first,
              kind: "document",
              fileName: "first.md",
              mediaType: "text/markdown",
              projection: documentProjection("first"),
            },
          ],
        })
      )
    );

    await expect(
      gateway.resolveAttachments({
        attachmentIds: [first, second],
        context,
      })
    ).rejects.toThrow(/canonical order/);
  });

  it("reports invocation lifecycle through a body-bound workload request", async () => {
    const invocationId = "0197f4a2-0800-7000-8000-000000000010";
    const runId = "0197f4a2-0800-7000-8000-000000000011";
    const attemptId = "0197f4a2-0800-7000-8000-000000000013";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        schemaVersion: "agent-invocation-lifecycle-ack/v1",
        invocationId,
        attemptId,
        attemptOrdinal: 1,
      })
    );
    const gateway = createGateway(fetchImplementation);

    await gateway.reportInvocationLifecycle({
      lifecycle: {
        invocationId,
        attemptId,
        attemptOrdinal: 1,
        conversationId: context.conversationId,
        runId,
        status: "failed",
        error: {
          code: "AGENT_RUN_OPEN_FAILED",
          messageKey: "agent.error.start_failed",
          message: "The triggering input could not be located.",
          retryable: false,
          diagnosticId: "0197f4a2-0800-7000-8000-000000000012",
        },
      },
      traceId: context.traceId,
    });

    const [target, request] = fetchImplementation.mock.calls[0]!;
    expect(String(target)).toBe(
      `https://domain-gateway.example.com/v1/agent/invocations/${invocationId}/lifecycle`
    );
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      schemaVersion: "agent-invocation-lifecycle/v1",
      invocationId,
      attemptId,
      attemptOrdinal: 1,
      conversationId: context.conversationId,
      runId,
      status: "failed",
    });
    const headers = new Headers(request?.headers);
    const token = headers.get("authorization")?.replace(/^Bearer /u, "");
    const [, payloadPart] = token!.split(".");
    const claims = JSON.parse(Buffer.from(payloadPart!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      request_method: "POST",
      request_path: `/v1/agent/invocations/${invocationId}/lifecycle`,
      body_sha256: createHash("sha256").update(String(request?.body)).digest("hex"),
    });
    expect(claims).not.toHaveProperty("tool_id");
    expect(claims).not.toHaveProperty("idempotency_key");
  });

  it("classifies a refused lifecycle transition as permanent and an outage as retryable", async () => {
    const lifecycle = {
      invocationId: "0197f4a2-0800-7000-8000-000000000010",
      attemptId: "0197f4a2-0800-7000-8000-000000000013",
      attemptOrdinal: 0,
      conversationId: context.conversationId,
      runId: "0197f4a2-0800-7000-8000-000000000011",
      status: "running",
      error: null,
    } as const;

    const refused = createGateway(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            code: "AGENT_INVOCATION_NOT_ADMITTED",
            message: "A rejected Agent invocation cannot enter execution.",
          },
          { status: 409 }
        )
      )
    );
    await expect(
      refused.reportInvocationLifecycle({ lifecycle, traceId: context.traceId })
    ).rejects.toMatchObject({
      name: "DomainLifecycleRejectedError",
      code: "AGENT_INVOCATION_NOT_ADMITTED",
      retryable: false,
    });

    const unavailable = createGateway(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message: "unavailable" }, { status: 503 }))
    );
    await expect(
      unavailable.reportInvocationLifecycle({ lifecycle, traceId: context.traceId })
    ).rejects.toBeInstanceOf(DomainGatewayUnavailableError);
  });

  it("classifies infrastructure HTTP failures as retryable", async () => {
    const gateway = createGateway(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message: "unavailable" }, { status: 503 }))
    );

    await expect(
      gateway.execute({
        toolId: "story_get_snapshot",
        arguments: {},
        context,
        idempotencyKey: "run-1:tool-3",
      })
    ).rejects.toBeInstanceOf(DomainGatewayUnavailableError);
  });

  it("fails closed when HTTP status and the domain result disagree", async () => {
    const succeededAsConflict = createGateway(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            status: "succeeded",
            data: {},
          },
          { status: 409 }
        )
      )
    );
    const rejectedAsSuccess = createGateway(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status: "rejected",
          error: {
            code: "STORY_REVISION_CONFLICT",
            message: "The story revision changed.",
            retryable: false,
          },
        })
      )
    );
    const request = {
      toolId: "story_apply_change_set",
      arguments: {},
      context,
      idempotencyKey: "run-1:tool-contract-mismatch",
    };

    await expect(succeededAsConflict.execute(request)).rejects.toThrow(
      /inconsistent with HTTP 409/
    );
    await expect(rejectedAsSuccess.execute(request)).rejects.toThrow(/inconsistent with HTTP 200/);
  });

  it("bounds trusted-service response bodies", async () => {
    const gateway = createGateway(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", {
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        })
      )
    );

    await expect(
      gateway.execute({
        toolId: "story_get_snapshot",
        arguments: {},
        context,
        idempotencyKey: "run-1:tool-4",
      })
    ).rejects.toThrow(/exceeded 2097152 bytes/);
  });
});

function documentProjection(title: string) {
  return {
    schemaVersion: "story-source-material-projection/v1",
    contentHash: "a".repeat(64),
    document: {
      format: "markdown",
      characterCount: 12,
      lineCount: 2,
      chunkCount: 1,
      title,
      abstract: title,
    },
    hierarchy: [],
    entities: { characters: [], locations: [] },
    continuity: { scenes: [], temporalCues: [] },
    representativeExcerpts: [
      {
        chunkId: "chunk-000000",
        heading: null,
        text: title,
      },
    ],
  };
}

function createGateway(fetchImplementation: typeof fetch): HttpDomainGateway {
  return new HttpDomainGateway(
    {
      url: "https://domain-gateway.example.com",
      signingPrivateKey: domainKeyPair.privateKey,
      signingKeyId: "domain-key-1",
      issuer: "fizzdragon-agent-platform",
      audience: "fizzdragon-domain-gateway",
      tokenTtlSeconds: 30,
      timeoutMs: 1_000,
    },
    fetchImplementation
  );
}
