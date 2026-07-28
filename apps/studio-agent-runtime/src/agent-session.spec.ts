import type * as AblyTypes from "ably";
import * as Ably from "ably";
import { describe, expect, it, vi } from "vitest";
import { createStudioAgentDeliveryClient, describeAblyError } from "./agent-session.js";

const constructed = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
const sessions = vi.hoisted(() => ({
  handlers: [] as Array<(error: unknown) => void>,
  connect: vi.fn(async () => {}),
  /** Every session object the factory has produced, newest last. */
  created: [] as Array<{ id: number; detached: number }>,
  detachError: null as unknown,
}));

vi.mock("ably", async (importOriginal) => {
  const actual = await importOriginal<typeof AblyTypes>();
  class Realtime {
    connection = { on: vi.fn() };
    constructor(options: Record<string, unknown>) {
      constructed.options.push(options);
    }
    close(): void {}
  }
  return { ...actual, Realtime, default: { ...actual, Realtime } };
});

vi.mock("@ably/ai-transport/vercel", () => ({
  createAgentSession: () => {
    const record = { id: sessions.created.length + 1, detached: 0 };
    sessions.created.push(record);
    return {
      on: (_event: string, handler: (error: unknown) => void) => {
        sessions.handlers.push(handler);
        return () => {};
      },
      connect: sessions.connect,
      detach: async () => {
        record.detached += 1;
        if (sessions.detachError) throw sessions.detachError;
      },
    };
  },
}));

const config = { ablyApiKey: "app.key:secret" };

describe("Studio Agent delivery client", () => {
  /**
   * THE OPTION THAT LOOKS LIKE A SAVING AND IS A BREAKAGE.
   *
   * `echoMessages: false` reads as free: the worker publishes and never
   * subscribes, so why take its own traffic back? Because the library's session
   * DOES subscribe — unfiltered — and folds every message into the Tree that
   * `adoptRun().load()` reads to confirm this run's `ai-run-start`. With echo
   * off, a worker cannot see the run it opened one activity ago, and the second
   * activity of every turn dies `InputEventNotFound` after burning its whole
   * visibility timeout. Verified against the real Ably account on one shared
   * session, which is what a worker process has.
   */
  it("lets the worker observe its own writes, so a later activity can adopt the run it opened", () => {
    constructed.options.length = 0;
    createStudioAgentDeliveryClient(config, () => {});

    expect(constructed.options).toHaveLength(1);
    expect(constructed.options[0]?.echoMessages).toBe(true);
  });

  /**
   * Continuity loss and a creator's stop fire the SAME abort signal. The only
   * thing that separates them is this counter, so it has to move.
   */
  it("counts a channel continuity loss so an abort caused by it is not read as a cancel", async () => {
    sessions.handlers.length = 0;
    const channel = "studio-agent:thread:11111111-1111-4111-8111-111111111111";
    const delivery = createStudioAgentDeliveryClient(config, () => {});
    await delivery.session(channel);

    expect(delivery.continuityGeneration(channel)).toBe(0);
    for (const handler of sessions.handlers) {
      handler(
        new Ably.ErrorInfo("unable to continue; channel continuity lost (attached)", 104006, 500)
      );
    }
    expect(delivery.continuityGeneration(channel)).toBe(1);

    // A different session-level error is not a continuity loss.
    for (const handler of sessions.handlers) {
      handler(new Ably.ErrorInfo("unable to subscribe", 104001, 500));
    }
    expect(delivery.continuityGeneration(channel)).toBe(1);
  });
});

describe("Ably error logging", () => {
  /**
   * The outage this exists to prevent: the worker logged
   * `{"code":40033,"statusCode":400}` and the sentence that named the fault was
   * only recoverable from Temporal history.
   */
  it("logs the message, not just the numeric code", () => {
    const line = describeAblyError(
      new Ably.ErrorInfo("unable to look up input event; run abc was cancelled", 40033, 400)
    );

    expect(line).toContain("code=40033");
    expect(line).toContain("status=400");
    expect(line).toContain("unable to look up input event; run abc was cancelled");
  });

  it("says so plainly when there is no error to describe", () => {
    expect(describeAblyError(undefined)).toBe("code=unknown status=unknown message=none");
  });
});

