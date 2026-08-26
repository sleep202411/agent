import { describe, expect, it } from "vitest";
import type { AgentOsEvent } from "@/lib/agent-os/api-client";
import {
  agentOsConversationStorageKey,
  agentOsStartOutboxStorageKey,
  AGENT_OS_START_OUTBOX_TTL_MS,
  agentOsPollFailureCode,
  agentOsPollSnapshotDisposition,
  approvalSubmissionIdentity,
  deriveAgentActivity,
  derivePendingExternalFromEvents,
  derivePendingApprovalFromEvents,
  derivePendingUserInputFromEvents,
  deriveStatusFromEvents,
  isAgentOsActionableRunStatus,
  isStartSubmissionIdentityFresh,
  messagesFromConversationHistory,
  reconcileAgentOsConversationRunOrder,
  rebuildRunTimelineFromEvents,
  startSubmissionIdentity,
  userInputSubmissionIdentity,
} from "./use-agent-os-run";

function ev(
  sequence: number,
  type: string,
  data: Record<string, unknown> = {},
  runId = "run-1"
): AgentOsEvent {
  return {
    id: `e${sequence}`,
    protocolVersion: "fizz.agent.v1",
    sessionId: "s1",
    runId,
    conversationId: "c1",
    sequence,
    timestamp: new Date(1_700_000_000_000 + sequence * 1000).toISOString(),
    type,
    data,
  };
}

describe("project conversation identity", () => {
  it("is keyed by project, never by workbench mode or chapter", () => {
    expect(agentOsConversationStorageKey("project-1")).toBe(
      "fizz:agent-os:conversationId:project-1"
    );
  });

  it("keeps start transport retries on one durable submission identity", async () => {
    expect(agentOsStartOutboxStorageKey("project-outbox")).toBe(
      "fizz:agent-os:start-outbox:project-outbox"
    );
    let id = 0;
    const createId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
    const input = {
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Build this scene",
      modelProfileId: "qwen-plus",
      attachmentIds: ["22222222-2222-4222-8222-222222222222"],
      permissionMode: "smart" as const,
      workbenchMode: "story" as const,
      workbenchContext: { chapterId: "33333333-3333-4333-8333-333333333333" },
      skillIds: ["story.read", "story.edit"],
    };

    const first = await startSubmissionIdentity("project-outbox", input, createId);
    const retry = await startSubmissionIdentity("project-outbox", input, createId);
    const normalizedRetry = await startSubmissionIdentity(
      "project-outbox",
      {
        ...input,
        message: " Build this scene ",
        modelProfileId: " qwen-plus ",
        skillIds: ["story.edit", " story.read "],
      },
      createId
    );
    const changed = await startSubmissionIdentity(
      "project-outbox",
      { ...input, message: "Build a different scene" },
      createId
    );

    expect(retry).toEqual(first);
    expect(normalizedRetry).toEqual(first);
    expect(changed.clientSubmissionId).not.toBe(first.clientSubmissionId);
    expect(changed.turnId).not.toBe(first.turnId);
    expect(changed.messageId).not.toBe(first.messageId);
    const now = Date.now();
    expect(
      isStartSubmissionIdentityFresh({ createdAt: new Date(now - 1_000).toISOString() }, now)
    ).toBe(true);
    expect(
      isStartSubmissionIdentityFresh(
        { createdAt: new Date(now - AGENT_OS_START_OUTBOX_TTL_MS - 1).toISOString() },
        now
      )
    ).toBe(false);
  });
});

describe("actionable run lifecycle", () => {
  it("includes HITL, queued, paused, and active execution but excludes terminal runs", () => {
    expect(
      [
        "waiting_for_approval",
        "waiting_for_input",
        "waiting_for_external",
        "running",
        "queued",
        "paused",
      ].every(isAgentOsActionableRunStatus)
    ).toBe(true);
    expect(["completed", "failed", "cancelled"].some(isAgentOsActionableRunStatus)).toBe(false);
  });
});

