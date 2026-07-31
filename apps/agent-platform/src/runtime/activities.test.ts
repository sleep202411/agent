import { ApplicationFailure } from "@temporalio/activity";
import { MockActivityEnvironment } from "@temporalio/testing";
import { ErrorCode } from "@ably/ai-transport";
import Ably from "ably";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import type * as AblyVercelTransport from "@ably/ai-transport/vercel";

import type * as AblySessionModule from "./ably-session.js";

import type { AgentSessionContext } from "../context/agent-context.js";
import {
  attributeMessagesToRun,
  classifySuspendedInference,
  causalAttachmentIds,
  collectCanonicalMessagesForRun,
  collectResponseMessagesForRun,
  mergeMessagesById,
  openRunActivity,
  recoverTerminalInferenceResult,
  runInferenceActivity,
  selectCausalMessages,
} from "./activities.js";
import type { RuntimeDependencies } from "./dependencies.js";

let runtimeDependencies: RuntimeDependencies;
let agentSession: {
  createRun?: (...args: ReadonlyArray<unknown>) => unknown;
  adoptRun?: (...args: ReadonlyArray<unknown>) => unknown;
  detach: () => Promise<void>;
  tree?: unknown;
};
let lastAgentSessionOptions: { historyPageSize?: number } | undefined;

vi.mock("./dependencies.js", () => ({
  getRuntimeDependencies: () => runtimeDependencies,
}));
vi.mock("./ably-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AblySessionModule>()),
  acquireAgentAblyClient: () => ({}),
  connectAgentSession: async () => undefined,
  releaseAgentSession: async () => undefined,
}));
vi.mock("@ably/ai-transport/vercel", async (importOriginal) => ({
  ...(await importOriginal<typeof AblyVercelTransport>()),
  createAgentSession: (options: { historyPageSize?: number }) => {
    lastAgentSessionOptions = options;
    return agentSession;
  },
  // The single-writer test drives a full model step; only pipeResult
  // classification matters to it, not the transport's stream mechanics.
  vercelRunOutcome: async (pipeResult: { reason: string }, finishReason: Promise<unknown>) => {
    await finishReason.catch(() => undefined);
    return { reason: pipeResult.reason };
  },
}));
vi.mock("@mastra/ai-sdk", () => ({
  toAISdkStream: () =>
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
}));

const conversationId = "00000000-0000-4000-8000-000000000001";
const context: AgentSessionContext = {
  actorId: "42",
  actorDisplayName: "Test creator",
  conversationId,
  surface: "story-studio",
  scope: {
    kind: "story-project",
    workspaceId: "workspace-1",
    projectId: "project-1",
  },
  sessionName: `agent:v1:conversation:${conversationId}`,
  permissionMode: "smart",
  locale: "en-US",
  roles: ["creator"],
  permissions: [],
  traceId: "trace-1",
};

const input = {
  ids: {
    runId: "00000000-0000-4000-8000-000000000010",
    invocationId: "00000000-0000-4000-8000-000000000020",
    triggerEventId: "event-1",
  },
  context,
};

describe("attributeMessagesToRun", () => {
  it("persists exact durable identity without discarding provider metadata", () => {
    const [message] = attributeMessagesToRun(
      [
        {
          id: "message-1",
          role: "assistant",
          metadata: { provider: "google" },
          parts: [{ type: "text", text: "Hello." }],
        },
      ],
      input
    );

    expect(message?.metadata).toEqual({
      provider: "google",
      conversationId: input.context.conversationId,
      runId: input.ids.runId,
    });
  });

  it("fails loud instead of moving a message between durable runs", () => {
    expect(() =>
      attributeMessagesToRun(
        [
          {
            id: "message-1",
            role: "assistant",
            metadata: { runId: "00000000-0000-4000-8000-000000000099" },
            parts: [{ type: "text", text: "Hello." }],
          },
        ],
        input
      )
    ).toThrow(ApplicationFailure);
  });
});

