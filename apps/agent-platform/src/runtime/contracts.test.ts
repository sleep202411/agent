import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  agentCancellationCommandSchema,
  agentInvocationAdmissionSchema,
  agentInvocationCommandSchema,
  agentSessionWorkflowInputSchema,
} from "./contracts.js";

const conversationId = "0197f4a2-0800-7000-8000-000000000004";
const sessionName = `agent:v1:conversation:${conversationId}`;

function command() {
  return {
    schemaVersion: "agent-invocation-command/v1" as const,
    invocation: {
      inputEventId: "event-1",
      sessionName,
    },
    invocationId: randomUUID(),
    attemptId: randomUUID(),
    attemptOrdinal: 0,
    provisionalRunId: randomUUID(),
    maxModelSteps: 8,
    context: {
      actorId: "actor-1",
      actorDisplayName: "Actor One",
      conversationId,
      surface: "story-studio" as const,
      sessionName,
      permissionMode: "smart" as const,
      scope: {
        kind: "story-project" as const,
        workspaceId: "workspace-1",
        projectId: "project-1",
      },
      locale: "en-US",
      roles: ["creator"],
      permissions: ["story.read"],
      traceId: "trace-1",
    },
  };
}

describe("agent runtime contracts", () => {
  it("binds every invocation to its signed session", () => {
    const value = command();
    value.invocation.sessionName = "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000005";
    expect(agentInvocationCommandSchema.safeParse(value).success).toBe(false);
  });

  it("rejects duplicate attempt identities in continued state", () => {
    const value = command();
    expect(
      agentSessionWorkflowInputSchema.safeParse({
        schemaVersion: "agent-session-workflow/v2",
        sessionName,
        pendingInvocations: [value],
        cancelledPendingInvocationIds: [],
        recentAttempts: [
          {
            invocationId: value.invocationId,
            attemptId: value.attemptId,
            attemptOrdinal: value.attemptOrdinal,
          },
        ],
        aggregateAttempts: [
          {
            invocationId: value.invocationId,
            attemptId: value.attemptId,
            attemptOrdinal: value.attemptOrdinal,
            phase: "admitted",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("allows an approval continuation to reuse one aggregate with a new attempt", () => {
    const first = command();
    const continuation = {
      ...first,
      invocation: { ...first.invocation, inputEventId: "event-2" },
      attemptId: randomUUID(),
      attemptOrdinal: 1,
    };
    expect(
      agentSessionWorkflowInputSchema.safeParse({
        schemaVersion: "agent-session-workflow/v2",
        sessionName,
        pendingInvocations: [continuation],
        cancelledPendingInvocationIds: [],
        recentAttempts: [
          {
            invocationId: first.invocationId,
            attemptId: first.attemptId,
            attemptOrdinal: first.attemptOrdinal,
          },
        ],
        aggregateAttempts: [
          {
            invocationId: continuation.invocationId,
            attemptId: continuation.attemptId,
            attemptOrdinal: continuation.attemptOrdinal,
            phase: "admitted",
          },
        ],
      }).success
    ).toBe(true);
  });

  it("requires carried cancellations to belong to a pending invocation", () => {
    expect(
      agentSessionWorkflowInputSchema.safeParse({
        schemaVersion: "agent-session-workflow/v2",
        sessionName,
        pendingInvocations: [],
        cancelledPendingInvocationIds: [randomUUID()],
        recentAttempts: [],
        aggregateAttempts: [],
      }).success
    ).toBe(false);
  });

  it("accepts only cancellation commands bound to one session and invocation", () => {
    expect(
      agentCancellationCommandSchema.parse({
        schemaVersion: "agent-cancellation-command/v1",
        sessionName,
        invocationId: randomUUID(),
      })
    ).toMatchObject({ sessionName });
    expect(
      agentCancellationCommandSchema.safeParse({
        schemaVersion: "agent-cancellation-command/v1",
        sessionName,
        invocationId: "not-a-uuid",
        runId: randomUUID(),
      }).success
    ).toBe(false);
  });

  it("keeps bounded-queue admission explicit and versioned", () => {
    const invocationId = randomUUID();
    const attemptId = randomUUID();
    expect(
      agentInvocationAdmissionSchema.parse({
        schemaVersion: "agent-invocation-admission/v1",
        invocationId,
        attemptId,
        attemptOrdinal: 0,
        status: "queue-full",
      })
    ).toEqual({
      schemaVersion: "agent-invocation-admission/v1",
      invocationId,
      attemptId,
      attemptOrdinal: 0,
      status: "queue-full",
    });
  });
});