describe("idempotent structured answers", () => {
  it("reuses response and optimistic row identities for a semantic retry", () => {
    const store = new Map();
    let id = 0;
    const createId = () => `id-${++id}`;
    const first = userInputSubmissionIdentity(
      store,
      "request-1",
      { runtime: "short", ratio: "16:9" },
      createId
    );
    const retry = userInputSubmissionIdentity(
      store,
      "request-1",
      { ratio: "16:9", runtime: "short" },
      createId
    );
    const changed = userInputSubmissionIdentity(
      store,
      "request-1",
      { ratio: "9:16", runtime: "short" },
      createId
    );

    expect(retry).toBe(first);
    expect(changed.responseId).not.toBe(first.responseId);
  });

  it("reuses one approval response identity and changes it with the decision", () => {
    const store = new Map();
    let id = 0;
    const createId = () => `id-${++id}`;
    const first = approvalSubmissionIdentity(
      store,
      "approval-1",
      "approve",
      "Approved",
      "en-US",
      createId
    );
    const retry = approvalSubmissionIdentity(
      store,
      "approval-1",
      "approve",
      "Approved",
      "en-US",
      createId
    );
    const changed = approvalSubmissionIdentity(
      store,
      "approval-1",
      "reject",
      "Rejected",
      "en-US",
      createId
    );

    expect(retry).toBe(first);
    expect(changed.responseId).not.toBe(first.responseId);
    const relocalized = approvalSubmissionIdentity(
      store,
      "approval-1",
      "reject",
      "已拒绝",
      "zh-CN",
      createId
    );
    expect(relocalized.responseId).not.toBe(changed.responseId);
  });

  it("projects a rejected action as a resumed run, not a cancelled conversation", () => {
    expect(
      deriveStatusFromEvents(
        [
          ev(1, "ApprovalResolved", {
            turnId: "turn-2",
            approvalId: "approval-1",
            responseId: "response-1",
            decision: "reject",
          }),
        ],
        "waiting_for_approval"
      )
    ).toBe("running");
  });

  it("never converts an external handoff into a polling failure", () => {
    expect(
      agentOsPollFailureCode({
        status: "waiting_for_external",
        consecutiveFailures: 99,
        maxConsecutiveFailures: 8,
        now: 20_000,
        ordinaryDeadlineAt: 10_000,
      })
    ).toBeNull();
    expect(
      agentOsPollFailureCode({
        status: "running",
        consecutiveFailures: 8,
        maxConsecutiveFailures: 8,
        now: 5_000,
        ordinaryDeadlineAt: 10_000,
      })
    ).toBe("AGENT_OS_POLL_LOST");
  });

  it("keeps every successful durable running snapshot alive until the server settles it", () => {
    const repeatedDurableSnapshots = Array.from({ length: 12 }, () => ({
      status: "running",
      source: "postgres",
    }));

    expect(repeatedDurableSnapshots.map(agentOsPollSnapshotDisposition)).toEqual(
      repeatedDurableSnapshots.map(() => "continue")
    );
    expect(agentOsPollSnapshotDisposition({ status: "completed", source: "postgres" })).toBe(
      "stop"
    );
    expect(
      deriveAgentActivity([ev(1, "RunStarted", { turnId: "turn-long-running" })], "running")
    ).toEqual({ kind: "thinking", turnId: "turn-long-running" });
  });
});