describe("collectCanonicalMessagesForRun", () => {
  it("keeps the new run input and excludes unchanged messages from the preceding run", async () => {
    const previousRun = {
      id: "previous-answer",
      role: "assistant" as const,
      metadata: {
        conversationId: input.context.conversationId,
        runId: "00000000-0000-4000-8000-000000000099",
      },
      parts: [{ type: "text" as const, text: "Earlier answer." }],
    };
    const currentInput = {
      id: "current-user",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Hello again." }],
    };

    await expect(
      collectCanonicalMessagesForRun([previousRun, currentInput], input, async () => [currentInput])
    ).resolves.toEqual({
      messages: [
        {
          ...currentInput,
          metadata: {
            conversationId: input.context.conversationId,
            runId: input.ids.runId,
          },
        },
      ],
      changedMessages: [
        {
          ...currentInput,
          metadata: {
            conversationId: input.context.conversationId,
            runId: input.ids.runId,
          },
        },
      ],
    });
  });

  it("retains an unchanged current-run message during Activity retry", async () => {
    const currentInput = {
      id: "current-user",
      role: "user" as const,
      metadata: {
        conversationId: input.context.conversationId,
        runId: input.ids.runId,
      },
      parts: [{ type: "text" as const, text: "Retry this turn." }],
    };

    await expect(
      collectCanonicalMessagesForRun([currentInput], input, async () => [])
    ).resolves.toEqual({
      messages: [currentInput],
      changedMessages: [],
    });
  });

  it("does not adopt an unchanged legacy history row whose transport replay omitted ownership", async () => {
    const historicalReplay = {
      id: "previous-user",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "First run input." }],
    };
    const secondRunInput = {
      id: "second-user",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Second run input." }],
    };

    await expect(
      collectCanonicalMessagesForRun([historicalReplay, secondRunInput], input, async () => [
        secondRunInput,
      ])
    ).resolves.toEqual({
      messages: [
        {
          ...secondRunInput,
          metadata: {
            conversationId: input.context.conversationId,
            runId: input.ids.runId,
          },
        },
      ],
      changedMessages: [
        {
          ...secondRunInput,
          metadata: {
            conversationId: input.context.conversationId,
            runId: input.ids.runId,
          },
        },
      ],
    });
  });

  it("excludes replayed content attributed to another run even when reconciliation reports it changed", async () => {
    // An Ably replay carries no part timestamps, so reconciliation compares it
    // against a stored row that has them and reports a change that never
    // happened. Only durable run identity can decide ownership here.
    const previousRunReplay = {
      id: "previous-answer",
      role: "assistant" as const,
      metadata: {
        conversationId: input.context.conversationId,
        runId: "00000000-0000-4000-8000-000000000099",
      },
      parts: [{ type: "text" as const, text: "Earlier answer." }],
    };
    const currentInput = {
      id: "current-user",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Hello again." }],
    };

    await expect(
      collectCanonicalMessagesForRun([previousRunReplay, currentInput], input, async (messages) => [
        ...messages,
      ])
    ).resolves.toEqual({
      messages: [
        {
          ...currentInput,
          metadata: {
            conversationId: input.context.conversationId,
            runId: input.ids.runId,
          },
        },
      ],
      changedMessages: [
        {
          ...currentInput,
          metadata: {
            conversationId: input.context.conversationId,
            runId: input.ids.runId,
          },
        },
      ],
    });
  });

  it("fails loud when unchanged history claims another conversation", async () => {
    const foreignConversation = {
      id: "foreign-answer",
      role: "assistant" as const,
      metadata: {
        conversationId: "00000000-0000-4000-8000-000000000099",
        runId: "00000000-0000-4000-8000-000000000098",
      },
      parts: [{ type: "text" as const, text: "Foreign answer." }],
    };

    await expect(
      collectCanonicalMessagesForRun([foreignConversation], input, async () => [])
    ).rejects.toThrow(ApplicationFailure);
  });
});

describe("causal model input", () => {
  it("keeps the originating user input beside a changed tool continuation", () => {
    const user = {
      id: "current-user",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Analyse this script." }],
    };
    const toolResult = {
      id: "tool-result",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Snapshot loaded." }],
    };

    expect(selectCausalMessages([user, toolResult], [toolResult])).toEqual([user, toolResult]);
  });

  it("extracts only stable FizzDragon attachment identities", () => {
    expect(
      causalAttachmentIds([
        {
          id: "current-user",
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "text/markdown",
              filename: "script.md",
              url: "fizzdragon-media://0197f4a2-0800-7000-8000-000000000009",
            },
            {
              type: "file",
              mediaType: "image/png",
              url: "https://example.com/untrusted.png",
            },
          ],
        },
      ])
    ).toEqual(["0197f4a2-0800-7000-8000-000000000009"]);
  });
});

