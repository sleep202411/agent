import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HEADER_STREAM, type ChannelWriter } from "@ably/ai-transport";
import { createUIMessageCodec } from "@ably/ai-transport/vercel";
import { MockActivityEnvironment } from "@temporalio/testing";
import { DefaultLogger } from "@temporalio/worker";
import * as Ably from "ably";
import { afterEach, describe, expect, it } from "vitest";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentModelStepOutcome,
  type StudioAgentResponseModelExecutionPlan,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import { createStudioAgentActivities } from "./activities.js";
import type { StudioAgentDeliveryClient, StudioAgentUIChunk } from "./agent-session.js";
import {
  ABLY_APPENDED_MESSAGE_LIMIT_BYTES,
  createAppendCeilingSplitter,
  enforceDiscreteAppendCeiling,
  STUDIO_AGENT_SEGMENT_BUDGET_BYTES,
} from "./append-ceiling.js";
import type { StudioAgentRuntimeGateway } from "./gateway-client.js";

/**
 * D8, measured and enforced.
 *
 * Every assertion here is anchored on ONE number that came off the real Ably
 * account, not off a doc page: an accumulated appended message is refused at
 * 65 536 bytes with `code=40009 statusCode=413 "... size was 65545, limit is
 * 65536"`. {@link ceilingWriter} is that service, in nine lines — and it is a
 * genuine `ChannelWriter`, driving the LIBRARY's own encoder, so the
 * accumulation being tested is `codec/encoder.ts`'s and not a re-implementation
 * of it that could agree with the splitter while the service does not.
 */

const REPLY_BYTES = 200_000;

