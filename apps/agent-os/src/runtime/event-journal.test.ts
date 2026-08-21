import { describe, expect, it } from "vitest";
import { FIZZ_AGENT_PROTOCOL_VERSION, type AgentEventEnvelope } from "@repo/agent-protocol";

import { EventJournal } from "./event-journal.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

describe("EventJournal writer contract", () => {
  it("rejects an uncorrelated new event without consuming a sequence", () => {
    const journal = new EventJournal();
    expect(() =>
      journal.append({
        sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        type: "MessageStarted",
        data: { messageId: "assistant-1", segmentKind: "response" },
      })
    ).toThrow(/turnId/);
    expect(journal.lastSequence).toBe(0);

    const event = journal.append({
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageStarted",
      data: { turnId: TURN_ID, messageId: "assistant-1", segmentKind: "response" },
    });
    expect(event.sequence).toBe(1);
  });

  it("restores legacy envelopes but applies the strict contract to the next write", () => {
    const journal = new EventJournal();
    const legacy: AgentEventEnvelope = {
      id: "44444444-4444-4444-8444-444444444444",
      protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      sequence: 9,
      timestamp: "2026-08-20T00:00:00.000Z",
      type: "MessageCompleted",
      data: { messageId: "legacy-assistant", text: "Legacy response" },
    };
    journal.restore([legacy]);
    expect(journal.lastSequence).toBe(9);
    expect(() =>
      journal.append({
        sessionId: legacy.sessionId,
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        type: "RunResumed",
        data: { reason: "legacy_resume" },
      })
    ).toThrow();
  });
});