describe("collectResponseMessagesForRun", () => {
  it("keeps the current response and excludes an unchanged historical response boundary", async () => {
    const historical = {
      id: "historical-assistant",
      role: "assistant" as const,
      metadata: {
        runId: "00000000-0000-4000-8000-000000000099",
        mastra: { responseBoundary: true },
      },
      parts: [{ type: "text" as const, text: "Earlier answer." }],
    };
    const current = {
      id: "current-assistant",
      role: "assistant" as const,
      metadata: {
        runId: input.ids.runId,
        provider: "google",
        mastra: { responseBoundary: true },
      },
      parts: [{ type: "text" as const, text: "Current answer." }],
    };

    await expect(
      collectResponseMessagesForRun([historical, current], input, async () => [])
    ).resolves.toEqual([
      {
        ...current,
        metadata: {
          provider: "google",
          conversationId: input.context.conversationId,
          runId: input.ids.runId,
        },
      },
    ]);
  });

  it("excludes a prior run's replayed response even when reconciliation reports it changed", async () => {
    // Observational Memory replays the previous run's response boundary beside
    // the current one, and a Mastra message-list round trip re-stamps volatile
    // framework timestamps, so reconciliation reports that untouched row as
    // changed. Durable run identity, not the storage delta, decides ownership;
    // treating the delta as the witness killed a real user turn.
    const historical = {
      id: "5fbbcab4-2362-435e-a419-99004ea5815d",
      role: "assistant" as const,
      metadata: {
        conversationId: input.context.conversationId,
        runId: "00000000-0000-4000-8000-000000000099",
        mastra: { responseBoundary: true },
      },
      parts: [{ type: "text" as const, text: "你好！" }],
    };
    const current = {
      id: "current-assistant",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Current answer." }],
    };

    await expect(
      collectResponseMessagesForRun([historical, current], input, async (messages) => [...messages])
    ).resolves.toEqual([
      {
        ...current,
        metadata: {
          conversationId: input.context.conversationId,
          runId: input.ids.runId,
        },
      },
    ]);
  });

  it("fails loud when a response claims another conversation", async () => {
    const foreignConversation = {
      id: "foreign-assistant",
      role: "assistant" as const,
      metadata: {
        conversationId: "00000000-0000-4000-8000-000000000099",
        runId: "00000000-0000-4000-8000-000000000098",
      },
      parts: [{ type: "text" as const, text: "Foreign answer." }],
    };

    await expect(
      collectResponseMessagesForRun([foreignConversation], input, async () => [])
    ).rejects.toThrow(ApplicationFailure);
  });

  it("attributes a genuinely new response that has not yet received run metadata", async () => {
    const current = {
      id: "current-assistant",
      role: "assistant" as const,
      metadata: { provider: "google" },
      parts: [{ type: "text" as const, text: "Current answer." }],
    };

    await expect(
      collectResponseMessagesForRun([current], input, async (messages) => [...messages])
    ).resolves.toEqual([
      {
        ...current,
        metadata: {
          provider: "google",
          conversationId: input.context.conversationId,
          runId: input.ids.runId,
        },
      },
    ]);
  });
});

