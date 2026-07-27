import { describe, expect, it } from "vitest";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentApprovalSignal,
  type StudioAgentCancelSignal,
  type StudioAgentInputSignal,
} from "@repo/shared/studio-agent";
import { StudioAgentSignalInbox } from "./signal-inbox.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);

describe("StudioAgentSignalInbox", () => {
  it("deduplicates inputs while preserving interrupt and enqueue order", () => {
    const inbox = new StudioAgentSignalInbox();
    const enqueue = input("33333333-3333-4333-8333-333333333333", "enqueue");
    const steer = input("44444444-4444-4444-8444-444444444444", "steer");
    const stop = input("55555555-5555-4555-8555-555555555555", "stop_and_send");

    inbox.addInput(enqueue);
    inbox.addInput(steer);
    inbox.addInput(steer);
    inbox.addInput(stop);

    expect(inbox.peekInterrupt()?.inputId).toBe(steer.inputId);
    expect(inbox.takeInterrupt()?.inputId).toBe(steer.inputId);
    expect(inbox.takeInterrupt()?.inputId).toBe(stop.inputId);
    expect(inbox.peekInterrupt()).toBeNull();
  });

  it("only releases approval decisions bound to the exact action input", () => {
    const inbox = new StudioAgentSignalInbox();
    const approval = approvalSignal("2026-07-24T01:00:00.000Z", "approved");
    const laterDenial = approvalSignal("2026-07-24T01:00:01.000Z", "denied");

    inbox.addApproval(approval);
    inbox.addApproval(laterDenial);

    expect(inbox.hasApproval(approval.approvalId, approval.actionId, "b".repeat(64))).toBe(false);
    expect(
      inbox.takeApproval(approval.approvalId, approval.actionId, approval.actionInputHash)?.decision
    ).toBe("denied");
    expect(
      inbox.takeApproval(approval.approvalId, approval.actionId, approval.actionInputHash)
    ).toBeNull();
  });

  it("retains the latest cancellation request deterministically", () => {
    const inbox = new StudioAgentSignalInbox();
    inbox.requestCancellation(cancelSignal("2026-07-24T01:00:01.000Z", "new"));
    inbox.requestCancellation(cancelSignal("2026-07-24T01:00:00.000Z", "old"));

    expect(inbox.cancellation()?.reason).toBe("new");
  });
});

function input(
  inputId: string,
  delivery: StudioAgentInputSignal["delivery"]
): StudioAgentInputSignal {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    inputId,
    threadId: THREAD_ID,
    targetRunId: RUN_ID,
    delivery,
    emittedAt: "2026-07-24T01:00:00.000Z",
  };
}

function approvalSignal(
  decidedAt: string,
  decision: StudioAgentApprovalSignal["decision"]
): StudioAgentApprovalSignal {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    approvalId: "66666666-6666-4666-8666-666666666666",
    actionId: "77777777-7777-4777-8777-777777777777",
    targetRunId: RUN_ID,
    actionInputHash: HASH,
    decision,
    actorId: "user:test",
    note: null,
    decidedAt,
  };
}

function cancelSignal(requestedAt: string, reason: string): StudioAgentCancelSignal {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: THREAD_ID,
    targetRunId: RUN_ID,
    requestedByActorId: "user:test",
    reason,
    requestedAt,
  };
}