/**
 * THE DEAD SESSION THAT KEPT BEING HANDED OUT.
 *
 * On continuity loss the library aborts every registered run on the channel and
 * swaps the Tree for a fresh empty one. It does NOT forget the session, and this
 * cache did not either — so every later activity on the thread got the same
 * object back, with an empty Tree that has never seen the run it is being asked
 * to adopt. `adoptRun().load()` then waits out its entire visibility timeout and
 * fails `InputEventNotFound`, which reads like a transport bug rather than the
 * dropped websocket it is.
 */
describe("Studio Agent delivery session cache", () => {
  const CHANNEL = "studio-agent:thread:22222222-2222-4222-8222-222222222222";
  const continuityLost = () =>
    new Ably.ErrorInfo("unable to continue; channel continuity lost (attached)", 104006, 500);

  const reset = () => {
    sessions.handlers.length = 0;
    sessions.created.length = 0;
    sessions.detachError = null;
  };

  it("evicts and detaches the session whose channel lost continuity, so the next activity gets a fresh one", async () => {
    reset();
    const delivery = createStudioAgentDeliveryClient(config, () => {});

    const first = await delivery.session(CHANNEL);
    // Cached: the same channel resolves to the same session while it is healthy.
    expect(await delivery.session(CHANNEL)).toBe(first);
    expect(sessions.created).toHaveLength(1);

    for (const handler of sessions.handlers) handler(continuityLost());

    const second = await delivery.session(CHANNEL);
    expect(second).not.toBe(first);
    expect(sessions.created).toHaveLength(2);
    // `detach()`, never `end()`: `end()` publishes ai-run-end{cancelled} for
    // every open run it owns, which would terminate a turn Temporal is about to
    // retry and tell the creator they cancelled something they did not.
    expect(sessions.created[0]?.detached).toBe(1);
    expect(sessions.created[1]?.detached).toBe(0);
  });

  it("does not evict a successor session when a continuity loss is reported late", async () => {
    reset();
    const delivery = createStudioAgentDeliveryClient(config, () => {});

    await delivery.session(CHANNEL);
    const staleHandlers = [...sessions.handlers];
    // The loss that retires `first`.
    for (const handler of staleHandlers) handler(continuityLost());
    const second = await delivery.session(CHANNEL);

    // The SAME (already retired) session reports the loss again — a duplicate
    // channel state change, or a listener that fired after the swap. Two live
    // sessions on one channel is the unsupported state; evicting the successor
    // here would create it on the next call.
    for (const handler of staleHandlers) handler(continuityLost());

    expect(await delivery.session(CHANNEL)).toBe(second);
    expect(sessions.created).toHaveLength(2);
  });

  it("still evicts when the stale session cannot be detached, and says why", async () => {
    reset();
    sessions.detachError = new Ably.ErrorInfo("channel is failed", 90_001, 400);
    const lines: string[] = [];
    const delivery = createStudioAgentDeliveryClient(config, (line) => lines.push(line));

    const first = await delivery.session(CHANNEL);
    for (const handler of sessions.handlers) handler(continuityLost());
    await Promise.resolve();
    await Promise.resolve();

    expect(await delivery.session(CHANNEL)).not.toBe(first);
    expect(lines.some((line) => line.includes("detach after continuity loss"))).toBe(true);
    expect(lines.some((line) => line.includes("channel is failed"))).toBe(true);
  });

  it("leaves the cache alone for a session error that is not a continuity loss", async () => {
    reset();
    const delivery = createStudioAgentDeliveryClient(config, () => {});

    const first = await delivery.session(CHANNEL);
    for (const handler of sessions.handlers) {
      handler(new Ably.ErrorInfo("unable to subscribe", 104001, 500));
    }

    expect(await delivery.session(CHANNEL)).toBe(first);
    expect(sessions.created).toHaveLength(1);
    expect(sessions.created[0]?.detached).toBe(0);
  });
});