describe("suspended inference classification", () => {
  it("uses the settled response as authority when the live Ably read-model is stale", () => {
    const staleMessages = [
      {
        id: "user-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Read the current story." }],
      },
    ];
    const settledResponse = [
      {
        id: "assistant-tool",
        role: "assistant" as const,
        parts: [
          {
            type: "dynamic-tool" as const,
            toolName: "story_get_snapshot",
            toolCallId: "call-read",
            state: "input-available" as const,
            input: { schemaVersion: "story-read/v2" },
          },
        ],
      },
    ];
    const authoritative = mergeMessagesById(staleMessages, settledResponse);

    expect(
      classifySuspendedInference(authoritative, {
        approvalToolCallIds: new Set(),
        runtimeSuspensionToolCallIds: new Set(),
      })
    ).toEqual({
      kind: "tool-calls",
      toolCalls: [
        {
          toolCallId: "call-read",
          toolName: "story_get_snapshot",
          input: { schemaVersion: "story-read/v2" },
        },
      ],
    });
  });

  it("never turns an unclassified tool finish into an approval wait", () => {
    expect(
      classifySuspendedInference(
        [
          {
            id: "assistant-empty",
            role: "assistant",
            parts: [{ type: "text", text: "I will check." }],
          },
        ],
        {
          approvalToolCallIds: new Set(),
          runtimeSuspensionToolCallIds: new Set(),
        }
      )
    ).toEqual({ kind: "inconsistent" });
  });

  it("distinguishes pre-execution approval from an executable tool call", () => {
    expect(
      classifySuspendedInference(
        [
          {
            id: "assistant-approval",
            role: "assistant",
            parts: [
              {
                type: "dynamic-tool",
                toolName: "story_apply_change_set",
                toolCallId: "call-write",
                state: "approval-requested",
                input: {},
                approval: { id: "approval-1" },
              },
            ],
          },
        ],
        {
          approvalToolCallIds: new Set(["call-write"]),
          runtimeSuspensionToolCallIds: new Set(),
        }
      )
    ).toEqual({
      kind: "awaiting-approval",
      toolCallIds: ["call-write"],
    });
  });

  it("fails closed on runtime suspension instead of mislabelling it as approval", () => {
    expect(
      classifySuspendedInference([], {
        approvalToolCallIds: new Set(),
        runtimeSuspensionToolCallIds: new Set(["call-ask"]),
      })
    ).toEqual({
      kind: "runtime-suspension",
      toolCallIds: ["call-ask"],
    });
  });

  it("lets a runtime suspension dominate mixed parallel tool output", () => {
    expect(
      classifySuspendedInference(
        [
          {
            id: "assistant-mixed",
            role: "assistant",
            parts: [
              {
                type: "dynamic-tool",
                toolName: "story_get_snapshot",
                toolCallId: "call-read",
                state: "input-available",
                input: {},
              },
            ],
          },
        ],
        {
          approvalToolCallIds: new Set(),
          runtimeSuspensionToolCallIds: new Set(["call-ask"]),
        }
      )
    ).toEqual({
      kind: "runtime-suspension",
      toolCallIds: ["call-ask"],
    });
  });
});

/**
 * Adopts an Ably run whose replayed messages are exactly `messages`, with a
 * durable memory that has never seen any of them.
 */
function adoptRunWith(messages: ReadonlyArray<UIMessage>) {
  const run = {
    runId: input.ids.runId,
    status: "active",
    abortSignal: new AbortController().signal,
    located: Promise.resolve(),
    view: {
      hasOlder: () => false,
      loadOlder: vi.fn(async () => []),
    },
    messages,
    load: vi.fn(async () => undefined),
    hasInput: vi.fn(() => false),
    end: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    createStep: vi.fn(),
  };
  const persisted: UIMessage[] = [];
  runtimeDependencies = {
    config: { ablyApiKey: "test-key" },
    agent: { stream: vi.fn() },
    agentMemory: {
      reconcileRunMessages: async (candidates: ReadonlyArray<UIMessage>) => [...candidates],
      persistRunMessages: async (candidates: ReadonlyArray<UIMessage>) => {
        persisted.push(...candidates);
      },
    },
  } as unknown as RuntimeDependencies;
  agentSession = {
    adoptRun: () => run,
    detach: async () => undefined,
    tree: {
      getRunNode: () => undefined,
      getNodeByCodecMessageId: () => undefined,
    },
  };
  return { run, persisted };
}

const replayedUserInput: UIMessage = {
  id: "current-user",
  role: "user",
  parts: [{ type: "text", text: "Break this screenplay down." }],
};

const activityInput = { ...input, sessionName: context.sessionName };

