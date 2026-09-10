import { describe, expect, it, vi } from "vitest";
import type { AgentOsAblyResyncPointer } from "@repo/shared";
import { isAgentOsAblyResyncPointer, isAgentOsChannelDiscontinuity } from "./ably-live";
import {
  AgentOsRealtimeConversationReconciler,
  AgentOsRealtimeResyncPuller,
  advanceAgentOsContiguousSequence,
  agentOsCatchUpAfterSequence,
  agentOsCatchUpTargetFromEventGap,
  agentOsCatchUpTargetFromPointer,
  agentOsCatchUpTargetFromSnapshot,
  type AgentOsJournalCatchUpTarget,
  type AgentOsSequencedEvent,
} from "./realtime-resync";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

describe("Agent OS realtime journal resync", () => {
  it("keeps the durable cursor at the contiguous watermark when a higher event arrives first", () => {
    const events = new Map<number, unknown>([
      [1, {}],
      [3, {}],
    ]);
    expect(advanceAgentOsContiguousSequence(events)).toBe(1);
    events.set(2, {});
    expect(advanceAgentOsContiguousSequence(events, 1)).toBe(3);
  });

  it("uses an earlier local gap instead of blindly starting at pointer sequence minus one", async () => {
    const events = new Map<number, AgentOsSequencedEvent>([
      [1, event(1)],
      [2, event(2)],
    ]);
    const load = vi.fn(async (_target, afterSequence: number) => {
      expect(afterSequence).toBe(2);
      return page([event(3), event(4), event(5)]);
    });
    const puller = new AgentOsRealtimeResyncPuller(
      load,
      (result) => mergeEvents(events, result.events),
      () => advanceAgentOsContiguousSequence(events),
      immediateRetry
    );
    const pointer = eventPointer(5);

    await puller.request(agentOsCatchUpTargetFromPointer(pointer));

    expect(load).toHaveBeenCalledTimes(1);
    expect(advanceAgentOsContiguousSequence(events)).toBe(5);
    puller.dispose();
  });

  it("repairs N when N+1 was delivered first and coalesces repeated pointers", async () => {
    const events = new Map<number, AgentOsSequencedEvent>([
      [1, event(1)],
      [3, event(3)],
    ]);
    const response = deferred<ReturnType<typeof page>>();
    const load = vi.fn((...args: [AgentOsJournalCatchUpTarget, number, AbortSignal]) => {
      void args;
      return response.promise;
    });
    const puller = new AgentOsRealtimeResyncPuller(
      load,
      (result) => mergeEvents(events, result.events),
      () => advanceAgentOsContiguousSequence(events),
      immediateRetry
    );
    const target = agentOsCatchUpTargetFromPointer(eventPointer(2));

    const first = puller.request(target);
    const duplicate = puller.request(target);
    response.resolve(page([event(2), event(3)]));
    await Promise.all([first, duplicate]);
    await puller.request(target);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[1]).toBe(1);
    expect(advanceAgentOsContiguousSequence(events)).toBe(3);
    puller.dispose();
  });

  it("does not merge a late old-conversation response after reset", async () => {
    const events = new Map<number, AgentOsSequencedEvent>([[1, event(1)]]);
    const response = deferred<ReturnType<typeof page>>();
    const puller = new AgentOsRealtimeResyncPuller(
      () => response.promise,
      (result) => mergeEvents(events, result.events),
      () => advanceAgentOsContiguousSequence(events),
      immediateRetry
    );

    const pending = puller.request(agentOsCatchUpTargetFromPointer(eventPointer(2)));
    puller.reset();
    response.resolve(page([event(2)]));
    await pending;

    expect(events.has(2)).toBe(false);
    puller.dispose();
  });

  it("does not let an aborted pointer cleanup delete the replacement request gate", async () => {
    const events = new Map<number, AgentOsSequencedEvent>([[1, event(1)]]);
    const oldResponse = deferred<ReturnType<typeof page>>();
    const replacementResponse = deferred<ReturnType<typeof page>>();
    const load = vi
      .fn(() => oldResponse.promise)
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => replacementResponse.promise);
    const puller = new AgentOsRealtimeResyncPuller(
      load,
      (result) => mergeEvents(events, result.events),
      () => advanceAgentOsContiguousSequence(events),
      immediateRetry
    );
    const target = agentOsCatchUpTargetFromPointer(eventPointer(2));

    const old = puller.request(target);
    puller.reset();
    const replacement = puller.request(target);
    oldResponse.resolve(page([event(2)]));
    await old;
    const duplicate = puller.request(target);

    expect(duplicate).toBe(replacement);
    expect(load).toHaveBeenCalledTimes(2);
    replacementResponse.resolve(page([event(2)]));
    await Promise.all([replacement, duplicate]);
    puller.dispose();
  });

  it("retries a lost HTTP response with the same fixed cursor", async () => {
    const events = new Map<number, AgentOsSequencedEvent>([[1, event(1)]]);
    const load = vi
      .fn((...args: [AgentOsJournalCatchUpTarget, number, AbortSignal]) => {
        void args;
        return Promise.resolve(page([event(2)]));
      })
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(page([event(2)]));
    const puller = new AgentOsRealtimeResyncPuller(
      load,
      (result) => mergeEvents(events, result.events),
      () => advanceAgentOsContiguousSequence(events),
      immediateRetry
    );

    await puller.request(agentOsCatchUpTargetFromPointer(eventPointer(2)));

    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map((call) => call[1])).toEqual([1, 1]);
    expect(advanceAgentOsContiguousSequence(events)).toBe(2);
    puller.dispose();
  });

  it("coalesces a channel-discontinuity pull and accepts authoritative HITL closure", async () => {
    let status = "waiting_for_approval";
    let pendingApproval = true;
    const response = deferred<{
      runId: string;
      events: AgentOsSequencedEvent[];
      status: string;
      pendingApproval: null;
    }>();
    const load = vi.fn((...args: [AgentOsJournalCatchUpTarget, number, AbortSignal]) => {
      void args;
      return response.promise;
    });
    const puller = new AgentOsRealtimeResyncPuller(
      load,
      (result) => {
        status = result.status;
        pendingApproval = result.pendingApproval !== null;
      },
      () => 2,
      immediateRetry
    );

    const first = puller.requestWatermark({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      afterSequence: 2,
    });
    const duplicateUpdate = puller.requestWatermark({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      afterSequence: 2,
    });
    response.resolve({
      runId: RUN_ID,
      events: [event(3)],
      status: "completed",
      pendingApproval: null,
    });
    await Promise.all([first, duplicateUpdate]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[1]).toBe(2);
    expect(status).toBe("completed");
    expect(pendingApproval).toBe(false);
    puller.dispose();
  });

  it("does not let an aborted watermark cleanup delete the replacement request gate", async () => {
    const oldResponse = deferred<ReturnType<typeof page>>();
    const replacementResponse = deferred<ReturnType<typeof page>>();
    const load = vi
      .fn(() => oldResponse.promise)
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => replacementResponse.promise);
    const puller = new AgentOsRealtimeResyncPuller(
      load,
      () => undefined,
      () => 1,
      immediateRetry
    );
    const watermark = {
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      afterSequence: 1,
    };

    const old = puller.requestWatermark(watermark);
    puller.reset();
    const replacement = puller.requestWatermark(watermark);
    oldResponse.resolve(page([event(2)]));
    await old;
    const duplicate = puller.requestWatermark(watermark);

    expect(duplicate).toBe(replacement);
    expect(load).toHaveBeenCalledTimes(2);
    replacementResponse.resolve(page([event(2)]));
    await Promise.all([replacement, duplicate]);
    puller.dispose();
  });

  it("reconciles conversation history to discover a whole terminal run missed while offline", async () => {
    const knownRuns = new Map([["old-run", "completed"]]);
    const response = deferred<{
      conversationId: string;
      runs: Array<{ runId: string; status: string }>;
    }>();
    const load = vi.fn(() => response.promise);
    const reconciler = new AgentOsRealtimeConversationReconciler(
      load,
      (history) => {
        for (const run of history.runs) knownRuns.set(run.runId, run.status);
      },
      immediateRetry
    );

    const first = reconciler.request(CONVERSATION_ID);
    const repeatedAttachedSignal = reconciler.request(CONVERSATION_ID);
    response.resolve({
      conversationId: CONVERSATION_ID,
      runs: [
        { runId: "old-run", status: "completed" },
        { runId: "new-run-created-in-another-tab", status: "completed" },
      ],
    });
    await Promise.all([first, repeatedAttachedSignal]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(knownRuns.get("new-run-created-in-another-tab")).toBe("completed");
    reconciler.dispose();
  });

  it("does not let an aborted conversation cleanup delete the replacement request gate", async () => {
    const oldResponse = deferred<{ conversationId: string; runs: [] }>();
    const replacementResponse = deferred<{ conversationId: string; runs: [] }>();
    const load = vi
      .fn(() => oldResponse.promise)
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => replacementResponse.promise);
    const reconciler = new AgentOsRealtimeConversationReconciler(
      load,
      () => undefined,
      immediateRetry
    );

    const old = reconciler.request(CONVERSATION_ID);
    reconciler.reset();
    const replacement = reconciler.request(CONVERSATION_ID);
    oldResponse.resolve({ conversationId: CONVERSATION_ID, runs: [] });
    await old;
    const duplicate = reconciler.request(CONVERSATION_ID);

    expect(duplicate).toBe(replacement);
    expect(load).toHaveBeenCalledTimes(2);
    replacementResponse.resolve({ conversationId: CONVERSATION_ID, runs: [] });
    await Promise.all([replacement, duplicate]);
    reconciler.dispose();
  });

  it("starts from zero after reload when the browser has no durable prefix", async () => {
    const events = new Map<number, AgentOsSequencedEvent>();
    const load = vi.fn(async (_target, afterSequence: number) => {
      expect(afterSequence).toBe(0);
      return page([event(1), event(2), event(3), event(4), event(5)]);
    });
    const puller = new AgentOsRealtimeResyncPuller(
      load,
      (result) => mergeEvents(events, result.events),
      () => advanceAgentOsContiguousSequence(events),
      immediateRetry
    );

    await puller.request(agentOsCatchUpTargetFromPointer(eventPointer(5)));

    expect(advanceAgentOsContiguousSequence(events)).toBe(5);
    puller.dispose();
  });

  it("turns a normal snapshot watermark or an out-of-order event into an HTTP gap repair", () => {
    expect(
      agentOsCatchUpTargetFromSnapshot(
        { runId: RUN_ID, conversationId: CONVERSATION_ID, lastSequence: 5 },
        2
      )
    ).toEqual({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      sequence: 5,
      afterSequence: 2,
    });
    expect(
      agentOsCatchUpTargetFromEventGap(
        { ...event(5), runId: RUN_ID, conversationId: CONVERSATION_ID },
        2
      )
    ).toEqual({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      sequence: 5,
      afterSequence: 2,
      eventId: "event-5",
    });
    expect(
      agentOsCatchUpTargetFromEventGap(
        { ...event(3), runId: RUN_ID, conversationId: CONVERSATION_ID },
        2
      )
    ).toBeNull();
  });

  it("validates the wire pointer and rejects malformed cursors", () => {
    const pointer = eventPointer(4);
    expect(isAgentOsAblyResyncPointer(pointer)).toBe(true);
    expect(isAgentOsAblyResyncPointer({ ...pointer, afterSequence: 1 })).toBe(false);
    expect(isAgentOsAblyResyncPointer({ ...pointer, eventId: "" })).toBe(false);
    expect(agentOsCatchUpAfterSequence(2, 4)).toBe(2);
    expect(agentOsCatchUpAfterSequence(9, 4)).toBe(4);
    expect(isAgentOsChannelDiscontinuity({ resumed: false })).toBe(true);
    expect(isAgentOsChannelDiscontinuity({ resumed: true })).toBe(false);
  });

  it("accepts a backlog range and catches up from before its first missing event", () => {
    const pointer = { ...eventPointer(500), kind: "event_backlog" as const, afterSequence: 20 };
    expect(isAgentOsAblyResyncPointer(pointer)).toBe(true);
    expect(agentOsCatchUpTargetFromPointer(pointer)).toMatchObject({
      sequence: 500,
      afterSequence: 20,
    });
    expect(isAgentOsAblyResyncPointer({ ...pointer, afterSequence: 500 })).toBe(false);
  });
});

function event(sequence: number): AgentOsSequencedEvent {
  return { id: `event-${sequence}`, sequence };
}

function eventPointer(sequence: number): Extract<AgentOsAblyResyncPointer, { eventId: string }> {
  return {
    version: 1,
    kind: "event_oversized",
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    sequence,
    afterSequence: sequence - 1,
    eventId: `event-${sequence}`,
  };
}

function page(events: AgentOsSequencedEvent[]) {
  return { runId: RUN_ID, events };
}

function mergeEvents(
  target: Map<number, AgentOsSequencedEvent>,
  events: readonly AgentOsSequencedEvent[]
): void {
  for (const value of events) target.set(value.sequence, value);
}

function immediateRetry(): Promise<void> {
  return Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