describe("turn timeline projection", () => {
  it("restores attachment-only user turns from durable metadata", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", {
          turnId: "11111111-1111-4111-8111-111111111111",
          messageId: "22222222-2222-4222-8222-222222222222",
          text: "",
          attachments: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              filename: "source.fountain",
            },
          ],
        }),
      ],
      "run-1",
      "running"
    );

    expect(rows).toEqual([
      expect.objectContaining({
        role: "user",
        content: "",
        meta: expect.objectContaining({ attachmentNames: ["source.fountain"] }),
      }),
    ]);
  });

  it("groups immutable messageId segments into one Assistant UI turn", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", {
          turnId: "turn-1",
          messageId: "user-1",
          text: "List the shots and summarize them.",
        }),
        ev(2, "MessageStarted", {
          turnId: "turn-1",
          messageId: "msg-lead",
          segmentKind: "lead_in",
        }),
        ev(3, "MessageDelta", {
          turnId: "turn-1",
          messageId: "msg-lead",
          delta: "I’ll check the current storyboard.",
        }),
        ev(4, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "msg-lead",
          text: "I’ll check the current storyboard.",
          finishReason: "tool_call",
        }),
        ev(5, "ToolStarted", {
          turnId: "turn-1",
          toolId: "storyboard.listShots",
          toolCallId: "call-1",
        }),
        ev(6, "ToolCompleted", {
          turnId: "turn-1",
          toolId: "storyboard.listShots",
          toolCallId: "call-1",
        }),
        ev(7, "MessageStarted", {
          turnId: "turn-1",
          messageId: "msg-result",
          segmentKind: "result",
        }),
        ev(8, "MessageDelta", {
          turnId: "turn-1",
          messageId: "msg-result",
          delta: "There are three shots.",
        }),
        ev(9, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "msg-result",
          text: "There are three shots.",
          finishReason: "stop",
        }),
      ],
      "run-1",
      "completed"
    );

    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[1]).toMatchObject({
      id: "assistant-turn:run-1:turn-1",
      turnId: "turn-1",
      role: "assistant",
      segments: [
        { id: "msg-lead", kind: "lead_in", completed: true },
        { id: "msg-result", kind: "result", completed: true },
      ],
    });
    expect(rows[1]?.content).toBe("I’ll check the current storyboard.\n\nThere are three shots.");
  });

  it("hides crash-recovery segments completed as superseded", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", {
          turnId: "turn-1",
          messageId: "user-1",
          text: "Continue the scene.",
        }),
        ev(2, "MessageStarted", {
          turnId: "turn-1",
          messageId: "msg-unverified",
          segmentKind: "response",
        }),
        ev(3, "MessageDelta", {
          turnId: "turn-1",
          messageId: "msg-unverified",
          delta: "Duplicated partial",
        }),
        ev(4, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "msg-unverified",
          text: "Duplicated partial",
          finishReason: "superseded",
        }),
        ev(5, "MessageStarted", {
          turnId: "turn-1",
          messageId: "msg-recovered",
          segmentKind: "response",
        }),
        ev(6, "MessageDelta", {
          turnId: "turn-1",
          messageId: "msg-recovered",
          delta: "Recovered answer",
        }),
        ev(7, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "msg-recovered",
          text: "Recovered answer",
          finishReason: "stop",
        }),
      ],
      "run-1",
      "completed"
    );

    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[1]).toMatchObject({
      content: "Recovered answer",
      segments: [{ id: "msg-recovered", finishReason: "stop" }],
    });
  });

  it("keeps question and approval operations out of the transcript", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", {
          turnId: "turn-1",
          messageId: "user-1",
          text: "Create an interactive film.",
        }),
        ev(2, "MessageStarted", {
          turnId: "turn-1",
          messageId: "msg-1",
          segmentKind: "lead_in",
        }),
        ev(3, "MessageDelta", {
          turnId: "turn-1",
          messageId: "msg-1",
          delta: "I need one decision first.",
        }),
        ev(4, "UserInputRequired", {
          turnId: "turn-1",
          requestId: "request-1",
          toolCallId: "call-input",
          questions: [
            {
              id: "ratio",
              header: "Aspect ratio",
              question: "Choose a frame.",
              options: [
                { value: "9:16", label: "9:16" },
                { value: "16:9", label: "16:9" },
              ],
            },
          ],
        }),
        ev(5, "ApprovalRequired", {
          turnId: "turn-1",
          approvalId: "approval-1",
          toolCallId: "call-write",
          title: "Review this change",
        }),
      ],
      "run-1",
      "waiting_for_input"
    );

    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows.some((row) => row.role !== "user" && row.role !== "assistant")).toBe(false);
  });

  it("renders a structured answer as a new user turn, then resumes in one Assistant group", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", {
          turnId: "turn-request",
          messageId: "user-request",
          text: "Build a historical FMV game.",
        }),
        ev(2, "MessageStarted", {
          turnId: "turn-request",
          messageId: "msg-lead",
          segmentKind: "lead_in",
        }),
        ev(3, "MessageCompleted", {
          turnId: "turn-request",
          messageId: "msg-lead",
          text: "Please confirm the creative direction.",
          finishReason: "tool_call",
        }),
        ev(4, "UserInputRequired", {
          turnId: "turn-request",
          requestId: "request-1",
          toolCallId: "call-input",
          questions: [],
        }),
        ev(5, "UserMessage", {
          turnId: "turn-answer",
          messageId: "user-answer",
          text: "Aspect ratio: 16:9 landscape",
          interaction: {
            kind: "user_input",
            requestId: "request-1",
            answers: { aspect_ratio: "landscape_16_9" },
          },
        }),
        ev(6, "UserInputResolved", {
          turnId: "turn-answer",
          requestId: "request-1",
          answers: { aspect_ratio: "landscape_16_9" },
        }),
        ev(7, "MessageStarted", {
          turnId: "turn-answer",
          messageId: "msg-ack",
          segmentKind: "acknowledgement",
        }),
        ev(8, "MessageCompleted", {
          turnId: "turn-answer",
          messageId: "msg-ack",
          text: "Got it. I’ll draft the proposal now.",
          finishReason: "tool_call",
        }),
        ev(9, "MessageStarted", {
          turnId: "turn-answer",
          messageId: "msg-final",
          segmentKind: "result",
        }),
        ev(10, "MessageCompleted", {
          turnId: "turn-answer",
          messageId: "msg-final",
          text: "The proposal is ready for review.",
          finishReason: "external_result",
        }),
      ],
      "run-1",
      "completed"
    );

    expect(rows.map((row) => `${row.role}:${row.turnId}`)).toEqual([
      "user:turn-request",
      "assistant:turn-request",
      "user:turn-answer",
      "assistant:turn-answer",
    ]);
    expect(rows[3]?.segments?.map((segment) => segment.id)).toEqual(["msg-ack", "msg-final"]);
  });

  it("keeps completed acknowledgement followed by one thinking activity while work continues", () => {
    const events = [
      ev(1, "UserMessage", {
        turnId: "turn-1",
        messageId: "user-1",
        text: "Continue.",
      }),
      ev(2, "MessageStarted", {
        turnId: "turn-1",
        messageId: "msg-ack",
        segmentKind: "acknowledgement",
      }),
      ev(3, "MessageCompleted", {
        turnId: "turn-1",
        messageId: "msg-ack",
        text: "I’ve got it.",
        finishReason: "tool_call",
      }),
    ];
    expect(deriveAgentActivity(events, "running")).toEqual({
      kind: "thinking",
      turnId: "turn-1",
    });
    expect(deriveAgentActivity(events, "completed")).toBeNull();
  });

  it("shows the bootstrap permission step as thinking rather than a plan", () => {
    const events = [
      ev(1, "UserMessage", {
        turnId: "turn-1",
        messageId: "user-1",
        text: "Hello",
      }),
      ev(2, "RunStarted", { turnId: "turn-1" }),
      ev(3, "PlanCreated", {
        turnId: "turn-1",
        steps: ["Legacy runtime scaffold"],
      }),
      ev(4, "StepStarted", {
        turnId: "turn-1",
        step: "permission",
        permissionMode: "smart",
      }),
    ];

    expect(deriveAgentActivity(events, "running")).toEqual({
      kind: "thinking",
      turnId: "turn-1",
    });
  });

  it("tracks only the current turn's active tool and supports waiting_for_external", () => {
    const events = [
      ev(1, "UserMessage", { turnId: "turn-1", messageId: "u1", text: "First" }),
      ev(2, "ToolStarted", {
        turnId: "turn-1",
        toolId: "story.read",
        toolCallId: "c1",
      }),
      ev(3, "UserMessage", { turnId: "turn-2", messageId: "u2", text: "Second" }),
      ev(4, "ToolStarted", {
        turnId: "turn-2",
        toolId: "story.author",
        toolCallId: "c2",
      }),
    ];
    expect(deriveAgentActivity(events, "waiting_for_external")).toEqual({
      kind: "tool",
      toolId: "story.author",
      turnId: "turn-2",
    });
    expect(
      deriveAgentActivity([], "waiting_for_external", {
        kind: "external_job",
        jobId: "job-1",
        startedMessage: "Preparing the draft.",
        turnId: "turn-2",
        toolCallId: "c2",
        toolId: "story.author",
      })
    ).toEqual({ kind: "tool", toolId: "story.author", turnId: "turn-2" });
  });

  it("keeps HITL waits as one ephemeral activity on the blocked turn", () => {
    const inputEvents = [
      ev(1, "UserMessage", { turnId: "turn-1", messageId: "u1", text: "Build a story" }),
      ev(2, "UserInputRequired", {
        turnId: "turn-1",
        requestId: "request-1",
        toolCallId: "input-1",
        questions: [],
      }),
    ];
    expect(deriveAgentActivity(inputEvents, "waiting_for_input")).toEqual({
      kind: "waiting_for_input",
      turnId: "turn-1",
    });

    const approvalEvents = [
      ...inputEvents,
      ev(3, "UserMessage", { turnId: "turn-2", messageId: "u2", text: "Continue" }),
      ev(4, "ApprovalRequired", {
        turnId: "turn-2",
        approvalId: "approval-1",
        toolCallId: "write-1",
        title: "Review",
      }),
    ];
    expect(deriveAgentActivity(approvalEvents, "waiting_for_approval")).toEqual({
      kind: "waiting_for_approval",
      turnId: "turn-2",
    });
  });

  it("does not suppress durable narration after story.author handoff", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", {
          turnId: "turn-1",
          messageId: "user-1",
          text: "Draft this story.",
        }),
        ev(2, "ToolCompleted", {
          turnId: "turn-1",
          toolId: "story.author",
          toolCallId: "call-author",
        }),
        ev(3, "MessageStarted", {
          turnId: "turn-1",
          messageId: "msg-handoff",
          segmentKind: "response",
        }),
        ev(4, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "msg-handoff",
          text: "The draft is being prepared.",
          finishReason: "external_result",
        }),
      ],
      "run-1",
      "waiting_for_external"
    );
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[1]?.content).toBe("The draft is being prepared.");
  });

  it("resumes an external result inside the same formal Assistant turn", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", { turnId: "turn-1", messageId: "u1", text: "Draft it." }),
        ev(2, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "receipt",
          text: "I’m preparing the draft.",
          finishReason: "stop",
        }),
        ev(3, "RunPaused", {
          turnId: "turn-1",
          status: "waiting_for_external",
          externalJobId: "job-1",
          toolCallId: "call-1",
          toolId: "story.author",
        }),
        ev(4, "RunResumed", { turnId: "turn-1", reason: "external_job_completed" }),
        ev(5, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "result",
          text: "The draft is ready for review.",
          finishReason: "external_result",
        }),
        ev(6, "RunCompleted", { turnId: "turn-1", status: "completed" }),
      ],
      "run-1",
      "completed"
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]?.segments?.map((segment) => segment.id)).toEqual(["receipt", "result"]);
  });

  it("projects a durable Story proposal Artifact and keeps it after approval", () => {
    const storyRunId = "11111111-1111-4111-8111-111111111111";
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "UserMessage", { turnId: "turn-1", messageId: "u1", text: "Prepare assets." }),
        ev(2, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "proposal-ready",
          text: "The Asset Specs are ready.",
          finishReason: "external_result",
        }),
        ev(3, "ArtifactCreated", {
          turnId: "turn-1",
          artifactId: storyRunId,
          artifact: {
            kind: "story_stage_proposal",
            storyAgentRunId: storyRunId,
            storyProjectId: storyRunId,
            storyChapterId: storyRunId,
            workspaceId: storyRunId,
            stage: "assets",
            schemaVersion: "story-asset-proposal-v1",
          },
          status: "proposed",
        }),
        ev(4, "ToolProposed", {
          turnId: "turn-1",
          toolCallId: "apply-1",
          toolId: "story.applyProposal",
          arguments: { storyAgentRunId: storyRunId },
        }),
        ev(5, "ApprovalRequired", {
          turnId: "turn-1",
          approvalId: "approval-1",
          toolCallId: "apply-1",
        }),
        ev(6, "ApprovalResolved", {
          turnId: "turn-2",
          approvalId: "approval-1",
          responseId: "response-1",
          decision: "approve",
        }),
        ev(7, "ArtifactUpdated", {
          turnId: "turn-2",
          artifactId: storyRunId,
          status: "applied",
        }),
        ev(8, "RunCompleted", { turnId: "turn-2", status: "completed" }),
      ],
      "run-1",
      "completed"
    );

    const artifact = rows.find((row) => row.role === "assistant")?.artifacts?.[0];
    expect(artifact).toMatchObject({
      id: storyRunId,
      status: "applied",
      reference: {
        kind: "story_stage_proposal",
        storyAgentRunId: storyRunId,
        stage: "assets",
      },
    });
    expect(artifact?.reference.legacy).toBeUndefined();
  });

  it("deterministically recovers proposal Artifacts from pre-Artifact journals", () => {
    const storyRunId = "22222222-2222-4222-8222-222222222222";
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "MessageCompleted", {
          turnId: "turn-1",
          messageId: "proposal-ready",
          text: "The proposal is ready.",
          finishReason: "external_result",
        }),
        ev(2, "ToolProposed", {
          turnId: "turn-1",
          toolCallId: "apply-legacy",
          toolId: "story.applyProposal",
          arguments: { storyAgentRunId: storyRunId },
        }),
        ev(3, "ApprovalRequired", {
          turnId: "turn-1",
          approvalId: "approval-legacy",
          toolCallId: "apply-legacy",
        }),
        ev(4, "ApprovalResolved", {
          turnId: "turn-2",
          approvalId: "approval-legacy",
          responseId: "response-legacy",
          decision: "reject",
        }),
        ev(5, "RunCompleted", { turnId: "turn-2", status: "completed" }),
      ],
      "run-legacy",
      "completed"
    );

    expect(rows[0]?.artifacts).toEqual([
      expect.objectContaining({
        id: storyRunId,
        status: "rejected",
        reference: expect.objectContaining({
          kind: "story_stage_proposal",
          storyAgentRunId: storyRunId,
          legacy: true,
        }),
      }),
    ]);
  });

  it("creates deterministic legacy turns per old UserMessage", () => {
    const rows = rebuildRunTimelineFromEvents(
      [
        ev(1, "RunStarted", { status: "running" }),
        ev(2, "UserMessage", { messageId: "u1", text: "First" }),
        ev(3, "MessageDelta", { messageId: "m1", delta: "First answer" }),
        ev(4, "MessageCompleted", { messageId: "m1", text: "First answer" }),
        ev(5, "UserMessage", { messageId: "u2", text: "Second" }),
        ev(6, "MessageDelta", { messageId: "m2", delta: "Second answer" }),
      ],
      "run-1",
      "running"
    );
    expect(rows.map((row) => `${row.role}:${row.turnId}`)).toEqual([
      "user:legacy:run-1:0",
      "assistant:legacy:run-1:0",
      "user:legacy:run-1:1",
      "assistant:legacy:run-1:1",
    ]);
  });
});

