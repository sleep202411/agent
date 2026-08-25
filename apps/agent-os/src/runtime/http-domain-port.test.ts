import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentOsExecutionSupersededError, HttpDomainPort } from "./http-domain-port.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HttpDomainPort", () => {
  it("carries turnId to the Domain and preserves an external-job handoff response", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            runId: jobId,
            status: "authoring",
            agentHandoff: {
              kind: "external_job",
              jobId,
              startedMessage: "The story pipeline is running.",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const domain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });

    const result = await domain.execute(
      "story.author",
      { title: "Night Watch" },
      {
        runId: "11111111-1111-4111-8111-111111111111",
        turnId: "22222222-2222-4222-8222-222222222222",
        conversationId: "33333333-3333-4333-8333-333333333333",
        projectId: "44444444-4444-4444-8444-444444444444",
        actorId: "actor-1",
        skillResolutionId: "55555555-5555-4555-8555-555555555555",
        skillVersionIds: [],
        idempotencyKey: "project:run:tool:v1",
        toolCallId: "tool-call-1",
      }
    );

    expect(requestBody).toMatchObject({
      turnId: "22222222-2222-4222-8222-222222222222",
      toolCallId: "tool-call-1",
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        agentHandoff: { kind: "external_job", jobId },
      },
    });
  });

  it("retries an identical command when the first HTTP response is lost", async () => {
    const bodies: string[] = [];
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(async (_url, init) => {
        bodies.push(String(init?.body));
        throw new TypeError("socket closed after commit");
      })
      .mockImplementationOnce(async (_url, init) => {
        bodies.push(String(init?.body));
        return new Response(
          JSON.stringify({
            ok: true,
            data: { projectRevision: 1, written: [{ id: "hero" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      });
    const domain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });

    const result = await domain.execute(
      "characters.upsert",
      { baseRevision: 0, characters: [] },
      {
        runId: "11111111-1111-4111-8111-111111111111",
        turnId: "22222222-2222-4222-8222-222222222222",
        conversationId: "33333333-3333-4333-8333-333333333333",
        projectId: "44444444-4444-4444-8444-444444444444",
        actorId: "actor-1",
        skillResolutionId: "55555555-5555-4555-8555-555555555555",
        skillVersionIds: [],
        idempotencyKey: "project:run:tool:v1",
        toolCallId: "tool-call-response-loss",
      }
    );

    expect(result).toEqual({
      ok: true,
      data: { projectRevision: 1, written: [{ id: "hero" }] },
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("keeps polling the same receipt while another pod owns the command", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            code: "AGENT_OS_TOOL_EXECUTION_IN_FLIGHT",
            message: "still committing",
            retryable: true,
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { revision: 7 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    const domain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });

    await expect(domain.execute("canvas.applyPatch", {}, executionContext())).resolves.toEqual({
      ok: true,
      data: { revision: 7 },
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "AGENT_OS_START_EXECUTION_FENCED",
    "AGENT_OS_CONTINUATION_EXECUTION_FENCED",
    "AGENT_OS_TOOL_EXECUTION_SUPERSEDED",
    "AGENT_OS_RUN_TERMINAL",
  ])("throws stale execution %s as control flow", async (code) => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            code,
            message: "another execution owns this run",
            retryable: true,
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
    );
    const domain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });

    await expect(
      domain.execute("characters.upsert", {}, executionContext())
    ).rejects.toBeInstanceOf(AgentOsExecutionSupersededError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not turn a long in-flight receipt into a model-visible failure", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      return attempts <= 6
        ? new Response(
            JSON.stringify({
              ok: false,
              code: "AGENT_OS_TOOL_EXECUTION_IN_FLIGHT",
              message: "the original transaction is still committing",
              retryable: true,
            }),
            { status: 409, headers: { "content-type": "application/json" } }
          )
        : new Response(JSON.stringify({ ok: true, data: { revision: 8 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    });
    const domain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });

    const execution = domain.execute("canvas.applyPatch", {}, executionContext());
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(execution).resolves.toEqual({ ok: true, data: { revision: 8 } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(7);
  });

  it("aborts receipt polling without returning ToolFailed data", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            code: "AGENT_OS_TOOL_EXECUTION_IN_FLIGHT",
            message: "still committing",
            retryable: true,
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
    );
    const abort = new AbortController();
    const domain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });

    const execution = domain.execute(
      "canvas.applyPatch",
      {},
      {
        ...executionContext(),
        abortSignal: abort.signal,
      }
    );
    const rejected = expect(execution).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(150);
    abort.abort();

    await rejected;
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

function executionContext() {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    turnId: "22222222-2222-4222-8222-222222222222",
    conversationId: "33333333-3333-4333-8333-333333333333",
    projectId: "44444444-4444-4444-8444-444444444444",
    actorId: "actor-1",
    skillResolutionId: "55555555-5555-4555-8555-555555555555",
    skillVersionIds: [],
    idempotencyKey: "project:run:tool:v1",
    toolCallId: "tool-call-1",
  };
}
