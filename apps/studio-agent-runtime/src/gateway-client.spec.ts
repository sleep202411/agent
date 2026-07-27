import { describe, expect, it, vi } from "vitest";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentEvent,
  type StudioAgentEventDraft,
} from "@repo/shared/studio-agent";
import { RuntimeGatewayClient } from "./gateway-client.js";
import type { RuntimeGatewayHttpError } from "./gateway-client.js";
import { RuntimeGatewayProtocolError } from "./gateway-client.js";
import { StudioAgentDenyActionRequestSchema } from "@repo/shared/studio-agent-api";

const TOKEN = "r".repeat(32);
type ActivityStartedDraft = Extract<StudioAgentEventDraft, { type: "activity.started" }>;
type ActivityStartedEvent = Extract<StudioAgentEvent, { type: "activity.started" }>;

describe("RuntimeGatewayClient", () => {
  it("sends EventDrafts without server-owned ordering fields and validates the envelope", async () => {
    const draft = activityDraft();
    const event: ActivityStartedEvent = {
      schemaVersion: draft.schemaVersion,
      eventId: "55555555-5555-4555-8555-555555555555",
      threadId: draft.threadId,
      runId: draft.runId,
      rootRunId: draft.rootRunId,
      parentRunId: draft.parentRunId,
      sequence: 7,
      occurredAt: draft.occurredAt,
      type: draft.type,
      payload: draft.payload,
    };
    const fetchMock = vi.fn(async (...request: Parameters<typeof fetch>) => {
      void request;
      return new Response(JSON.stringify({ code: 200, data: event }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new RuntimeGatewayClient(
      {
        baseUrl: new URL("http://server:4399"),
        token: TOKEN,
        timeoutMs: 1_000,
      },
      fetchMock as unknown as typeof fetch
    );

    await expect(client.appendEvent(draft)).resolves.toEqual(event);
    const request = fetchMock.mock.calls[0];
    expect(request).toBeDefined();
    const [url, init] = request!;
    expect(String(url)).toBe("http://server:4399/internal/studio-agent/runtime/events");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-studio-agent-runtime-token": TOKEN,
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual(draft);
    expect(body).not.toHaveProperty("eventId");
    expect(body).not.toHaveProperty("sequence");
  });

  it("surfaces the upstream response body on non-2xx failures", async () => {
    const client = new RuntimeGatewayClient(
      {
        baseUrl: new URL("http://server:4399"),
        token: TOKEN,
        timeoutMs: 1_000,
      },
      (async () =>
        new Response("action state conflict", {
          status: 409,
        })) as typeof fetch
    );

    await expect(client.appendEvent(activityDraft())).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeGatewayHttpError>>({
        name: "RuntimeGatewayHttpError",
        status: 409,
        responseBody: "action state conflict",
      })
    );
  });

  it("rejects successful responses that drift from the strict runtime envelope", async () => {
    const client = new RuntimeGatewayClient(
      {
        baseUrl: new URL("http://server:4399"),
        token: TOKEN,
        timeoutMs: 1_000,
      },
      (async () =>
        new Response(
          JSON.stringify({
            code: 200,
            msg: "legacy envelope field",
            data: {},
          }),
          { status: 200 }
        )) as typeof fetch
    );

    await expect(client.appendEvent(activityDraft())).rejects.toBeInstanceOf(
      RuntimeGatewayProtocolError
    );
  });

  it("requires a structured terminal disposition for non-user action denial", () => {
    const baseRequest = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      actionId: "66666666-6666-4666-8666-666666666666",
      runId: "22222222-2222-4222-8222-222222222222",
      approvalId: "77777777-7777-4777-8777-777777777777",
      actionInputHash: "a".repeat(64),
      reason: "Approval expired.",
      decidedAt: "2026-07-24T01:00:00.000Z",
    };

    expect(StudioAgentDenyActionRequestSchema.safeParse(baseRequest).success).toBe(false);
    expect(
      StudioAgentDenyActionRequestSchema.parse({
        ...baseRequest,
        disposition: "expired",
      }).disposition
    ).toBe("expired");
  });

  it("retries a transient 5xx and succeeds instead of dropping the run", async () => {
    const draft = activityDraft();
    const event: ActivityStartedEvent = {
      schemaVersion: draft.schemaVersion,
      eventId: "55555555-5555-4555-8555-555555555555",
      threadId: draft.threadId,
      runId: draft.runId,
      rootRunId: draft.rootRunId,
      parentRunId: draft.parentRunId,
      sequence: 7,
      occurredAt: draft.occurredAt,
      type: draft.type,
      payload: draft.payload,
    };
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(new Response("bad gateway", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: event }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    const client = new RuntimeGatewayClient(
      { baseUrl: new URL("http://server:4399"), token: TOKEN, timeoutMs: 1_000 },
      fetchMock as unknown as typeof fetch
    );

    await expect(client.appendEvent(draft)).resolves.toEqual(event);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a deterministic 4xx", async () => {
    const fetchMock = vi.fn(async () => new Response("action conflict", { status: 409 }));
    const client = new RuntimeGatewayClient(
      { baseUrl: new URL("http://server:4399"), token: TOKEN, timeoutMs: 1_000 },
      fetchMock as unknown as typeof fetch
    );

    await expect(client.appendEvent(activityDraft())).rejects.toMatchObject({
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function activityDraft(): ActivityStartedDraft {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    rootRunId: "22222222-2222-4222-8222-222222222222",
    parentRunId: null,
    type: "activity.started",
    payload: {
      activityId: "33333333-3333-4333-8333-333333333333",
      parentActivityId: null,
      kind: "generate",
      label: "studio_agent.activity.generating_response",
      startedAt: "2026-07-24T01:00:00.000Z",
    },
    occurredAt: "2026-07-24T01:00:00.000Z",
    idempotencyKey: "model:44444444-4444-4444-8444-444444444444:started",
  };
}
