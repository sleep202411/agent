import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { attemptAdmissionDecision, attemptIdentity } from "./attempt-sequence.js";
import type { AgentInvocationCommand, AggregateAttemptCursor } from "./contracts.js";

function command(
  overrides: Partial<
    Pick<AgentInvocationCommand, "invocationId" | "attemptId" | "attemptOrdinal">
  > = {}
) {
  return {
    invocationId: randomUUID(),
    attemptId: randomUUID(),
    attemptOrdinal: 0,
    ...overrides,
  };
}

function cursor(
  value: ReturnType<typeof command>,
  phase: AggregateAttemptCursor["phase"]
): AggregateAttemptCursor {
  return { ...value, phase };
}

describe("durable attempt admission sequence", () => {
  it("admits only ordinal zero for a new product aggregate", () => {
    const root = command();
    expect(
      attemptAdmissionDecision({
        command: root,
        acceptedAttempt: undefined,
        aggregate: undefined,
      })
    ).toBe("accepted");
    expect(
      attemptAdmissionDecision({
        command: { ...root, attemptId: randomUUID(), attemptOrdinal: 1 },
        acceptedAttempt: undefined,
        aggregate: undefined,
      })
    ).toBe("sequence-conflict");
  });

  it("deduplicates only an exact durable attempt identity", () => {
    const root = command();
    expect(
      attemptAdmissionDecision({
        command: root,
        acceptedAttempt: attemptIdentity(root),
        aggregate: cursor(root, "terminal"),
      })
    ).toBe("already-accepted");
    expect(
      attemptAdmissionDecision({
        command: { ...root, invocationId: randomUUID() },
        acceptedAttempt: attemptIdentity(root),
        aggregate: undefined,
      })
    ).toBe("sequence-conflict");
  });

  it("admits exactly the next ordinal only after approval suspension", () => {
    const root = command();
    const continuation = {
      ...root,
      attemptId: randomUUID(),
      attemptOrdinal: 1,
    };
    expect(
      attemptAdmissionDecision({
        command: continuation,
        acceptedAttempt: undefined,
        aggregate: cursor(root, "waiting_for_approval"),
      })
    ).toBe("accepted");
    for (const aggregate of [cursor(root, "admitted"), cursor(root, "terminal")]) {
      expect(
        attemptAdmissionDecision({
          command: continuation,
          acceptedAttempt: undefined,
          aggregate,
        })
      ).toBe("sequence-conflict");
    }
    expect(
      attemptAdmissionDecision({
        command: { ...continuation, attemptOrdinal: 2 },
        acceptedAttempt: undefined,
        aggregate: cursor(root, "waiting_for_approval"),
      })
    ).toBe("sequence-conflict");
  });
});
