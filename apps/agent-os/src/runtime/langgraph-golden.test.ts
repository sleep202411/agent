import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  projectSkillSnapshotChecksum,
  type ProjectSkillResolutionSnapshot,
} from "@repo/agent-skills";
import type { DomainPort } from "@repo/agent-tools";
import { createLiteLlmChatModel } from "@repo/model-router";

import { InMemoryStoryDomain } from "./in-memory-domain.js";
import { HttpDomainPort } from "./http-domain-port.js";
import { LangGraphRunService } from "./langgraph-run-service.js";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT = "00000000-0000-4000-8000-000000000001";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function emptySkillMountSnapshot(
  workbenchMode: string,
  ownerKind: "platform" | "story" = "platform"
): ProjectSkillResolutionSnapshot {
  const unsigned = {
    schemaVersion: "project-skill-resolution/v1" as const,
    resolutionId: "50000000-0000-7000-8000-000000000001",
    ownerKind,
    projectId: PROJECT,
    projectRevision: 0,
    scope: "agent_prompt" as const,
    workbenchMode,
    sourceSurface: "fizzagent",
    resolvedAt: "2026-08-11T00:00:00.000Z",
    skills: [],
  };
  return { ...unsigned, checksum: projectSkillSnapshotChecksum(unsigned) };
}