describe("pending composer operations", () => {
  it("rebuilds and clears approval state without creating transcript rows", () => {
    const events = [
      ev(1, "ToolProposed", {
        turnId: "turn-1",
        toolId: "storyboard.deleteShots",
        toolCallId: "call-del",
        arguments: { shotIds: ["shot-1"] },
      }),
      ev(2, "ApprovalRequired", {
        turnId: "turn-1",
        approvalId: "approval-1",
        toolCallId: "call-del",
        title: "Review this change",
      }),
    ];
    expect(derivePendingApprovalFromEvents(events)).toMatchObject({
      approvalId: "approval-1",
      toolId: "storyboard.deleteShots",
      turnId: "turn-1",
    });
    expect(
      derivePendingApprovalFromEvents([
        ...events,
        ev(3, "ToolCompleted", {
          turnId: "turn-1",
          toolCallId: "another-call",
          toolId: "story.read",
        }),
      ])
    ).toMatchObject({ approvalId: "approval-1" });
    expect(
      derivePendingApprovalFromEvents([
        ...events,
        ev(3, "ApprovalResolved", {
          turnId: "turn-2",
          approvalId: "approval-1",
          decision: "approve",
        }),
      ])
    ).toBeNull();
  });

  it("rebuilds and clears a structured input request", () => {
    const required = ev(1, "UserInputRequired", {
      turnId: "turn-1",
      requestId: "request-1",
      toolCallId: "call-input",
      formId: "story_creative_profile",
      resumeAcknowledgement: "Thanks — I’ll continue with that direction.",
      questions: [
        {
          id: "ratio",
          header: "Aspect ratio",
          question: "Choose a frame.",
          options: [
            { value: "9:16", label: "9:16" },
            { value: "16:9", label: "16:9" },
          ],
        },
      ],
    });
    expect(derivePendingUserInputFromEvents([required])).toMatchObject({
      requestId: "request-1",
      turnId: "turn-1",
      resumeAcknowledgement: "Thanks — I’ll continue with that direction.",
    });
    expect(
      derivePendingUserInputFromEvents([
        required,
        ev(2, "UserInputResolved", {
          turnId: "turn-2",
          requestId: "another-request",
          responseId: "response-2",
          answers: { ratio: "9:16" },
        }),
      ])
    ).toMatchObject({ requestId: "request-1" });
    expect(
      derivePendingUserInputFromEvents([
        required,
        ev(2, "UserInputResolved", {
          turnId: "turn-2",
          requestId: "request-1",
          answers: { ratio: "16:9" },
        }),
      ])
    ).toBeNull();
  });
});

