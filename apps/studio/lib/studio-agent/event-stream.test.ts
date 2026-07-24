import { STUDIO_AGENT_SCHEMA_VERSION } from "@repo/shared";
import { describe, expect, it } from "vitest";

import {
  StudioAgentSseClient,
  StudioAgentSseHttpError,
  StudioAgentSseProtocolError,
  parseSseStream,
  parseStudioAgentWireEvent,
} from "./event-stream";

describe("Studio Agent SSE parser", () => {
  it("parses chunked, multi-line SSE frames and ignores heartbeat comments", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": heartbeat\r\n\r\nid: cursor-1\r\nevent: agent\r"));
        controller.enqueue(
          encoder.encode('\ndata: {"first":true,\r\ndata: "second":true}\r\n\r\n')
        );
        controller.close();
      },
    });

    const frames = [];
    for await (const frame of parseSseStream(stream)) frames.push(frame);

    expect(frames).toEqual([
      {
        id: "cursor-1",
        event: "agent",
        data: '{"first":true,\n"second":true}',
        retry: null,
      },
    ]);
  });

  it("uses the durable event sequence as the SSE acknowledgement id", () => {
    const wireEvent = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      eventId: "00000000-0000-4000-8000-000000000001",
      threadId: "00000000-0000-4000-8000-000000000002",
      runId: "00000000-0000-4000-8000-000000000003",
      rootRunId: "00000000-0000-4000-8000-000000000003",
      parentRunId: null,
      sequence: 7,
      occurredAt: "2026-07-24T12:00:00.000Z",
      type: "run.started",
      payload: { startedAt: "2026-07-24T12:00:00.000Z" },
    };

    expect(parseStudioAgentWireEvent(wireEvent, { id: "7", event: null }).sequence).toBe(7);
    expect(() => parseStudioAgentWireEvent(wireEvent, { id: "other-cursor", event: null })).toThrow(
      "SSE id does not match"
    );
  });

  it("closes instead of retrying a terminal HTTP response", async () => {
    const statuses: string[] = [];
    const errors: Error[] = [];
    const client = new StudioAgentSseClient({
      url: "/events",
      fetchImpl: async () => new Response(null, { status: 401 }),
      onEvents: () => undefined,
      onStatusChange: (status) => statuses.push(status),
      onError: (error) => errors.push(error),
    });

    client.start();
    await client.settled();

    expect(statuses).toEqual(["connecting", "closed"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(StudioAgentSseHttpError);
    expect((errors[0] as StudioAgentSseHttpError).status).toBe(401);
  });

  it("closes on invalid wire data instead of replaying a corrupt event forever", async () => {
    const statuses: string[] = [];
    const errors: Error[] = [];
    const client = new StudioAgentSseClient({
      url: "/events",
      fetchImpl: async () =>
        new Response("data: not-json\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      onEvents: () => undefined,
      onStatusChange: (status) => statuses.push(status),
      onError: (error) => errors.push(error),
    });

    client.start();
    await client.settled();

    expect(statuses).toEqual(["connecting", "connected", "closed"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(StudioAgentSseProtocolError);
    expect(errors[0]?.message).toContain("invalid JSON");
  });

  it("calls the default global fetch with a valid receiver (guards against 'Illegal invocation')", async () => {
    // Native fetch throws "Illegal invocation" unless its receiver is the
    // global object. With no fetchImpl provided, the client must invoke the
    // real fetch with a correct `this`. A regression to `fetchImpl: fetch`
    // (stored on #options and invoked as `this.#options.fetchImpl(...)`) binds
    // `this` to #options and throws before any request is issued — silently
    // breaking every live stream.
    const originalFetch = globalThis.fetch;
    let receiver: unknown = "fetch-was-never-called";
    let markCalled: () => void = () => undefined;
    const called = new Promise<void>((resolve) => {
      markCalled = resolve;
    });
    globalThis.fetch = function (this: unknown) {
      receiver = this;
      markCalled();
      return Promise.resolve(new Response(null, { status: 401 }));
    } as typeof fetch;

    try {
      const errors: Error[] = [];
      const client = new StudioAgentSseClient({
        url: "/events",
        // No fetchImpl → exercises the default global-fetch path (the bug site).
        onEvents: () => undefined,
        onError: (error) => errors.push(error),
      });
      client.start();
      await called;
      client.stop();

      expect(receiver === undefined || receiver === globalThis).toBe(true);
      expect(errors.some((error) => error.message.includes("Illegal invocation"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