describe("Ably append ceiling", () => {
  it("delivers a 200 KB reply whole through the library encoder, which the service refuses in one message", async () => {
    const reply = longReply(REPLY_BYTES);
    const channel = ceilingWriter();
    const encoder = createUIMessageCodec().createEncoder(channel.writer);

    for await (const chunk of split(replyChunks(reply))) {
      await encoder.publishOutput(chunk as never);
    }
    await encoder.close();

    expect(channel.streamedText()).toBe(reply);
    expect(channel.streamCount()).toBeGreaterThan(1);
    for (const size of channel.streamSizes()) {
      expect(size).toBeLessThanOrEqual(ABLY_APPENDED_MESSAGE_LIMIT_BYTES);
    }
  });

  /**
   * The control. Same reply, same encoder, same writer — only the splitter is
   * absent, which is exactly the state of the tree before this change and
   * exactly what a future edit that drops the `pipeThrough` would restore.
   */
  it("is a real ceiling: the same reply without the splitter fails the step the way production did", async () => {
    const reply = longReply(REPLY_BYTES);
    const channel = ceilingWriter();
    const encoder = createUIMessageCodec().createEncoder(channel.writer);

    const failure = await (async () => {
      try {
        for await (const chunk of replyChunks(reply)) {
          await encoder.publishOutput(chunk as never);
        }
        await encoder.close();
        return null;
      } catch (error) {
        return error;
      }
    })();

    // The whole cascade, exactly as the service produces it: the append is
    // nacked over the ceiling, the encoder's recovery re-publishes the full
    // accumulation — which is over the ceiling too — and the step dies with
    // `EncoderRecoveryFailed`, having delivered a truncated reply.
    expect(failure).toBeInstanceOf(Ably.ErrorInfo);
    expect((failure as Ably.ErrorInfo).message).toContain("unable to flush pending appends");
    expect(String((failure as Ably.ErrorInfo).cause)).toMatch(/limit is 65536/);
    expect(channel.streamedText()).not.toBe(reply);
    expect(channel.streamedText().length).toBeLessThan(reply.length);
  });

  it("never cuts a multi-byte character across the seam", async () => {
    // 3 bytes per character, and a budget that is not a multiple of 3, so a
    // naive byte slice lands mid-character on every roll.
    const reply = "汉".repeat(4_000);
    const chunks = await drain(
      split(replyChunks(reply, { deltaChars: 7 }), { budgetBytes: 1_000 })
    );

    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => (chunk as { delta: string }).delta)
      .join("");

    expect(text).toBe(reply);
    expect(text).not.toContain("�");
    for (const chunk of chunks) {
      if (chunk.type !== "text-delta") continue;
      expect((chunk as { delta: string }).delta).not.toMatch(/[\uD800-\uDFFF]/);
    }
  });

  it("splits a single delta larger than a whole segment rather than overflowing on it", async () => {
    const reply = "y".repeat(10_000);
    const chunks = await drain(
      // One delta, ten times the budget.
      split(replyChunks(reply, { deltaChars: 10_000 }), { budgetBytes: 1_000 })
    );

    const segments = accumulate(chunks);
    expect(segments.length).toBe(10);
    expect(segments.join("")).toBe(reply);
    for (const segment of segments) {
      expect(Buffer.byteLength(segment, "utf8")).toBeLessThanOrEqual(1_000);
    }
  });

  it("leaves a reply under the budget on exactly one message", async () => {
    const reply = longReply(1_024);
    const chunks = await drain(split(replyChunks(reply)));

    expect(accumulate(chunks)).toEqual([reply]);
    expect(chunks.filter((chunk) => chunk.type === "text-start")).toHaveLength(1);
  });

  it("reports every roll instead of rolling silently", async () => {
    const reports: string[] = [];
    await drain(
      split(replyChunks(longReply(4_096)), {
        budgetBytes: 1_000,
        report: (entry) => reports.push(`${entry.kind}:${entry.segment}:${entry.bytes}`),
      })
    );

    expect(reports.length).toBe(4);
    expect(reports[0]).toMatch(/^rolled:1:\d+$/);
  });

  /**
   * The bound that REMAINS, named out loud rather than left to be discovered.
   * A tool-input stream is reassembled by parsing the whole accumulation, so
   * splitting it would hand the decoder half a JSON document.
   */
  it("refuses to split a tool call's input and says so", async () => {
    const reports: string[] = [];
    const oversized = "z".repeat(3_000);
    await drain(
      split(
        (async function* () {
          yield { type: "tool-input-start", toolCallId: "call-1", toolName: "t" };
          yield { type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: oversized };
          yield { type: "tool-input-available", toolCallId: "call-1", toolName: "t", input: {} };
        })(),
        { budgetBytes: 1_000, report: (entry) => reports.push(entry.message) }
      )
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("cannot be split without corrupting its JSON");
  });

  it("keeps the budget under the measured ceiling", () => {
    expect(STUDIO_AGENT_SEGMENT_BUDGET_BYTES).toBeLessThan(ABLY_APPENDED_MESSAGE_LIMIT_BYTES);
  });
});

/**
 * THE WIRING, NOT JUST THE ALGORITHM.
 *
 * The splitter passing its own unit tests is worth nothing if nothing calls it,
 * and the call site is one line inside a private function. So this runs the
 * REAL activity — `runModelStep` — against a model that streams 200 KB and a
 * transport step that is the library's encoder over the ceiling writer.
 * Deleting the `pipeThrough` in `openTransportStep` fails this test with the
 * production error and no other change.
 */