describe("conversation replay", () => {
  it("merges a bounded durable tail without moving omitted older runs to the end", () => {
    const createdAt = (index: number) => new Date(Date.UTC(2026, 7, 20, 0, 0, index)).toISOString();
    const local = Array.from({ length: 45 }, (_, index) => ({
      runId: `run-${String(index + 1).padStart(2, "0")}`,
      order: index,
      createdAt: createdAt(index + 1),
    }));
    // The endpoint returns its latest 40 durable rows, including a run that
    // was created and completed while this tab was disconnected.
    const tail = Array.from({ length: 40 }, (_, index) => ({
      runId: `run-${String(index + 7).padStart(2, "0")}`,
      createdAt: createdAt(index + 7),
    }));

    const reconciled = reconcileAgentOsConversationRunOrder(local, tail);

    expect(reconciled.map((run) => run.runId)).toEqual(
      Array.from({ length: 46 }, (_, index) => `run-${String(index + 1).padStart(2, "0")}`)
    );
    const allTerminal = messagesFromConversationHistory(
      reconciled.map((run) => ({ runId: run.runId, status: "completed", events: [] }))
    );
    expect(allTerminal.runId).toBe("run-46");
  });

  it("does not let an omitted older actionable run outrank a newly discovered queued run", () => {
    const createdAt = (index: number) => new Date(Date.UTC(2026, 7, 20, 0, 0, index)).toISOString();
    const local = Array.from({ length: 45 }, (_, index) => ({
      runId: `run-${String(index + 1).padStart(2, "0")}`,
      order: index,
      createdAt: createdAt(index + 1),
    }));
    const tail = Array.from({ length: 40 }, (_, index) => ({
      runId: `run-${String(index + 7).padStart(2, "0")}`,
      createdAt: createdAt(index + 7),
    }));
    const reconciled = reconcileAgentOsConversationRunOrder(local, tail);
    const projected = messagesFromConversationHistory(
      reconciled.map((run) => ({
        runId: run.runId,
        status:
          run.runId === "run-01" ? "running" : run.runId === "run-46" ? "queued" : "completed",
        events: [],
      }))
    );

    expect(projected.runId).toBe("run-46");
    expect(projected.status).toBe("running");
  });

  it("keeps snapshot copy visible while its started segment deltas catch up", () => {
    const history = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "running",
        assistantText: "Receipt from the live snapshot.",
        events: [
          ev(1, "UserMessage", {
            turnId: "turn-1",
            messageId: "u1",
            text: "Continue.",
          }),
          ev(2, "MessageStarted", {
            turnId: "turn-1",
            messageId: "m1",
            segmentKind: "acknowledgement",
          }),
        ],
      },
    ]);

    expect(history.status).toBe("running");
    expect(history.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Receipt from the live snapshot.",
      segments: [{ id: "m1", content: "Receipt from the live snapshot." }],
    });
  });

  it("restores durable external work as live instead of fabricating a terminal result", () => {
    const history = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "waiting_for_external",
        events: [
          ev(1, "UserMessage", {
            turnId: "turn-1",
            messageId: "u1",
            text: "Prepare the story draft.",
          }),
          ev(2, "ToolCompleted", {
            turnId: "turn-1",
            toolCallId: "call-author",
            toolId: "story.author",
            agentHandoff: {
              kind: "external_job",
              jobId: "job-1",
              startedMessage: "I’m preparing the draft now.",
            },
          }),
          ev(3, "MessageStarted", {
            turnId: "turn-1",
            messageId: "m-receipt",
            segmentKind: "acknowledgement",
          }),
          ev(4, "MessageCompleted", {
            turnId: "turn-1",
            messageId: "m-receipt",
            text: "I’m preparing the draft now.",
            finishReason: "stop",
          }),
          ev(5, "RunPaused", {
            turnId: "turn-1",
            status: "waiting_for_external",
            externalJobId: "job-1",
            toolCallId: "call-author",
            toolId: "story.author",
          }),
        ],
      },
    ]);

    expect(history.status).toBe("waiting_for_external");
    const pendingExternal = derivePendingExternalFromEvents(history.events);
    expect(pendingExternal).toMatchObject({ jobId: "job-1", toolId: "story.author" });
    expect(deriveAgentActivity(history.events, history.status, pendingExternal)).toEqual({
      kind: "tool",
      toolId: "story.author",
      turnId: "turn-1",
    });
  });

  it("keeps U1 → A1 → U2 → A2 across multiple runs", () => {
    const history = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "completed",
        events: [
          ev(1, "UserMessage", {
            turnId: "turn-1",
            messageId: "u1",
            text: "First",
          }),
          ev(2, "MessageCompleted", {
            turnId: "turn-1",
            messageId: "m1",
            text: "First answer",
            finishReason: "stop",
          }),
        ],
      },
      {
        runId: "run-2",
        status: "completed",
        events: [
          ev(1, "UserMessage", { turnId: "turn-2", messageId: "u2", text: "Second" }, "run-2"),
          ev(
            2,
            "MessageCompleted",
            {
              turnId: "turn-2",
              messageId: "m2",
              text: "Second answer",
              finishReason: "stop",
            },
            "run-2"
          ),
        ],
      },
    ]);
    expect(history.messages.map((message) => `${message.role}:${message.turnId}`)).toEqual([
      "user:turn-1",
      "assistant:turn-1",
      "user:turn-2",
      "assistant:turn-2",
    ]);
  });

  it("selects the newest run when every conversation run is terminal", () => {
    const history = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "completed",
        events: [ev(1, "RunCompleted", { turnId: "turn-1" })],
      },
      {
        runId: "run-2",
        status: "failed",
        events: [ev(1, "RunFailed", { turnId: "turn-2", code: "FAILED" }, "run-2")],
      },
    ]);

    expect(history.runId).toBe("run-2");
    expect(history.status).toBe("failed");
    expect(history.events).toHaveLength(1);
    expect(history.events[0]).toMatchObject({ runId: "run-2", type: "RunFailed" });
  });

  it("does not revive an older terminal run when a newer queued run exists", () => {
    const history = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "completed",
        events: [ev(1, "RunCompleted", { turnId: "turn-1" })],
      },
      {
        runId: "run-2",
        status: "queued",
        events: [],
      },
    ]);

    expect(history.runId).toBe("run-2");
    expect(history.status).toBe("running");
    expect(history.events).toEqual([]);
  });

  it("keeps a newer queued run actionable while an older run is still running", () => {
    const history = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "running",
        events: [ev(1, "RunStarted", { turnId: "turn-1" })],
      },
      {
        runId: "run-2",
        status: "queued",
        events: [],
      },
    ]);

    expect(history.runId).toBe("run-2");
    expect(history.status).toBe("running");
    expect(history.events).toEqual([]);
  });

  it("keeps the newer actionable run selected when an older run resync arrives late", () => {
    const history = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "running",
        events: [ev(1, "MessageDelta", { turnId: "turn-1", messageId: "m1", delta: "late" })],
      },
      {
        runId: "run-2",
        status: "waiting_for_approval",
        events: [
          ev(
            1,
            "ApprovalRequired",
            {
              turnId: "turn-2",
              approvalId: "approval-2",
              toolCallId: "call-2",
              toolId: "story.applyProposal",
              arguments: {},
              risk: "write",
              actions: ["approve", "reject"],
            },
            "run-2"
          ),
        ],
      },
    ]);

    expect(history.runId).toBe("run-2");
    expect(history.status).toBe("waiting_for_approval");
    expect(history.pendingApproval?.approvalId).toBe("approval-2");
    expect(history.events.every((event) => event.runId === "run-2")).toBe(true);
  });
});