describe("runInferenceActivity completion contract", () => {
  it("refuses to report a turn complete when a failed attempt left a content-free assistant message", async () => {
    // The transport opens the assistant message when the model step starts, so
    // an attempt that dies mid-stream replays as an assistant turn with no
    // parts. Durable memory drops that shell on save, so completing here would
    // report success for a turn the conversation never shows an answer for.
    const { run, persisted } = adoptRunWith([
      replayedUserInput,
      {
        id: "assistant-shell",
        role: "assistant",
        metadata: {
          conversationId: input.context.conversationId,
          runId: input.ids.runId,
        },
        parts: [],
      },
    ]);

    const attempt = new MockActivityEnvironment().run(runInferenceActivity, activityInput);

    // Retryable: an empty step is transient, so the Activity's attempt budget
    // gets to try again before a creator is told the turn failed. What must not
    // happen is the empty run being reported as a success, which is what this
    // guard replaced.
    await expect(attempt).rejects.toMatchObject({
      type: "AGENT_INFERENCE_OUTPUT_MISSING",
      nonRetryable: false,
      details: [{ publicError: { retryable: true } }],
    });
    await expect(attempt).rejects.not.toMatchObject({
      details: [{ publicError: { messageKey: "agent.error.response_failed" } }],
    });
    await expect(attempt).rejects.toBeInstanceOf(ApplicationFailure);
    expect(run.end).not.toHaveBeenCalled();
    expect(persisted).toEqual([]);
  });

  it("replays an already-answered turn as complete without another provider call", async () => {
    const { run } = adoptRunWith([
      replayedUserInput,
      {
        id: "assistant-answer",
        role: "assistant",
        metadata: {
          conversationId: input.context.conversationId,
          runId: input.ids.runId,
        },
        parts: [
          { type: "step-start" },
          { type: "text", text: "Here is the structural breakdown." },
        ],
      },
    ]);

    await expect(
      new MockActivityEnvironment().run(runInferenceActivity, activityInput)
    ).resolves.toEqual({ kind: "complete" });
    expect(run.end).toHaveBeenCalledWith({ reason: "complete" });
    expect(runtimeDependencies.agent.stream).not.toHaveBeenCalled();
  });
});

describe("terminal inference retry recovery", () => {
  const terminalLoadError = new Ably.ErrorInfo(
    "Run is already terminal",
    ErrorCode.InvalidArgument,
    400
  );

  it("returns the already-complete outcome without another provider call", () => {
    expect(recoverTerminalInferenceResult(terminalLoadError, "complete")).toEqual({
      kind: "complete",
    });
  });

  it("returns the already-cancelled outcome without another provider call", () => {
    expect(recoverTerminalInferenceResult(terminalLoadError, "cancelled")).toEqual({
      kind: "cancelled",
    });
  });

  it("fails closed for an already-failed run", () => {
    expect(() => recoverTerminalInferenceResult(terminalLoadError, "error")).toThrow(
      ApplicationFailure
    );
  });

  it("does not reinterpret unrelated load failures", () => {
    expect(recoverTerminalInferenceResult(new Error("network"), "complete")).toBeUndefined();
  });
});

/**
 * Opens a run through openRunActivity against a scripted history fake.
 *
 * The fake mirrors the installed dist's fold semantics at the contract level:
 * `loadOlder` is the sole page-fetch driver, folding is what advances the tree
 * and settles `located` (a promise chain, so the caller observes it only after
 * microtasks run), and reveal quotas never gate what the tree has folded.
 */