function streamedModelResponse(
  content: string,
  calls?: Array<{ id: string; name: string; args: unknown }>
) {
  const completionId = crypto.randomUUID();
  const choices = [
    {
      delta: {
        role: "assistant",
        content,
        ...(calls
          ? {
              tool_calls: calls.map((call, index) => ({
                index,
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      },
      finish_reason: null,
    },
    { delta: {}, finish_reason: calls ? "tool_calls" : "stop" },
  ];
  return new Response(
    choices
      .map(
        (choice) =>
          `data: ${JSON.stringify({
            id: completionId,
            object: "chat.completion.chunk",
            created: 1,
            model: "qwen3.7-plus",
            choices: [{ index: 0, ...choice }],
          })}\n\n`
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } }
  );
}

function testLiveModel() {
  return createLiteLlmChatModel({
    profileId: "qwen3.7-plus",
    config: { baseUrl: "http://model.test/v1", apiKey: "test-only" },
  });
}

async function admitAndExecuteApproval(
  service: LangGraphRunService,
  input: Parameters<LangGraphRunService["beginResumeApproval"]>[0]
) {
  const admitted = await service.beginResumeApproval(input);
  const command = admitted.continuationCommand;
  if (!command && ["completed", "failed", "cancelled"].includes(admitted.status)) {
    return admitted;
  }
  if (!command || command.kind !== "approval") {
    throw new Error("Approval response did not create a durable continuation command");
  }
  await executeAdmittedContinuation(service, admitted, input, command.decision);
  return service.getSnapshot(input.runId)!;
}

async function admitAndExecuteUserInput(
  service: LangGraphRunService,
  input: Parameters<LangGraphRunService["beginResumeUserInput"]>[0]
) {
  const admitted = await service.beginResumeUserInput(input);
  const command = admitted.continuationCommand;
  if (!command && ["completed", "failed", "cancelled"].includes(admitted.status)) {
    return admitted;
  }
  if (!command || command.kind !== "user_input") {
    throw new Error("User-input response did not create a durable continuation command");
  }
  await executeAdmittedContinuation(service, admitted, input, {
    requestId: command.requestId,
    answers: command.answers,
  });
  return service.getSnapshot(input.runId)!;
}

async function executeAdmittedContinuation(
  service: LangGraphRunService,
  admitted: NonNullable<ReturnType<LangGraphRunService["getSnapshot"]>>,
  input: {
    runId: string;
    conversationId: string;
    projectId: string;
    actorId: string;
    sessionId: string;
    modelProfileId: string;
    model: unknown;
    domain: unknown;
    checkpointer: unknown;
  },
  resume: unknown
) {
  const command = admitted.continuationCommand;
  if (!command) throw new Error("Continuation command is missing");
  const runtime = service as unknown as {
    runGraphTurn(args: Record<string, unknown>): Promise<void>;
  };
  await runtime.runGraphTurn({
    input: {
      runId: input.runId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      message: "",
      modelProfileId: input.modelProfileId,
      projectKind: admitted.projectKind,
      workbenchMode: admitted.workbenchMode,
      workbenchContext: admitted.workbenchContext,
      permissionMode: admitted.permissionMode ?? "smart",
      skillMountSnapshot: admitted.skillMountSnapshot,
      model: input.model,
      domain: input.domain,
      checkpointer: input.checkpointer,
    },
    journal: admitted.journal,
    turnId: command.turnId,
    resume,
    signal: new AbortController().signal,
    continuationCommand: command,
  });
  // The production dispatcher supplies a continuation execution proof and
  // the Gateway clears the command with the checkpoint-backed boundary. This
  // local golden helper bypasses that transport layer, so mirror only that
  // postcondition before exercising exact-response replay assertions.
  const finished = service.getSnapshot(input.runId);
  if (finished && finished.status !== "running") {
    finished.continuationCommand = undefined;
  }
}

describe("LangGraph golden path: script → characters", () => {
  it("rejects a bare tool name instead of completing an unexecuted mobile request", async () => {
    const execute = vi.fn();
    const fetchMock = vi.fn(async () => streamedModelResponse("story_read"));
    globalThis.fetch = fetchMock;
    const result = await new LangGraphRunService().start({
      runId: crypto.randomUUID(),
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "story",
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "生成一个北京视频",
      modelProfileId: "qwen3.7-flash",
      workbenchMode: "story",
      workbenchContext: { chapterId: crypto.randomUUID(), experience: "mobile_h5" },
      skillMountSnapshot: emptySkillMountSnapshot("story", "story"),
      model: testLiveModel(),
      domain: { execute },
      checkpointer: new MemorySaver(),
      permissionMode: "full",
    });
    expect(result.status).toBe("failed");
    expect(result.journal.all().some((event) => event.type === "RunCompleted")).toBe(false);
    expect(
      result.journal.all().find((event) => event.type === "RunFailed")?.data.error
    ).toMatchObject({ code: "MODEL_TOOL_CALL_INVALID" });
    expect(execute).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["recovered", "exhausted", "length", "invalid_recovered", "invalid_exhausted"])(
    "handles %s model output without repeating a completed write",
    async (outcome) => {
      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls += 1;
        const delta =
          calls === 1
            ? {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "stored-once",
                    type: "function",
                    function: {
                      name: "script_store",
                      arguments: JSON.stringify({ text: "A courier crosses the city." }),
                    },
                  },
                ],
              }
            : {
                role: "assistant",
                content:
                  outcome.startsWith("invalid") && (calls === 2 || outcome === "invalid_exhausted")
                    ? "story_read"
                    : calls === 2
                      ? "I will read and"
                      : "The script is saved.",
              };
        const chunk = (value: unknown, finish: string | null) =>
          JSON.stringify({
            id: `model-${calls}`,
            object: "chat.completion.chunk",
            model: "qwen3.7-plus",
            created: 1,
            choices: [{ index: 0, delta: value, finish_reason: finish }],
          });
        const body =
          `data: ${chunk(delta, null)}\n\n` +
          (calls >= 2 && (outcome === "exhausted" || (calls === 2 && outcome === "recovered"))
            ? ""
            : `data: ${chunk({}, calls === 1 ? "tool_calls" : outcome === "length" ? "length" : "stop")}\n\n`) +
          "data: [DONE]\n\n";
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      });
      const execute = vi.fn(async () => ({
        ok: true as const,
        data: { attachmentId: ATTACHMENT, sectionCount: 1 },
      }));
      const result = await new LangGraphRunService().start({
        runId: crypto.randomUUID(),
        conversationId: CONVERSATION,
        projectId: PROJECT,
        projectKind: "story",
        actorId: "user-1",
        sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
        message: "Save this script",
        modelProfileId: "qwen3.7-plus",
        workbenchMode: "story",
        workbenchContext: { chapterId: crypto.randomUUID() },
        skillMountSnapshot: emptySkillMountSnapshot("story", "story"),
        model: createLiteLlmChatModel({
          profileId: "qwen3.7-plus",
          config: { baseUrl: "http://model.test/v1", apiKey: "test-only" },
        }),
        domain: { execute },
        checkpointer: new MemorySaver(),
        permissionMode: "full",
      });
      expect(calls).toBe(outcome === "length" ? 2 : 3);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(
        result.journal
          .all()
          .filter((event) => event.type === "MessageDelta")
          .map((event) => event.data.delta)
          .join("")
      ).not.toContain("story_read");
      if (outcome !== "recovered" && outcome !== "invalid_recovered") {
        expect(result.status).toBe("failed");
        expect(result.journal.all().some((event) => event.type === "RunCompleted")).toBe(false);
        expect(result.journal.all().some((event) => event.type === "RunFailed")).toBe(true);
        return;
      }
      expect(result.status).toBe("completed");
      expect(result.assistantText).toBe("The script is saved.");
      expect(
        result.journal
          .all()
          .filter((event) => event.type === "MessageCompleted")
          .map((event) => event.data)
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: "The script is saved.", finishReason: "stop" }),
          ...(outcome === "recovered"
            ? [
                expect.objectContaining({
                  text: "I will read and",
                  finishReason: "superseded",
                }),
              ]
            : []),
        ])
      );
    }
  );

  it("pauses for Agent-requested structured input and resumes the same run", async () => {
    let receiptPolls = 0;
    globalThis.fetch = vi.fn(async () => {
      receiptPolls += 1;
      return receiptPolls <= 4
        ? new Response(
            JSON.stringify({
              ok: false,
              code: "AGENT_OS_TOOL_EXECUTION_IN_FLIGHT",
              message: "the post-answer write is still committing",
              retryable: true,
            }),
            { status: 409, headers: { "content-type": "application/json" } }
          )
        : new Response(
            JSON.stringify({
              ok: true,
              data: {
                sectionCount: 1,
                attachmentId: "77777777-7777-4777-8777-777777777777",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
    });
    const domain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: "request_user_input",
          id: "tc-user-input",
          args: {
            leadIn: "Before I continue, choose the frame for this story.",
            resumeAcknowledgement: "Thanks — I have the frame and will continue.",
            formId: "creative_brief",
            questions: [
              {
                id: "aspect_ratio",
                header: "Aspect ratio",
                question: "Which frame should the story use?",
                options: [
                  { value: "portrait_9_16", label: "9:16 portrait" },
                  { value: "landscape_16_9", label: "16:9 landscape" },
                ],
              },
            ],
          },
        },
      ])
      .respondWithTools([
        {
          name: "script_store",
          id: "tc-store-after-input",
          args: { text: "A complete script supplied after the creative-profile answer." },
        },
      ])
      .respond(new AIMessage("I have the frame and can continue."));
    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();
    const chapterId = crypto.randomUUID();
    const sessionId = `agent-os:v1:conversation:${CONVERSATION}`;

    const paused = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "story",
      actorId: "user-1",
      sessionId,
      message: "Create an interactive film",
      modelProfileId: "qwen-plus",
      workbenchMode: "story",
      workbenchContext: { chapterId },
      skillMountSnapshot: emptySkillMountSnapshot("story", "story"),
      model,
      domain,
      checkpointer,
      permissionMode: "full",
    });

    expect(paused.status).toBe("waiting_for_input");
    expect(paused.pendingUserInput).toMatchObject({
      formId: "creative_brief",
      toolCallId: "tc-user-input",
    });
    expect(paused.journal.all().map((event) => event.type)).toContain("UserInputRequired");
    const requestId = paused.pendingUserInput!.requestId;
    const responseId = crypto.randomUUID();
    const pausedEvents = paused.journal.all();
    const requiredEventIndex = pausedEvents.findIndex(
      (event) => event.type === "UserInputRequired"
    );
    const leadInCompletedIndex = pausedEvents.findIndex(
      (event) =>
        event.type === "MessageCompleted" &&
        event.data.text === "Before I continue, choose the frame for this story."
    );
    expect(leadInCompletedIndex).toBeGreaterThanOrEqual(0);
    expect(leadInCompletedIndex).toBeLessThan(requiredEventIndex);
    const leadInCompletion = pausedEvents[leadInCompletedIndex]!;
    expect(
      pausedEvents.find(
        (event) =>
          event.type === "MessageStarted" &&
          event.data.messageId === leadInCompletion.data.messageId
      )?.data.segmentKind
    ).toBe("lead_in");

    const resumed = await admitAndExecuteUserInput(service, {
      runId,
      sessionId,
      conversationId: CONVERSATION,
      requestId,
      responseId,
      answers: { aspect_ratio: "landscape_16_9" },
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      projectKind: "story",
      workbenchMode: "story",
      workbenchContext: { chapterId },
      actorId: "user-1",
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.pendingUserInput).toBeUndefined();
    const resumedEvents = resumed.journal.all();
    const resumedTypes = resumedEvents.map((event) => event.type);
    const requiredIndex = resumedTypes.lastIndexOf("UserInputRequired");
    const answerIndex = resumedEvents.findIndex(
      (event) =>
        event.type === "UserMessage" &&
        (event.data.interaction as { kind?: string } | undefined)?.kind === "user_input"
    );
    const resolvedIndex = resumedTypes.lastIndexOf("UserInputResolved");
    const runResumedIndex = resumedTypes.lastIndexOf("RunResumed");
    expect(answerIndex).toBeGreaterThan(requiredIndex);
    expect(resolvedIndex).toBeGreaterThan(answerIndex);
    expect(runResumedIndex).toBeGreaterThan(resolvedIndex);
    const initialUserTurnId = resumedEvents.find(
      (event) => event.type === "UserMessage" && event.data.interaction === undefined
    )?.data.turnId;
    const answerTurnId = resumedEvents[answerIndex]?.data.turnId;
    expect(answerTurnId).not.toBe(initialUserTurnId);
    const acknowledgementIndex = resumedEvents.findIndex(
      (event, index) =>
        index > runResumedIndex &&
        event.type === "MessageCompleted" &&
        event.data.text === "Thanks — I have the frame and will continue."
    );
    expect(acknowledgementIndex).toBe(runResumedIndex + 3);
    expect(resumedEvents[runResumedIndex + 1]).toMatchObject({
      type: "MessageStarted",
      data: { turnId: answerTurnId, segmentKind: "acknowledgement" },
    });
    expect(resumedEvents[runResumedIndex + 2]).toMatchObject({
      type: "MessageDelta",
      data: {
        turnId: answerTurnId,
        delta: "Thanks — I have the frame and will continue.",
      },
    });
    expect(resumedEvents[answerIndex]?.data).toMatchObject({
      text: "Aspect ratio: 16:9 landscape",
      interaction: {
        kind: "user_input",
        requestId,
        responseId,
        answers: { aspect_ratio: "landscape_16_9" },
      },
    });
    expect(resumed.assistantText).toContain("continue");
    const startedIds = resumedEvents
      .filter((event) => event.type === "MessageStarted")
      .map((event) => event.data.messageId);
    const completedIds = resumedEvents
      .filter((event) => event.type === "MessageCompleted")
      .map((event) => event.data.messageId);
    expect(new Set(startedIds).size).toBe(startedIds.length);
    expect(completedIds).toEqual(startedIds);
    expect(
      resumedEvents.every(
        (event) => typeof event.data.turnId === "string" && event.data.turnId.length > 0
      )
    ).toBe(true);
    expect(
      resumedEvents.filter(
        (event) => event.type === "ToolCompleted" && event.data.toolId === "script.store"
      )
    ).toHaveLength(1);
    expect(
      resumedEvents.filter(
        (event) => event.type === "ToolFailed" && event.data.toolId === "script.store"
      )
    ).toHaveLength(0);
    expect(resumedTypes).not.toContain("RunFailed");
    expect(receiptPolls).toBe(5);

    const eventCount = resumedEvents.length;
    const retry = await admitAndExecuteUserInput(service, {
      runId,
      sessionId,
      conversationId: CONVERSATION,
      requestId,
      responseId,
      answers: { aspect_ratio: "landscape_16_9" },
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      projectKind: "story",
      workbenchMode: "story",
      workbenchContext: { chapterId },
      actorId: "user-1",
    });
    expect(retry.status).toBe("completed");
    expect(retry.journal.all()).toHaveLength(eventCount);
    await expect(
      admitAndExecuteUserInput(service, {
        runId,
        sessionId,
        conversationId: CONVERSATION,
        requestId,
        responseId,
        answers: { aspect_ratio: "portrait_9_16" },
        modelProfileId: "qwen-plus",
        model,
        domain,
        checkpointer,
        projectId: PROJECT,
        projectKind: "story",
        workbenchMode: "story",
        workbenchContext: { chapterId },
        actorId: "user-1",
      })
    ).rejects.toThrow(/different answers/);
  });

  it.each([false, true])("recovers Story handoff (retry=%s)", async (invalidFirst) => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    const startedMessage = "I’m preparing the screenplay for this chapter.";
    const completionMessage =
      "The screenplay is ready for your review. No image or video media has been generated; use Generate when you want to create media.";
    const replies = [
      ...(invalidFirst ? [streamedModelResponse("story_read")] : []),
      streamedModelResponse("", [{ name: "story_read", id: "tc-story-read", args: {} }]),
      streamedModelResponse("", [
        {
          name: "story_author",
          id: "tc-story-author",
          args: {
            title: "Night Watch",
            summary: "A guard chooses between duty and family.",
            brief: "Build a branching historical story.",
            continueThrough: "storyboard",
            startedMessage,
            completionMessage,
          },
        },
      ]),
    ];
    const fetchMock = vi.fn(async () => {
      const reply = replies.shift();
      if (!reply) throw new Error("The model must stop at the external-job handoff");
      return reply;
    });
    globalThis.fetch = fetchMock;
    const model = testLiveModel();
    const observedToolIds: string[] = [];
    const domain: DomainPort = {
      async execute(toolId, input, context) {
        observedToolIds.push(toolId);
        expect(context.turnId).toBeTruthy();
        if (toolId === "story.read") {
          return {
            ok: true,
            data: {
              chapterId: "00000000-0000-4000-8000-000000000001",
              draftRevision: 0,
              contentHash: "a".repeat(64),
              storyBible: {
                logline: "",
                synopsis: "",
                characters: [],
                stateVariables: [],
              },
              graph: { entryNodeId: null, nodes: [] },
              productionNotes: [],
              productionState: {
                projectId: PROJECT,
                chapterId: "00000000-0000-4000-8000-000000000001",
                profile: { status: "current" },
                script: { status: "missing", documentId: null, sequence: null },
                plotTree: { status: "missing", nodeCount: 0 },
                assets: { status: "missing", currentCount: 0 },
                storyboard: {
                  status: "missing",
                  sequenceCount: 0,
                  missingPlotNodeIds: [],
                },
                ready: false,
              },
              creativeProfile: {
                frameProfile: "landscape_16_9",
                durationPreset: "short_5_15",
                visualStyle: "cinematic-realism",
                storyLanguage: "en-US",
                confirmed: true,
              },
              authoringRun: null,
            },
          };
        }
        expect(toolId).toBe("story.author");
        expect(input).toMatchObject({ startedMessage, completionMessage });
        return {
          ok: true,
          data: {
            runId: jobId,
            status: "authoring",
            agentHandoff: { kind: "external_job", jobId, startedMessage },
          },
        };
      },
    };
    const service = new LangGraphRunService();
    const runId = crypto.randomUUID();
    const sessionId = `agent-os:v1:conversation:${CONVERSATION}`;
    const waiting = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "story",
      actorId: "user-1",
      sessionId,
      message: "Create the story",
      modelProfileId: "qwen-plus",
      workbenchMode: "story",
      workbenchContext: { chapterId: ATTACHMENT, experience: "mobile_h5" },
      skillMountSnapshot: emptySkillMountSnapshot("story", "story"),
      model,
      domain,
      checkpointer: new MemorySaver(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(invalidFirst ? 3 : 2);
    expect(observedToolIds).toEqual(["story.read", "story.author"]);
    expect(waiting.status).toBe("waiting_for_external");
    expect(waiting.pendingExternal).toMatchObject({
      kind: "external_job",
      jobId,
      toolCallId: "tc-story-author",
    });
    const waitingEvents = waiting.journal.all();
    const toolCompletedIndex = waitingEvents.findIndex(
      (event) => event.type === "ToolCompleted" && event.data.toolId === "story.author"
    );
    const receiptIndex = waitingEvents.findIndex(
      (event) => event.type === "MessageCompleted" && event.data.text === startedMessage
    );
    const pausedIndex = waitingEvents.findIndex(
      (event) => event.type === "RunPaused" && event.data.status === "waiting_for_external"
    );
    expect(toolCompletedIndex).toBeGreaterThanOrEqual(0);
    expect(receiptIndex).toBeGreaterThan(toolCompletedIndex);
    expect(pausedIndex).toBeGreaterThan(receiptIndex);
    expect(waitingEvents.some((event) => event.type === "RunCompleted")).toBe(false);
    expect(new Set(waitingEvents.map((event) => event.data.turnId)).size).toBe(1);
    const receipt = waitingEvents[receiptIndex]!;
    expect(
      waitingEvents.find(
        (event) =>
          event.type === "MessageStarted" && event.data.messageId === receipt.data.messageId
      )?.data.segmentKind
    ).toBe("acknowledgement");
  });

  it("interrupts on characters_upsert, then writes after approve", async () => {
    const store = new InMemoryStoryDomain();
    store.setScript("林黛玉与贾宝玉在贾府相遇。王熙凤协理宁国府。", 80);
    const receiptDomain = new HttpDomainPort({
      baseUrl: "http://gateway.test",
      internalToken: "internal-test-token",
    });
    let receiptPolls = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      receiptPolls += 1;
      if (receiptPolls <= 4) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: "AGENT_OS_TOOL_EXECUTION_IN_FLIGHT",
            message: "the approved write committed but its response is not durable yet",
            retryable: true,
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        );
      }
      const body = JSON.parse(String(init?.body)) as {
        runId: string;
        turnId: string;
        conversationId: string;
        projectId: string;
        actorId: string;
        skillResolutionId: string;
        skillVersionIds: string[];
        idempotencyKey: string;
        toolCallId: string;
        arguments: unknown;
      };
      const result = await store.execute("characters.upsert", body.arguments, body);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const domain: DomainPort = {
      async execute(toolId, input, context) {
        return toolId === "characters.upsert"
          ? receiptDomain.execute(toolId, input, context)
          : store.execute(toolId, input, context);
      },
    };

    const model = fakeModel()
      .respondWithTools([
        {
          name: "script_read_section",
          id: "tc-read",
          args: {
            attachmentId: ATTACHMENT,
            sectionIndex: 0,
            maxChars: 8000,
          },
        },
      ])
      .respondWithTools([
        {
          name: "characters_upsert",
          id: "tc-upsert",
          args: {
            baseRevision: 0,
            characters: [
              {
                id: "lin-daiyu",
                name: { "zh-CN": "林黛玉" },
                summary: "贾母外孙女。",
                intent: "create",
              },
              {
                id: "jia-baoyu",
                name: { "zh-CN": "贾宝玉" },
                summary: "荣国府公子。",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("已写入林黛玉、贾宝玉两个角色。"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const first = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "请根据剧本分析角色并写入项目",
      modelProfileId: "qwen-plus",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      model,
      domain,
      checkpointer,
      agentMode: "ASSIST",
      permissionMode: "smart",
    });

    expect(first.status).toBe("waiting_for_approval");
    expect(first.pendingApproval?.toolId).toBe("characters.upsert");
    // Workbench mode must survive HITL pause (resume remounts tools from this field).
    expect(first.workbenchMode).toBe("storyboard");
    expect(store.characters.size).toBe(0);
    expect(first.journal.all().map((e) => e.type)).toContain("ApprovalRequired");
    expect(
      first.journal.all().find((event) => event.type === "ApprovalRequired")?.data.actions
    ).toEqual(["approve", "reject"]);
    const approvalId = first.pendingApproval!.approvalId;

    const second = await admitAndExecuteApproval(service, {
      runId,
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      conversationId: CONVERSATION,
      approvalId,
      responseId: crypto.randomUUID(),
      decision: "approve",
      responseText: "Approved",
      locale: "en-US",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
    });

    expect(second.status).toBe("completed");
    expect(second.workbenchMode).toBe("storyboard");
    expect(store.characters.size).toBe(2);
    expect(store.characters.get("lin-daiyu")?.name["zh-CN"]).toBe("林黛玉");
    expect(second.assistantText).toMatch(/角色/);
    const secondEvents = second.journal.all();
    const secondTypes = secondEvents.map((e) => e.type);
    expect(secondTypes).toContain("RunCompleted");
    const approvalAnswerIndex = secondEvents.findIndex(
      (event) =>
        event.type === "UserMessage" &&
        (event.data.interaction as { kind?: string } | undefined)?.kind === "approval"
    );
    expect(approvalAnswerIndex).toBeGreaterThan(secondTypes.lastIndexOf("ApprovalRequired"));
    expect(secondTypes.lastIndexOf("ApprovalResolved")).toBeGreaterThan(approvalAnswerIndex);
    expect(secondTypes.lastIndexOf("RunResumed")).toBeGreaterThan(
      secondTypes.lastIndexOf("ApprovalResolved")
    );
    expect(secondEvents[approvalAnswerIndex]?.data).toMatchObject({
      text: "Approved",
      interaction: {
        kind: "approval",
        approvalId,
        decision: "approve",
      },
    });
    const approvalTurnId = secondEvents[approvalAnswerIndex]?.data.turnId;
    const acknowledgementStarted = secondEvents.find(
      (event) =>
        event.type === "MessageStarted" &&
        event.data.turnId === approvalTurnId &&
        event.data.segmentKind === "acknowledgement"
    );
    expect(acknowledgementStarted).toBeDefined();
    expect(
      secondEvents.find(
        (event) =>
          event.type === "MessageCompleted" &&
          event.data.turnId === approvalTurnId &&
          event.data.messageId === acknowledgementStarted?.data.messageId
      )?.data.text
    ).toBe("I have your approval and will continue with the action.");
    expect(secondEvents.find((event) => event.type === "ApprovalResolved")?.data.responseId).toBe(
      (secondEvents[approvalAnswerIndex]?.data.interaction as { responseId?: string }).responseId
    );
    // After approve, the write tool finishes and lands ToolCompleted in the journal.
    expect(
      secondEvents.filter(
        (event) => event.type === "ToolCompleted" && event.data.toolId === "characters.upsert"
      )
    ).toHaveLength(1);
    expect(
      secondEvents.filter(
        (event) => event.type === "ToolFailed" && event.data.toolId === "characters.upsert"
      )
    ).toHaveLength(0);
    expect(secondTypes).not.toContain("RunFailed");
    expect(receiptPolls).toBe(5);
  });

  it("preserves non-default workbench mode (brief) across HITL pause + approve", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("角色甲。", 80);

    const model = fakeModel()
      .respondWithTools([
        {
          name: "characters_upsert",
          id: "tc-1",
          args: {
            baseRevision: 0,
            characters: [
              {
                id: "role-a",
                name: { "zh-CN": "角色甲" },
                summary: "路人",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("已写入。"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();

    const paused = await service.start({
      runId,
      conversationId,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${conversationId}`,
      message: "写入角色",
      modelProfileId: "qwen-plus",
      workbenchMode: "brief",
      skillMountSnapshot: emptySkillMountSnapshot("brief"),
      model,
      domain,
      checkpointer,
      agentMode: "ASSIST",
      permissionMode: "smart",
    });

    expect(paused.status).toBe("waiting_for_approval");
    expect(paused.workbenchMode).toBe("brief");

    const done = await admitAndExecuteApproval(service, {
      runId,
      sessionId: `agent-os:v1:conversation:${conversationId}`,
      conversationId,
      approvalId: paused.pendingApproval!.approvalId,
      responseId: crypto.randomUUID(),
      decision: "approve",
      responseText: "Approved",
      locale: "en-US",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
    });

    expect(done.status).toBe("completed");
    expect(done.workbenchMode).toBe("brief");
    expect(domain.characters.size).toBe(1);
  });

  it("reject leaves database unchanged", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("角色甲。");

    const model = fakeModel()
      .respondWithTools([
        {
          name: "characters_upsert",
          id: "tc-1",
          args: {
            baseRevision: 0,
            characters: [
              {
                id: "role-a",
                name: { "zh-CN": "角色甲" },
                summary: "路人",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("好的，我不写入。"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const paused = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "写入角色",
      modelProfileId: "qwen-plus",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      model,
      domain,
      checkpointer,
    });

    expect(paused.status).toBe("waiting_for_approval");

    const rejected = await admitAndExecuteApproval(service, {
      runId,
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      conversationId: CONVERSATION,
      approvalId: paused.pendingApproval!.approvalId,
      responseId: crypto.randomUUID(),
      decision: "reject",
      responseText: "Rejected",
      locale: "en-US",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
    });

    // A rejection ANSWERS the pending tool call rather than abandoning it, so
    // the turn finishes normally and the model gets to acknowledge it. The
    // invariant that matters is unchanged: nothing was written.
    expect(rejected.status).toBe("completed");
    expect(domain.characters.size).toBe(0);
    const types = rejected.journal.all().map((e) => e.type);
    expect(types).toContain("ApprovalResolved");
    expect(types).toContain("ToolFailed");
    const failed = rejected.journal.all().find((e) => e.type === "ToolFailed");
    expect(failed?.data).toMatchObject({
      code: "APPROVAL_REJECTED",
      toolId: "characters.upsert",
    });

    // THE REGRESSION THIS FILE USED TO MISS: the durable thread must be clean
    // afterwards. A rejected tool call that never received a result stays in
    // the checkpoint forever, and every later turn replays a phantom pending
    // write to the model — which can then re-propose or claim it happened.
    const state = await checkpointer.get({
      configurable: { thread_id: CONVERSATION },
    });
    const messages = (state?.channel_values?.messages ?? []) as Array<{
      constructor: { name: string };
      tool_call_id?: string;
      tool_calls?: Array<{ id?: string }>;
    }>;
    const proposedCallIds = messages
      .flatMap((message) => message.tool_calls ?? [])
      .map((call) => call.id)
      .filter(Boolean);
    const answeredCallIds = new Set(
      messages.map((message) => message.tool_call_id).filter(Boolean)
    );
    expect(proposedCallIds.length).toBeGreaterThan(0);
    for (const callId of proposedCallIds) {
      expect(answeredCallIds.has(callId)).toBe(true);
    }
  });
  it("resumes a pending approval after the worker restarts", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("角色甲。");

    const model = fakeModel()
      .respondWithTools([
        {
          name: "characters_upsert",
          id: "tc-1",
          args: {
            baseRevision: 0,
            characters: [
              {
                id: "role-a",
                name: { "zh-CN": "角色甲" },
                summary: "路人",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("已写入。"));

    // The checkpointer is the only thing that survives a deploy.
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();
    const sessionId = `agent-os:v1:conversation:${CONVERSATION}`;

    const before = new LangGraphRunService();
    const paused = await before.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId,
      message: "写入角色",
      modelProfileId: "qwen-plus",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      model,
      domain,
      checkpointer,
    });
    expect(paused.status).toBe("waiting_for_approval");

    // A brand-new service instance: in-memory snapshots are gone, exactly as
    // after a pod restart. Approving used to throw "Unknown run".
    const after = new LangGraphRunService();
    const rehydrated = await after.rehydrateFromCheckpoint({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId,
      modelProfileId: "qwen-plus",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      model,
      domain,
      checkpointer,
    });
    expect(rehydrated).toBe(true);
    expect(after.getSnapshot(runId)?.pendingApproval?.toolId).toBe("characters.upsert");

    const resumed = await admitAndExecuteApproval(after, {
      runId,
      sessionId,
      conversationId: CONVERSATION,
      approvalId: after.getSnapshot(runId)!.pendingApproval!.approvalId,
      responseId: crypto.randomUUID(),
      decision: "approve",
      responseText: "Approved",
      locale: "en-US",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
    });

    expect(resumed.status).toBe("completed");
    expect(domain.characters.size).toBe(1);
  });

  it("reports no pending approval when the thread has none", async () => {
    const service = new LangGraphRunService();
    const rehydrated = await service.rehydrateFromCheckpoint({
      runId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      projectId: PROJECT,
      projectKind: "platform",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      actorId: "user-1",
      sessionId: "agent-os:v1:conversation:none",
      modelProfileId: "qwen-plus",
      model: fakeModel().respond(new AIMessage("hi")),
      domain: new InMemoryStoryDomain(),
      checkpointer: new MemorySaver(),
    });
    expect(rehydrated).toBe(false);
  });
  it("fails loudly when a turn proposes two writes at once", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("角色甲。");

    // What a provider that ignores parallel_tool_calls:false would send. Both
    // calls interrupt, and answering one used to re-run the tools node — the
    // approved write executing twice while the other hit a stale revision.
    const model = fakeModel()
      .respondWithTools([
        {
          name: "characters_upsert",
          id: "tc-1",
          args: {
            baseRevision: 0,
            characters: [{ id: "role-a", name: { "zh-CN": "甲" }, summary: "x", intent: "create" }],
          },
        },
        {
          name: "storyboard_upsertShots",
          id: "tc-2",
          args: {
            baseRevision: 0,
            shots: [{ id: "shot-a", title: "开场", intent: "create" }],
          },
        },
      ])
      .respond(new AIMessage("done"));

    const service = new LangGraphRunService();
    const runId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();

    const result = await service.start({
      runId,
      conversationId,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${conversationId}`,
      message: "提取角色并拆分镜",
      modelProfileId: "qwen-plus",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      model,
      domain,
      checkpointer: new MemorySaver(),
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/one write at a time/);
    // The invariant that matters: nothing was written behind the user's back.
    expect(domain.characters.size).toBe(0);
    expect(domain.shots.size).toBe(0);
  });
});

describe("LangGraph cancel", () => {
  it("cancel marks running run cancelled without writing tools", async () => {
    const domain = new InMemoryStoryDomain();
    // Never-resolving tool path is hard with fakeModel; cancel after start
    // while status is still running/queued from beginStart is enough.
    const model = fakeModel().respond(new AIMessage("still thinking…"));
    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const begun = await service.beginStart({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "hello",
      modelMessage: "hello\n\n[Attachment context: internal-only]",
      modelProfileId: "qwen-plus",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      model,
      domain,
      checkpointer,
    });
    expect(begun.status).toBe("running");

    const cancelled = await service.cancel(runId, "Stopped");
    expect(cancelled?.status).toBe("cancelled");
    expect(service.getSnapshot(runId)?.status).toBe("cancelled");
    expect(cancelled?.journal.all().map((e) => e.type)).toContain("RunCancelled");
    expect(cancelled?.journal.all().find((event) => event.type === "UserMessage")?.data.text).toBe(
      "hello"
    );

    // Idempotent: already terminal stays cancelled
    const again = await service.cancel(runId);
    expect(again?.status).toBe("cancelled");
  });
});

describe("LangGraph golden path: script → storyboard shots", () => {
  it("interrupts on storyboard_upsert_shots, then writes after approve", async () => {
    const domain = new InMemoryStoryDomain();
    domain.setScript("夜雨中，林黛玉撑伞走过曲径。贾宝玉立于廊下。", 80);

    const model = fakeModel()
      .respondWithTools([
        {
          // LangChain names use `_` for `.` only — keep camelCase segments.
          name: "storyboard_listShots",
          id: "tc-list",
          args: {},
        },
      ])
      .respondWithTools([
        {
          name: "storyboard_upsertShots",
          id: "tc-shots",
          args: {
            baseRevision: 0,
            shots: [
              {
                id: "shot-01",
                title: "夜雨曲径",
                prompt: "Wide shot, rain, figure with umbrella on stone path",
                notes: "cold palette",
                intent: "create",
              },
              {
                id: "shot-02",
                title: "廊下对望",
                prompt: "Medium shot, young man under porch watching rain",
                intent: "create",
              },
            ],
          },
        },
      ])
      .respond(new AIMessage("已写入两个分镜镜头。"));

    const service = new LangGraphRunService();
    const checkpointer = new MemorySaver();
    const runId = crypto.randomUUID();

    const first = await service.start({
      runId,
      conversationId: CONVERSATION,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      message: "把剧本拆成 storyboard shots 并写入",
      modelProfileId: "qwen-plus",
      workbenchMode: "storyboard",
      skillMountSnapshot: emptySkillMountSnapshot("storyboard"),
      model,
      domain,
      checkpointer,
    });

    expect(first.status).toBe("waiting_for_approval");
    expect(first.pendingApproval?.toolId).toBe("storyboard.upsertShots");
    expect(domain.shots.size).toBe(0);

    const second = await admitAndExecuteApproval(service, {
      runId,
      sessionId: `agent-os:v1:conversation:${CONVERSATION}`,
      conversationId: CONVERSATION,
      approvalId: first.pendingApproval!.approvalId,
      responseId: crypto.randomUUID(),
      decision: "approve",
      responseText: "Approved",
      locale: "en-US",
      modelProfileId: "qwen-plus",
      model,
      domain,
      checkpointer,
      projectId: PROJECT,
      projectKind: "platform",
      actorId: "user-1",
    });

    expect(second.status).toBe("completed");
    expect(domain.shots.size).toBe(2);
    expect(domain.shots.get("shot-01")?.title).toBe("夜雨曲径");
  });
});