describe("Studio Agent model step delivery", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => close(server)));
  });

  it("streams a reply past the append ceiling onto the channel whole", async () => {
    const reply = longReply(REPLY_BYTES);
    const model = await startModelServer(reply);
    servers.push(model.server);
    const channel = deliveryOverCeilingWriter();
    const activities = createStudioAgentActivities({
      gateway: recordingGateway(),
      modelConfig: { ...modelConfig(), baseUrl: model.baseUrl },
      delivery: channel.delivery,
    });

    const outcome = await new MockActivityEnvironment(
      { attempt: 1, activityId: "1" },
      { logger: new DefaultLogger("ERROR") }
    ).run(activities.runModelStep, deliveredInput());

    expect((outcome as StudioAgentModelStepOutcome).assistantSegments[0]?.content).toBe(reply);
    expect(channel.streamedText()).toBe(reply);
    expect(channel.streamCount()).toBeGreaterThan(1);
    for (const size of channel.streamSizes()) {
      expect(size).toBeLessThanOrEqual(ABLY_APPENDED_MESSAGE_LIMIT_BYTES);
    }
  }, 30_000);

  /**
   * ONE MESSAGE PER STEP, AND THE BUG THAT PROVED WHY IT MATTERS.
   *
   * `RunStep.send()` publishes "a single discrete output as ONE assistant
   * message", so reporting the step's terminal activity through it produced a
   * second message whose only content was a `data-studio-agent-activity` part.
   *
   * That is wrong on its face — work steps belong folded INTO the reply that
   * produced them, not beside it as their own turn. It also silently broke tool
   * approval, which is how it was found in the browser: the AI SDK's
   * `addToolApprovalResponse` rewrites `messages[messages.length - 1]` and only
   * that message, so the trailing activity-only message displaced the one
   * carrying the approval and every Approve click became a no-op with no error.
   *
   * The step therefore holds ONE outbound stream open for its whole life, and
   * the activity published after the model finishes still lands on it. If this
   * ever regresses, `discreteSends` goes above zero and approval stops working
   * again — with nothing in the logs to say so.
   */
  it("keeps the step's activities on the reply's message instead of publishing a second one", async () => {
    const model = await startModelServer("A short reply that fits in one message.");
    servers.push(model.server);
    const channel = deliveryOverCeilingWriter();
    const activities = createStudioAgentActivities({
      gateway: recordingGateway(),
      modelConfig: { ...modelConfig(), baseUrl: model.baseUrl },
      delivery: channel.delivery,
    });

    await new MockActivityEnvironment(
      { attempt: 1, activityId: "1" },
      { logger: new DefaultLogger("ERROR") }
    ).run(activities.runModelStep, deliveredInput());

    const types = channel.chunkTypes();
    // The terminal activity is published AFTER the model stream ends, and it
    // still has to arrive through the same stream.
    expect(types.filter((type) => type === "data-studio-agent-activity").length).toBeGreaterThan(0);
    expect(types.lastIndexOf("data-studio-agent-activity")).toBeGreaterThan(
      types.indexOf("text-start")
    );
    // Nothing may take the discrete path, because a discrete output IS a second
    // assistant message.
    expect(channel.discreteSends()).toBe(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Ably, as measured
// ---------------------------------------------------------------------------

interface WireMessage {
  name: string;
  data: string;
  streamed: boolean;
}

/**
 * A `ChannelWriter` that enforces the one number this whole module exists for.
 *
 * `size` counts the message name alongside the accumulated data because that is
 * what the service counted: 64 appends of 1 KiB were reported as "size was
 * 65545" — 65 536 bytes of data plus the nine characters of `ai-output`.
 */
function ceilingWriter(limit = ABLY_APPENDED_MESSAGE_LIMIT_BYTES): {
  writer: ChannelWriter;
  streamedText: () => string;
  streamCount: () => number;
  streamSizes: () => number[];
} {
  const messages = new Map<string, WireMessage>();
  const order: string[] = [];
  let serials = 0;

  const size = (message: WireMessage): number =>
    Buffer.byteLength(message.name, "utf8") + Buffer.byteLength(message.data, "utf8");

  /**
   * Refused BEFORE the write lands, which is the half that matters: Ably does
   * not persist a nacked append, so the accumulated message on the channel
   * stops at the last accepted one. A guard that checked after mutating would
   * quietly leave the full text in place and let the control test claim a
   * complete delivery it never made.
   */
  const guard = (message: WireMessage, next: string): string => {
    const bytes = Buffer.byteLength(message.name, "utf8") + Buffer.byteLength(next, "utf8");
    if (bytes > limit) {
      throw new Ably.ErrorInfo(
        `unable to append to message; message size was ${bytes}, limit is ${limit}`,
        40_009,
        413
      );
    }
    return next;
  };

  const record = (message: Ably.Message): string => {
    const serial = `serial-${(serials += 1)}`;
    const extras = message.extras as { ai?: { transport?: Record<string, string> } } | undefined;
    const entry: WireMessage = {
      name: message.name ?? "",
      data: "",
      streamed: extras?.ai?.transport?.[HEADER_STREAM] === "true",
    };
    entry.data = guard(entry, typeof message.data === "string" ? message.data : "");
    messages.set(serial, entry);
    order.push(serial);
    return serial;
  };

  const streamed = (): WireMessage[] =>
    order.map((serial) => messages.get(serial)!).filter((message) => message.streamed);

  return {
    writer: {
      publish: async (message) => ({
        serials: (Array.isArray(message) ? message : [message]).map(record),
      }),
      appendMessage: async (message) => {
        const serial = message.serial ?? "";
        const current = messages.get(serial);
        if (!current) {
          throw new Ably.ErrorInfo(
            `unable to append; no message for serial ${serial}`,
            40_009,
            400
          );
        }
        current.data = guard(
          current,
          `${current.data}${typeof message.data === "string" ? message.data : ""}`
        );
        return {} as Ably.UpdateDeleteResult;
      },
      updateMessage: async (message) => {
        const serial = message.serial ?? "";
        const current = messages.get(serial);
        if (!current) {
          throw new Ably.ErrorInfo(
            `unable to update; no message for serial ${serial}`,
            40_009,
            400
          );
        }
        current.data = guard(current, typeof message.data === "string" ? message.data : "");
        return {} as Ably.UpdateDeleteResult;
      },
    },
    streamedText: () =>
      streamed()
        .map((message) => message.data)
        .join(""),
    streamCount: () => streamed().length,
    streamSizes: () => streamed().map(size),
  };
}

/** The delivery client `runModelStep` uses, publishing through {@link ceilingWriter}. */
function deliveryOverCeilingWriter(): {
  delivery: StudioAgentDeliveryClient;
  streamedText: () => string;
  streamCount: () => number;
  streamSizes: () => number[];
  discreteSends: () => number;
  chunkTypes: () => string[];
} {
  const channel = ceilingWriter();
  const encoder = createUIMessageCodec().createEncoder(channel.writer);
  const discrete: unknown[] = [];
  const types: string[] = [];
  const step = {
    start: async () => {},
    // `RunStep.pipe`, reduced to what it does to the encoder. The real one adds
    // step lifecycle events and a cancel race; neither bears on message size.
    pipe: async (stream: ReadableStream<StudioAgentUIChunk>) => {
      for await (const chunk of stream as unknown as AsyncIterable<StudioAgentUIChunk>) {
        types.push((chunk as { type?: string }).type ?? "?");
        await encoder.publishOutput(chunk as never);
      }
      await encoder.close();
      return { reason: "complete" as const };
    },
    // Every call here is a SEPARATE assistant message on the channel — the
    // thing the one-message-per-step design exists to make impossible.
    send: async (chunk: unknown) => {
      discrete.push(chunk);
    },
    end: async () => {},
  };
  const run = {
    runId: RUN_ID,
    abortSignal: new AbortController().signal,
    load: async () => {},
    createStep: () => step,
    end: async () => {},
  };
  return {
    delivery: {
      session: async () => ({ adoptRun: () => run }) as never,
      continuityGeneration: () => 0,
      close: () => {},
    },
    ...channel,
    discreteSends: () => discrete.length,
    chunkTypes: () => types,
  };
}

// ---------------------------------------------------------------------------
// A model that streams 200 KB
// ---------------------------------------------------------------------------

/**
 * The smallest OpenAI-compatible chat-completions endpoint that `@ai-sdk/alibaba`
 * will stream from. Local, so the test is hermetic and costs nothing.
 */
async function startModelServer(reply: string): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    const body: Buffer[] = [];
    request.on("data", (chunk: Buffer) => body.push(chunk));
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const frame = (payload: unknown): void => {
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const base = { id: "cmpl-test", object: "chat.completion.chunk", model: "qwen3-max" };
      frame({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      });
      for (let at = 0; at < reply.length; at += 512) {
        frame({
          ...base,
          choices: [
            { index: 0, delta: { content: reply.slice(at, at + 512) }, finish_reason: null },
          ],
        });
      }
      frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      frame({
        ...base,
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 1_000, total_tokens: 1_010 },
      });
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/v1` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Chunk helpers
// ---------------------------------------------------------------------------

function longReply(bytes: number): string {
  const line = "The chapter continues, and the reply keeps going well past one Ably message. ";
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

async function* replyChunks(
  reply: string,
  options: { deltaChars?: number } = {}
): AsyncGenerator<StudioAgentUIChunk> {
  const size = options.deltaChars ?? 64;
  yield { type: "text-start", id: "msg-1" } as StudioAgentUIChunk;
  for (let at = 0; at < reply.length; at += size) {
    yield {
      type: "text-delta",
      id: "msg-1",
      delta: reply.slice(at, at + size),
    } as StudioAgentUIChunk;
  }
  yield { type: "text-end", id: "msg-1" } as StudioAgentUIChunk;
}

function split(
  source: AsyncIterable<StudioAgentUIChunk>,
  options?: Parameters<typeof createAppendCeilingSplitter>[0]
): AsyncIterable<StudioAgentUIChunk> {
  const readable = new ReadableStream<StudioAgentUIChunk>({
    async start(controller) {
      for await (const chunk of source) controller.enqueue(chunk);
      controller.close();
    },
  });
  return readable.pipeThrough(
    createAppendCeilingSplitter(options)
  ) as unknown as AsyncIterable<StudioAgentUIChunk>;
}

async function drain(source: AsyncIterable<StudioAgentUIChunk>): Promise<StudioAgentUIChunk[]> {
  const chunks: StudioAgentUIChunk[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

/** The accumulated text of each wire message the chunks describe, in order. */
function accumulate(chunks: readonly StudioAgentUIChunk[]): string[] {
  const byId = new Map<string, string>();
  const order: string[] = [];
  for (const chunk of chunks) {
    if (chunk.type === "text-start") {
      byId.set(chunk.id, "");
      order.push(chunk.id);
    }
    if (chunk.type === "text-delta") {
      byId.set(chunk.id, `${byId.get(chunk.id) ?? ""}${chunk.delta}`);
    }
  }
  return order.map((id) => byId.get(id) ?? "");
}

// ---------------------------------------------------------------------------
// Workflow fixtures
// ---------------------------------------------------------------------------

const THREAD_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const STEP_ID = "77777777-7777-4777-8777-777777777777";
const MESSAGE_ID = "88888888-8888-4888-8888-888888888888";
const SEGMENT_ID = "99999999-9999-4999-8999-999999999999";
const POLICY_ID = "66666666-6666-4666-8666-666666666666";
const TRIGGER_EVENT_ID = "evt-01J000000000000000000000";

function modelConfig() {
  return {
    apiKey: "test",
    baseUrl: undefined as string | undefined,
    textModelId: "qwen3-max",
    visionModelId: "qwen3-vl-plus",
    timeoutMs: 600_000,
    maxOutputTokens: 8_192,
  };
}

function deliveredInput(): StudioAgentWorkflowInput {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: THREAD_ID,
    runId: RUN_ID,
    rootRunId: RUN_ID,
    parentRunId: null,
    kind: "turn",
    scenario: { id: "story.studio.assistant", version: "1.0.0" },
    permissionPolicy: { policyId: POLICY_ID, revision: 1 },
    delivery: { inputEventId: TRIGGER_EVENT_ID, channelName: `studio-agent:thread:${THREAD_ID}` },
  };
}

function responsePlan(): StudioAgentResponseModelExecutionPlan {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    kind: "response",
    context: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      stepId: STEP_ID,
      threadId: THREAD_ID,
      runId: RUN_ID,
      scenario: { id: "story.studio.assistant", version: "1.0.0" },
      contextRevision: 1,
      contextCheckpointId: null,
      messageIds: [MESSAGE_ID],
      capabilities: [],
      skills: [],
      locale: "en-US",
    },
    provider: "alibaba",
    modelId: "qwen3-max",
    system: "You are the Studio Agent.",
    messages: [{ role: "user", content: "Write the whole chapter." }],
    maxOutputTokens: 8_192,
    timeoutMs: 600_000,
    capabilities: [],
    assistantMessageId: MESSAGE_ID,
    segmentId: SEGMENT_ID,
  };
}

function recordingGateway(): StudioAgentRuntimeGateway {
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected gateway call.");
  };
  return {
    appendEvent: async () => undefined,
    loadModelPlan: async () => responsePlan(),
    completeContextCompaction: unused,
    failContextCompaction: unused,
    prepareAction: unused,
    prepareChildRun: unused,
    transitionRun: unused,
    executeAction: unused,
    denyAction: unused,
    resolveApproval: unused,
    consumeInput: unused,
  } as unknown as StudioAgentRuntimeGateway;
}

/**
 * The other way into the transport.
 *
 * `pipe` is guarded by the splitter; `send` is a discrete message that cannot be
 * rolled, so an oversized one is refused by the encoder and the nack fails the
 * step. That is worst for the chunk it happens to: a failure part exists to say
 * why a turn died. Only `error.details` is unbounded — label is 240 chars,
 * detail 2 000, message 8 000 — so shedding it is what makes the message fit.
 */
describe("enforceDiscreteAppendCeiling", () => {
  function failure(details: unknown): StudioAgentUIChunk {
    return {
      type: "data-studio-agent-failure",
      id: "run:failure",
      data: {
        runId: "run",
        error: { code: "runtime.model_failed", message: "The model failed.", details },
      },
    } as unknown as StudioAgentUIChunk;
  }

  it("passes a chunk that already fits, untouched and unreported", () => {
    const reports: string[] = [];
    const chunk = failure({ attempt: 1 });
    const out = enforceDiscreteAppendCeiling(chunk, {
      report: (entry) => reports.push(entry.message),
    });
    expect(out).toBe(chunk);
    expect(reports).toEqual([]);
  });

  it("sheds error.details rather than letting the encoder refuse the failure", () => {
    const reports: string[] = [];
    const out = enforceDiscreteAppendCeiling(
      failure({ blob: "x".repeat(ABLY_APPENDED_MESSAGE_LIMIT_BYTES) }),
      { report: (entry) => reports.push(entry.message) }
    );

    const encoded = Buffer.byteLength(JSON.stringify(out), "utf8");
    expect(encoded).toBeLessThanOrEqual(STUDIO_AGENT_SEGMENT_BUDGET_BYTES);
    // The two fields the panel actually renders survive.
    const data = (out as unknown as { data: { error: Record<string, unknown> } }).data;
    expect(data.error.code).toBe("runtime.model_failed");
    expect(data.error.message).toBe("The model failed.");
    expect(data.error.details).toBeNull();
    // Never silent.
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("without error.details");
  });

  it("reports an oversized chunk it cannot reduce instead of pretending it fixed it", () => {
    const reports: { kind: string; message: string }[] = [];
    const chunk = {
      type: "data-studio-agent-activity",
      id: "activity",
      data: { label: "x".repeat(ABLY_APPENDED_MESSAGE_LIMIT_BYTES) },
    } as unknown as StudioAgentUIChunk;

    const out = enforceDiscreteAppendCeiling(chunk, {
      report: (entry) => reports.push({ kind: entry.kind, message: entry.message }),
    });

    expect(out).toBe(chunk);
    expect(reports[0]?.kind).toBe("unsplittable");
    expect(reports[0]?.message).toContain("no error.details to shed");
  });
});