function openableRunWith(options: {
  provisionalRunId: string;
  locate: (foldedPages: number) => boolean;
  hasOlderAt?: (foldedPages: number) => boolean;
  adoptedRunId?: string;
  boundaryPages?: number;
  messagesAt?: (foldedPages: number) => UIMessage[];
}) {
  let foldedPages = 0;
  let runId = options.provisionalRunId;
  let resolveLocated: () => void = () => undefined;
  const located = new Promise<void>((resolve) => {
    resolveLocated = resolve;
  });
  if (options.locate(0)) resolveLocated();
  const fold = () => {
    foldedPages += 1;
    if (options.locate(foldedPages)) {
      if (options.adoptedRunId) runId = options.adoptedRunId;
      resolveLocated();
    }
  };
  const boundaryFolded = () => foldedPages >= (options.boundaryPages ?? 0);
  const view = {
    hasOlder: vi.fn(() => options.hasOlderAt?.(foldedPages) ?? true),
    loadOlder: vi.fn(async () => {
      fold();
      return [];
    }),
  };
  const run = {
    get runId() {
      return runId;
    },
    invocationId: "transport-invocation-1",
    status: "active",
    abortSignal: new AbortController().signal,
    located,
    view,
    get messages() {
      return options.messagesAt?.(foldedPages) ?? [];
    },
    start: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
  };
  const tree = {
    getRunNode: (lookupRunId: string) => {
      if (!options.adoptedRunId || lookupRunId !== options.adoptedRunId) return undefined;
      if (foldedPages < 1) return undefined;
      return { startSerial: "serial-1", parentCodecMessageId: "prompt-0" };
    },
    getNodeByCodecMessageId: (codecMessageId: string) =>
      codecMessageId === "prompt-0" && boundaryFolded() ? { kind: "input" } : undefined,
  };
  runtimeDependencies = {
    config: { ablyApiKey: "test-key" },
  } as unknown as RuntimeDependencies;
  agentSession = { createRun: () => run, detach: async () => undefined, tree };
  return { run, view };
}

const openInput = {
  invocation: { inputEventId: "input-event-1", sessionName: context.sessionName },
  invocationId: "transport-invocation-1",
  provisionalRunId: "00000000-0000-4000-8000-000000000010",
};

describe("bounded run location contract", () => {
  it("locates the trigger with single-page reveals instead of a deep reveal quota", async () => {
    // Folding — which is what locates the trigger — happens one full history
    // page per fetch regardless of the reveal quota, so the smallest quota
    // drives the fewest page fetches. The old quota of 50 forced the hydrator
    // to keep fetching pages long after the trigger had already folded on the
    // first one (~+750ms measured on a live 195-wire conversation channel).
    const { view } = openableRunWith({
      provisionalRunId: openInput.provisionalRunId,
      locate: (foldedPages) => foldedPages >= 1,
    });

    const opened = await new MockActivityEnvironment().run(openRunActivity, openInput);

    expect(opened).toMatchObject({ kind: "opened" });
    expect(view.loadOlder.mock.calls).toEqual([[1]]);
  });

  it("skips paging entirely when the trigger already folded before location starts", async () => {
    // A live trigger arrival during connect settles `located` before the
    // locate loop runs. The settled state is only observable after a microtask
    // turn, so the loop must yield before its first hasOlder() pass instead of
    // paying a page fetch to learn what it already knew.
    const { view } = openableRunWith({
      provisionalRunId: openInput.provisionalRunId,
      locate: () => true,
    });

    const opened = await new MockActivityEnvironment().run(openRunActivity, openInput);

    expect(opened).toMatchObject({ kind: "opened" });
    expect(view.loadOlder).not.toHaveBeenCalled();
  });

  it("hydrates an adopted suspended run to its boundary before reading approvals", async () => {
    // An approval continuation rebinds the provisional run to the suspended
    // Run named by the trigger. The assistant message carrying the pending
    // tool-call parts can sit arbitrarily many wires below the trigger, so the
    // fold must be driven to the Run's own boundary (its parent input node) —
    // a fixed page or reveal count silently drops the approved tool calls.
    const adoptedRunId = "00000000-0000-4000-8000-000000000077";
    const approvedToolCallMessage: UIMessage = {
      id: "assistant-approval",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "story_apply_change_set",
          toolCallId: "call-write",
          state: "approval-responded",
          input: { schemaVersion: "story-write/v2" },
          approval: { id: "approval-1", approved: true },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const { view } = openableRunWith({
      provisionalRunId: openInput.provisionalRunId,
      locate: (foldedPages) => foldedPages >= 1,
      adoptedRunId,
      boundaryPages: 3,
      messagesAt: (foldedPages) => (foldedPages >= 3 ? [approvedToolCallMessage] : []),
    });

    const opened = await new MockActivityEnvironment().run(openRunActivity, openInput);

    expect(opened).toMatchObject({
      kind: "opened",
      ids: { runId: adoptedRunId },
      approvedToolCalls: [
        {
          toolCallId: "call-write",
          toolName: "story_apply_change_set",
          input: { schemaVersion: "story-write/v2" },
        },
      ],
    });
    expect(view.loadOlder).toHaveBeenCalledTimes(3);
  });

  it("keeps the worker's history fetch unit small instead of the client-sized default", async () => {
    // The default 100-wire page is a client-rendering over-provision. The
    // worker needs only the newest few wires on its hot path (trigger + run
    // lifecycle), and every deeper need is driven explicitly to its boundary,
    // so a quarter-size page cuts the dominant fetch payload without a
    // correctness cost. Payload, not RTT, is what made ably.run.load grow with
    // conversation length.
    openableRunWith({
      provisionalRunId: openInput.provisionalRunId,
      locate: (foldedPages) => foldedPages >= 1,
    });

    await new MockActivityEnvironment().run(openRunActivity, openInput);

    expect(lastAgentSessionOptions?.historyPageSize).toBe(25);
  });
});

describe("bounded run adoption contract", () => {
  it("primes the adopted fold before load() so it cannot over-page", async () => {
    // AdoptedRun.load()'s fold predicate needs both the run-start fold and the
    // settled `located` chain, but the dist's fold loop checks the predicate
    // synchronously after each page — before the microtask that settles
    // `located` can run — so once the channel exceeds one history page, load()
    // always fetches one full wasted page. Pre-folding through the view first
    // lets load() take its already-observed fast path.
    const { run } = adoptRunWith([
      replayedUserInput,
      {
        id: "assistant-answer",
        role: "assistant",
        metadata: {
          conversationId: input.context.conversationId,
          runId: input.ids.runId,
        },
        parts: [{ type: "step-start" }, { type: "text", text: "Answered." }],
      },
    ]);
    let foldedPages = 0;
    run.view.hasOlder = () => foldedPages === 0;
    (run.view.loadOlder as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      foldedPages += 1;
      return [];
    });
    (agentSession.tree as { getRunNode: unknown }).getRunNode = () =>
      foldedPages >= 1 ? { startSerial: "serial-1", parentCodecMessageId: undefined } : undefined;

    await expect(
      new MockActivityEnvironment().run(runInferenceActivity, activityInput)
    ).resolves.toEqual({ kind: "complete" });

    expect(run.view.loadOlder).toHaveBeenCalledWith(1);
    expect(
      (run.view.loadOlder as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    ).toBeLessThan(
      (run.load as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it("hydrates a continuation to its run boundary before collecting canonical messages", async () => {
    // A continuation's fresh run-start satisfies load()'s fold predicate on the
    // newest page, but the suspended turn's assistant tool-call message lies
    // deeper. Without driving the fold to the run's parent input node, the
    // canonical collection sees an empty run and kills the turn.
    const pendingToolCallMessage: UIMessage = {
      id: "assistant-tool",
      role: "assistant",
      metadata: {
        conversationId: input.context.conversationId,
        runId: input.ids.runId,
      },
      parts: [
        {
          type: "dynamic-tool",
          toolName: "story_get_snapshot",
          toolCallId: "call-read",
          state: "input-available",
          input: { schemaVersion: "story-read/v2" },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const { run } = adoptRunWith([]);
    let boundaryFolded = false;
    Object.defineProperty(run, "messages", {
      get: () => (boundaryFolded ? [replayedUserInput, pendingToolCallMessage] : []),
    });
    run.view.hasOlder = () => !boundaryFolded;
    (run.view.loadOlder as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      boundaryFolded = true;
      return [];
    });
    agentSession.tree = {
      getRunNode: () => ({ startSerial: "serial-1", parentCodecMessageId: "prompt-0" }),
      getNodeByCodecMessageId: (codecMessageId: string) =>
        codecMessageId === "prompt-0" && boundaryFolded ? { kind: "input" } : undefined,
    };

    await expect(
      new MockActivityEnvironment().run(runInferenceActivity, activityInput)
    ).resolves.toEqual({
      kind: "tool-calls",
      toolCalls: [
        {
          toolCallId: "call-read",
          toolName: "story_get_snapshot",
          input: { schemaVersion: "story-read/v2" },
        },
      ],
    });
    expect(run.view.loadOlder).toHaveBeenCalled();
  });
});

describe("interactive thinking budget contract", () => {
  async function streamOnceWith(messages: ReadonlyArray<UIMessage>) {
    const { run } = adoptRunWith(messages);
    const step = {
      start: vi.fn(async () => undefined),
      pipe: vi.fn(async () => ({ reason: "complete" })),
      end: vi.fn(async () => undefined),
    };
    (run.createStep as ReturnType<typeof vi.fn>).mockReturnValue(step);
    const assistantResponse: UIMessage = {
      id: "response-1",
      role: "assistant",
      metadata: {
        conversationId: input.context.conversationId,
        runId: input.ids.runId,
      },
      parts: [{ type: "text", text: "Done." }],
    };
    const stream = runtimeDependencies.agent.stream as ReturnType<typeof vi.fn>;
    stream.mockReturnValue({
      response: Promise.resolve({ uiMessages: [assistantResponse] }),
      finishReason: Promise.resolve("stop"),
    });
    await new MockActivityEnvironment().run(runInferenceActivity, activityInput);
    expect(stream).toHaveBeenCalledTimes(1);
    return stream.mock.calls[0] as [unknown, { providerOptions?: unknown }];
  }

  it("caps thinking on interactive conversational turns", async () => {
    // Gemini 2.5 spends its whole thinking allowance before the first output
    // token, so unbounded/dynamic thinking is the dominant share of measured
    // TTFT (243 thought tokens ≈ +1.5s on a greeting). The interactive tier
    // must pin an explicit budget on the per-call stream options — the same
    // per-call placement contract as the readOnly flag below.
    const [, streamOptions] = await streamOnceWith([replayedUserInput]);

    expect(streamOptions.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 256 } },
    });
  });

  it("keeps dynamic thinking for reasoning-tier turns", async () => {
    const attachmentTurn: UIMessage = {
      id: "attachment-user",
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "text/markdown",
          filename: "script.md",
          url: "fizzdragon-media://0197f4a2-0800-7000-8000-000000000009",
        },
        { type: "text", text: "全面分析这部剧本" },
      ],
    };

    const [, streamOptions] = await streamOnceWith([attachmentTurn]);

    expect(streamOptions.providerOptions).toBeUndefined();
  });
});

describe("single-writer memory contract", () => {
  it("streams every model step with per-call readOnly memory options", async () => {
    // Pinned placement: Mastra's persistence gates parse the RAW per-call
    // memory options out of the RequestContext. A constructor-level readOnly
    // on the Memory instance is ignored by every gate — verified empirically:
    // with only the constructor flag set, Mastra still wrote orphan assistant
    // rows (its own id, no runId). Losing the per-call flag silently brings
    // back the second writer and, with it, the attachment-turn persistence
    // crash and the misattribution class behind RUN_IDENTITY_MISMATCH.
    const { run, persisted } = adoptRunWith([replayedUserInput]);
    const step = {
      start: vi.fn(async () => undefined),
      pipe: vi.fn(async () => ({ reason: "complete" })),
      end: vi.fn(async () => undefined),
    };
    (run.createStep as ReturnType<typeof vi.fn>).mockReturnValue(step);
    const assistantResponse: UIMessage = {
      id: "response-1",
      role: "assistant",
      metadata: {
        conversationId: input.context.conversationId,
        runId: input.ids.runId,
      },
      parts: [{ type: "text", text: "你好！" }],
    };
    const stream = runtimeDependencies.agent.stream as ReturnType<typeof vi.fn>;
    stream.mockReturnValue({
      response: Promise.resolve({ uiMessages: [assistantResponse] }),
      finishReason: Promise.resolve("stop"),
    });

    const outcome = await new MockActivityEnvironment().run(runInferenceActivity, activityInput);

    expect(outcome).toEqual({ kind: "complete" });
    expect(stream).toHaveBeenCalledTimes(1);
    const [, streamOptions] = stream.mock.calls[0] as [
      unknown,
      { memory?: { options?: { readOnly?: boolean } } },
    ];
    expect(streamOptions.memory?.options?.readOnly).toBe(true);
    // The canonical writer still persists the turn — readOnly must starve
    // only Mastra's pipeline, never our explicit path.
    expect(persisted.some((message) => message.id === "response-1")).toBe(true);
  });
});
