"use client";

/**
 * Story Studio's StoryOS data layer.
 *
 * Split in two, because the panel has two independent lifetimes:
 *
 * - {@link useStoryStudioAgentBootstrap} is plain HTTP — thread resolution, the
 *   persisted history seed, attachments, the permission policy, approvals. It
 *   runs whether or not the creator ever opens StoryOS, because the first-open
 *   hero and the closed-panel failure notice are driven by it, and it costs no
 *   Ably connection.
 * - {@link useStoryStudioAgentSession} is the conversation, and it only exists
 *   inside `<AblyProvider><ChatTransportProvider>`. It is `useChat` over
 *   `@ably/ai-transport`'s `ChatTransport` plus our projection, and nothing
 *   more: no cursor, no catch-up loop, no journal, no gap detection. Those
 *   existed to rebuild a conversation from a numbered event log, and the log is
 *   gone.
 *
 * {@link useDisconnectedStoryStudioAgentSession} produces the same interface
 * from the bootstrap alone, so the surface renders one component in both states
 * instead of two that must be kept in step.
 *
 * ## Why two write paths, and why that is still one mechanism
 *
 * `useChat` serialises on `status === "ready"` — a second `sendMessage` while a
 * stream is live orphans the first response. Our composer deliberately sends
 * mid-turn (`steer`, `enqueue`), so those go through the transport's own
 * continuation verb, `ClientView.send(input, { runId })`, and wake the control
 * plane with the same invocation POST the `ChatTransport` would have issued.
 * Same endpoint, same body, same codec, same channel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useChat } from "@ai-sdk/react";
import { useChatTransport, useMessageSync } from "@ably/ai-transport/vercel/react";
import type { ClientSession, RunInfo } from "@ably/ai-transport/react";
import { createUIMessageCodec } from "@ably/ai-transport/vercel";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  studioAgentThreadChannel,
  type StudioAgentSubmissionInvocationRequest,
  type StudioAgentMessagePart,
  type StudioAgentPermissionMode,
  type StudioAgentPermissionPolicy,
  type StudioAgentThread,
  type StudioAgentThreadScope,
  type StudioAgentTurnWindow,
} from "@repo/shared";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type ChatTransport as SdkChatTransport,
  type UITools,
} from "ai";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";

import type { StudioAgentAttachmentUploadLease } from "@/components/studio-agent";
import { STUDIO_AGENT_DOCUMENT_MEDIA_TYPES } from "@/components/studio-agent";
import { ApiRequestError } from "@/lib/api";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  EMPTY_STUDIO_AGENT_HISTORY_SEED,
  StudioAgentApiClient,
  createStudioAgentHistorySeed,
  prependStudioAgentHistorySeed,
  projectStudioAgentPanel,
  refreshStudioAgentHistorySeed,
  selectStudioAgentChildRuns,
  studioAgentAttachmentPart,
  toStudioAgentMessageParts,
  useStudioAgentRealtime,
  type StudioAgentDataParts,
  type StudioAgentDeliveryMode,
  type StudioAgentFailedRunView,
  type StudioAgentHistorySeed,
  type StudioAgentMessageMetadata,
  type StudioAgentRunView,
  type StudioAgentStreamStatus,
  type StudioAgentTimelineItemView,
  type StudioAgentUIMessage,
} from "@/lib/studio-agent";

import { matchesStoryProjectionQueryKey } from "./story-canvas-edit-policy";

/**
 * The server's word that the turn this message aimed at has ended.
 *
 * Raised when a steer or an enqueue names a run that is no longer active —
 * which is exactly what the reaper leaves behind after it frees a thread whose
 * workflow died silently.
 */
function isTargetRunInactive(cause: unknown): boolean {
  return cause instanceof ApiRequestError && cause.code === "STUDIO_AGENT_TARGET_RUN_INACTIVE";
}

const STORY_SURFACE_ID = "story.studio";
const STORY_SCENARIO = {
  id: "story.studio.assistant",
  version: "1.0.0",
} as const;
const EMPTY_TURN_WINDOW: StudioAgentTurnWindow = {
  earliestRootRunId: null,
  hasEarlier: false,
};
/** Module-level so a disconnected panel's projection input stays referentially stable. */
const NO_WIRE_RUNS: RunInfo[] = [];

/**
 * How long an in-flight turn may say NOTHING before the panel admits it.
 *
 * Deliberately longer than every legitimate silence a live worker produces:
 * time-to-first-token on a large storyboard context, a transactional tool
 * inside its 45s start-to-close, a delegated task run (which has no channel
 * identity at all and therefore publishes nothing while it works), and the gap
 * between two model steps. Two minutes clears all of them with margin. It is
 * NOT a cancel and NOT a terminal — see the effect that uses it.
 */
const STUDIO_AGENT_STALL_NOTICE_MS = 120_000;

/**
 * The codec, for the one input the `ChatTransport` does not build for us.
 *
 * Stateless and generic-only: `createUIMessageCodec` takes no runtime argument
 * and its type parameters erase, so this value is identical to the one
 * `ChatTransportProvider` constructs internally. Reusing the factory rather
 * than reaching into the provider is what keeps a steer's wire shape provably
 * the same as a fresh send's.
 */
const codec = createUIMessageCodec<StudioAgentMessageMetadata, StudioAgentDataParts, UITools>();

type SessionStatus = "loading" | "ready" | "error";
type StudioAgentClientSession = ReturnType<typeof useChatTransport>["session"];

export type StoryStudioAgentAttachment = Extract<StudioAgentMessagePart, { type: "attachment" }>;

export interface StoryStudioAgentScope {
  projectId: string;
  chapterId: string | null;
  workspaceId: string;
}

export interface StoryStudioAgentBootstrap extends StoryStudioAgentScope {
  status: SessionStatus;
  error: Error | null;
  thread: StudioAgentThread | null;
  history: StudioAgentHistorySeed;
  /** Regenerated on every scope change so the chat and the seed stay in step. */
  conversationKey: string;
  realtime: ReturnType<typeof useStudioAgentRealtime>;
  hasEarlierTurns: boolean;
  loadingEarlierTurns: boolean;
  policyUpdating: boolean;
  commandError: Error | null;
  clearCommandError: () => void;
  reportCommandError: (error: Error | null) => void;
  retry: () => void;
  loadEarlierTurns: () => Promise<void>;
  /** Re-read the control plane. Driven by the channel; never polled. */
  refreshControlPlane: () => void;
  submitInvocation: (
    request: Omit<StudioAgentSubmissionInvocationRequest, "inputEventId" | "sessionName">,
    invocation: { inputEventId: string; sessionName: string }
  ) => Promise<void>;
  buildInvocation: (input: {
    clientMessageId: string;
    parts: StudioAgentSubmissionInvocationRequest["parts"];
    targetRunId: string | null;
    delivery: StudioAgentSubmissionInvocationRequest["delivery"];
  }) => Omit<StudioAgentSubmissionInvocationRequest, "inputEventId" | "sessionName"> | null;
  /**
   * The durable half of a stop. See `StudioAgentApiClient.cancelRun` — it is
   * the only path that reaches a turn parked between activities.
   */
  requestDurableCancel: (runId: string) => Promise<void>;
  /**
   * Start over: retire this conversation and open an empty one.
   *
   * Archiving is the entire mechanism — the server flips the thread's status and
   * the next resolve, which `retry` triggers, finds nothing active and creates a
   * fresh thread. A new thread id means a new `conversationKey`, so `useChat`
   * reconstructs against an empty seed and the panel is genuinely blank rather
   * than cleared-looking. Nothing is deleted.
   */
  startNewConversation: () => Promise<void>;
  /**
   * The creator's own view of the conversation, for the one caller that lives
   * above `useChat` and still needs it.
   *
   * `prepareSendMessagesRequest` is configured on the transport, which is
   * created ABOVE the provider, so it cannot call `useChat`. The library hands
   * it a `history` derived from the CHANNEL TREE — and on an approval
   * continuation the tree does not yet know the answer, because publishing that
   * answer is what this very request is for. Reading the decision from `history`
   * therefore always found `approval-requested`, never `approval-responded`, so
   * the approval body came out empty and the POST went out carrying only the
   * library's own two fields: a 400, and a turn parked forever behind
   * "Approved · Resuming the turn".
   *
   * The overlay is where the decision actually lives until it is published, so
   * that is what this carries. A ref rather than state on purpose: it is read
   * during a send, never rendered, and putting it in `chatOptions` would rebuild
   * the transport on every message and drop the stream mid-turn.
   */
  overlayRef: MutableRefObject<StudioAgentUIMessage[]>;
  uploadAttachment: (
    file: File,
    context: {
      signal: AbortSignal;
      onProgress: (percent: number) => void;
      onProcessing?: () => void;
    }
  ) => Promise<StudioAgentAttachmentUploadLease>;
  updatePermissionMode: (mode: StudioAgentPermissionMode) => Promise<void>;
}

export interface StoryStudioAgentSession {
  /** Retire this conversation and open an empty one. See the bootstrap member. */
  startNewConversation: () => Promise<void>;
  status: SessionStatus;
  error: Error | null;
  streamStatus: StudioAgentStreamStatus;
  streamError: Error | null;
  commandError: Error | null;
  thread: StudioAgentThread | null;
  timeline: StudioAgentTimelineItemView[];
  childRuns: StudioAgentRunView[];
  turnFailure: StudioAgentFailedRunView | null;
  activeRun: StudioAgentRunView | null;
  isRunning: boolean;
  queuedCount: number;
  submitting: boolean;
  /**
   * A cancel is published and the turn has not settled yet.
   *
   * Held until the run reaches a terminal — NOT until `session.cancel()`
   * resolves. Publishing `ai-cancel` is the whole of the client's part;
   * everything the creator is waiting for (the agent unwinding, the canonical
   * terminal) happens after it, and a flag that cleared on the publish would
   * put the panel back to "working" one tick after the stop button was pressed.
   */
  cancelling: boolean;
  /**
   * An in-flight turn has published nothing for
   * {@link STUDIO_AGENT_STALL_NOTICE_MS}.
   *
   * A notice, not a terminal: the turn is still running as far as anyone knows,
   * and a worker that died silently is the case this exists for. Suppressed
   * while the run is waiting on the creator, which is silent by design.
   */
  stalled: boolean;
  policyUpdating: boolean;
  hasEarlierTurns: boolean;
  loadingEarlierTurns: boolean;
  loadEarlierTurns: () => Promise<void>;
  retry: () => void;
  clearCommandError: () => void;
  submit: (
    text: string,
    mode: StudioAgentDeliveryMode,
    attachments?: readonly StoryStudioAgentAttachment[]
  ) => Promise<boolean>;
  uploadAttachment: StoryStudioAgentBootstrap["uploadAttachment"];
  cancelActiveRun: () => Promise<void>;
  updatePermissionMode: (mode: StudioAgentPermissionMode) => Promise<void>;
  /**
   * Answer a tool call the agent suspended on — the ONE approval write on this
   * wire.
   *
   * `approvalId` is the transport's `approval.id`, taken off the part the
   * timeline is rendering. There is no second HTTP call beside it: the decision
   * rewrites the local part, `sendAutomaticallyWhen` fires the continuation, and
   * the library publishes the `tool-approval-response` and wakes the control
   * plane through the same invocation endpoint every turn uses.
   */
  respondToToolApproval: (approvalId: string, approved: boolean) => Promise<void>;
}

export function useStoryStudioAgentBootstrap({
  projectId,
  chapterId,
  workspaceId,
  active,
}: StoryStudioAgentScope & {
  /**
   * Whether the creator is actually looking at the assistant.
   *
   * One connection and one channel are held per subscribed thread and the
   * account is capped on both, so this gates the CONNECTION, not the session.
   * Thread resolution and the history seed still run on mount: they are plain
   * HTTP and they drive the closed-panel failure notice and the first-open hero.
   */
  active: boolean;
}): StoryStudioAgentBootstrap {
  const locale = useLocale();
  const composerCopy = useTranslations("storyStudio.canvas.studioAgent.composer");
  // Written by the session hook below the provider, read by the transport
  // above it. See `StoryStudioAgentBootstrap.overlayRef` for why.
  const overlayRef = useRef<StudioAgentUIMessage[]>([]);
  const apiClient = useMemo(
    () => new StudioAgentApiClient({ workspaceId, locale }),
    [locale, workspaceId]
  );
  const [retryToken, setRetryToken] = useState(0);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [error, setError] = useState<Error | null>(null);
  const [commandError, setCommandError] = useState<Error | null>(null);
  const [thread, setThread] = useState<StudioAgentThread | null>(null);
  const [history, setHistory] = useState<StudioAgentHistorySeed>(EMPTY_STUDIO_AGENT_HISTORY_SEED);
  const [turnWindow, setTurnWindow] = useState<StudioAgentTurnWindow>(EMPTY_TURN_WINDOW);
  const [loadingEarlierTurns, setLoadingEarlierTurns] = useState(false);
  const [policyUpdating, setPolicyUpdating] = useState(false);

  const threadRef = useRef<StudioAgentThread | null>(null);
  const historyRef = useRef(history);
  const turnWindowRef = useRef(turnWindow);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const earlierTokenRef = useRef<symbol | null>(null);
  const refreshTokenRef = useRef<symbol | null>(null);
  const policyMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const policyMutationTokensRef = useRef(new Set<symbol>());

  const replaceThread = useCallback((next: StudioAgentThread | null) => {
    threadRef.current = next;
    setThread(next);
  }, []);
  const replaceHistory = useCallback((next: StudioAgentHistorySeed) => {
    historyRef.current = next;
    setHistory(next);
  }, []);
  const replaceTurnWindow = useCallback((next: StudioAgentTurnWindow) => {
    turnWindowRef.current = next;
    setTurnWindow(next);
  }, []);

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const abortController = new AbortController();
    threadRef.current = null;
    historyRef.current = EMPTY_STUDIO_AGENT_HISTORY_SEED;
    // Synchronous, not in the microtask block: the thread id survives a chapter
    // switch, so an in-flight earlier page has only the load generation and
    // this cursor to tell it that its window is gone.
    turnWindowRef.current = EMPTY_TURN_WINDOW;
    earlierTokenRef.current = null;
    refreshTokenRef.current = null;
    loadAbortRef.current = abortController;
    policyMutationQueueRef.current = Promise.resolve();
    policyMutationTokensRef.current.clear();

    // Reset visible state at the next microtask boundary, so a scope change
    // clears the previous conversation before any awaited response can commit.
    queueMicrotask(() => {
      if (abortController.signal.aborted || generation !== loadGenerationRef.current) return;
      setStatus("loading");
      setError(null);
      setCommandError(null);
      setThread(null);
      setHistory(EMPTY_STUDIO_AGENT_HISTORY_SEED);
      setTurnWindow(EMPTY_TURN_WINDOW);
      setLoadingEarlierTurns(false);
      setPolicyUpdating(false);
    });

    void (async () => {
      try {
        const resolved = await apiClient.resolveThread(
          {
            schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
            surfaceId: STORY_SURFACE_ID,
            scenario: STORY_SCENARIO,
            scope: storyScope({ projectId, chapterId, workspaceId }),
            locale,
          },
          abortController.signal
        );
        const snapshot = await apiClient.getSnapshot(resolved.thread.threadId, {
          signal: abortController.signal,
        });
        assertSnapshotScope(snapshot.thread, resolved.thread, projectId, workspaceId);
        if (abortController.signal.aborted || generation !== loadGenerationRef.current) return;

        replaceHistory(createStudioAgentHistorySeed(snapshot));
        replaceThread(snapshot.thread);
        replaceTurnWindow(snapshot.turnWindow);
        setStatus("ready");
      } catch (cause) {
        if (abortController.signal.aborted || generation !== loadGenerationRef.current) return;
        setError(toError(cause));
        setStatus("error");
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [
    apiClient,
    chapterId,
    locale,
    projectId,
    replaceHistory,
    replaceThread,
    replaceTurnWindow,
    retryToken,
    workspaceId,
  ]);

  const threadId = thread?.threadId ?? null;
  const authorize = useCallback(() => {
    if (!threadId) return Promise.reject(new Error("No Studio Agent conversation is resolved."));
    return apiClient.createRealtimeGrant(threadId);
  }, [apiClient, threadId]);

  const realtime = useStudioAgentRealtime({
    threadId,
    enabled: status === "ready" && active,
    authorize,
  });

  const enqueuePolicyOperation = useCallback(
    async <T>(
      expectedThreadId: string,
      operation: (currentThread: StudioAgentThread) => Promise<T>,
      trackPolicyUpdate: boolean
    ): Promise<T> => {
      const token = Symbol("studio-agent-policy-operation");
      if (trackPolicyUpdate) {
        policyMutationTokensRef.current.add(token);
        setPolicyUpdating(true);
      }
      const queued = policyMutationQueueRef.current.then(async () => {
        const currentThread = threadRef.current;
        if (!currentThread || currentThread.threadId !== expectedThreadId) {
          throw new Error("The active Studio Agent conversation changed.");
        }
        return operation(currentThread);
      });
      policyMutationQueueRef.current = queued.then(
        () => undefined,
        () => undefined
      );
      try {
        return await queued;
      } finally {
        if (trackPolicyUpdate) {
          policyMutationTokensRef.current.delete(token);
          setPolicyUpdating(policyMutationTokensRef.current.size > 0);
        }
      }
    },
    []
  );

  const uploadAttachment = useCallback<StoryStudioAgentBootstrap["uploadAttachment"]>(
    async (file, context) => {
      const currentThread = threadRef.current;
      if (!currentThread || status !== "ready") {
        throw new Error("The Studio Agent conversation is not ready for attachments.");
      }
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: STUDIO_AGENT_DOCUMENT_MEDIA_TYPES.some((mediaType) => mediaType === file.type)
          ? "studio_agent_document"
          : "studio_agent_image",
        workspaceId,
        contentType: file.type,
        signal: context.signal,
        onProgress: context.onProgress,
      });
      if (threadRef.current?.threadId !== currentThread.threadId) {
        throw new Error("The active Studio Agent conversation changed during upload.");
      }
      context.onProcessing?.();

      const registered = await apiClient.registerAttachment(
        currentThread.threadId,
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          mediaAssetId: uploaded.mediaAssetId,
          fileName: file.name,
        },
        context.signal
      );
      let abandonment: Promise<void> | null = null;
      const lease: StudioAgentAttachmentUploadLease = {
        attachment: registered.attachment,
        abandon() {
          abandonment ??= apiClient
            .deleteAttachment(currentThread.threadId, registered.attachment.attachmentId)
            .then(() => undefined);
          return abandonment;
        },
      };
      if (context.signal.aborted || threadRef.current?.threadId !== currentThread.threadId) {
        void Promise.resolve(lease.abandon()).catch(() => undefined);
        throw new Error("The active Studio Agent conversation changed during registration.");
      }
      return lease;
    },
    [apiClient, status, workspaceId]
  );

  const updatePermissionMode = useCallback(
    async (mode: StudioAgentPermissionMode) => {
      const currentThread = threadRef.current;
      if (!currentThread || mode === currentThread.permissionPolicy.mode) return;
      setCommandError(null);
      try {
        await enqueuePolicyOperation(
          currentThread.threadId,
          async (operationThread) => {
            const permissionPolicy = await apiClient.updatePermissionPolicy(
              operationThread.threadId,
              {
                schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
                expectedRevision: operationThread.permissionPolicy.revision,
                mode,
                rules: operationThread.permissionPolicy.rules,
              }
            );
            applyPolicy(threadRef, replaceThread, operationThread.threadId, permissionPolicy);
          },
          true
        );
      } catch (cause) {
        const nextError = toError(cause);
        if (threadRef.current?.threadId === currentThread.threadId) setCommandError(nextError);
        throw nextError;
      }
    },
    [apiClient, enqueuePolicyOperation, replaceThread]
  );

  /**
   * Re-read the newest window from Postgres.
   *
   * Approvals, delegated task runs and applied writes have no wire shape by
   * design — the channel says WHEN to look and this is the looking. Serialised
   * on a single token so a burst of channel activity re-reads once, and
   * deliberately silent about its own failures: it is a refresh of state the
   * panel already has, not a command the creator issued.
   */
  const refreshControlPlane = useCallback(() => {
    const currentThread = threadRef.current;
    if (!currentThread || refreshTokenRef.current) return;
    const generation = loadGenerationRef.current;
    const token = Symbol("studio-agent-control-plane-refresh");
    refreshTokenRef.current = token;
    void apiClient
      .getSnapshot(currentThread.threadId, { signal: loadAbortRef.current?.signal })
      .then((snapshot) => {
        if (generation !== loadGenerationRef.current) return;
        if (snapshot.thread.threadId !== currentThread.threadId) return;
        replaceHistory(
          refreshStudioAgentHistorySeed(historyRef.current, createStudioAgentHistorySeed(snapshot))
        );
        // The read is authoritative for the thread — except for a permission
        // policy this client has already advanced by command. A refresh issued
        // before that command committed would otherwise roll the creator's
        // "always allow" back to the revision it was answering.
        const held = threadRef.current?.permissionPolicy;
        replaceThread(
          held && held.revision > snapshot.thread.permissionPolicy.revision
            ? { ...snapshot.thread, permissionPolicy: held }
            : snapshot.thread
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (refreshTokenRef.current === token) refreshTokenRef.current = null;
      });
  }, [apiClient, replaceHistory, replaceThread]);

  const loadEarlierTurns = useCallback(async () => {
    const currentThread = threadRef.current;
    const cursor = turnWindowRef.current;
    if (!currentThread || !cursor.hasEarlier || !cursor.earliestRootRunId) return;
    if (earlierTokenRef.current) return;
    // The thread id survives a chapter switch (thread identity is
    // container-scoped, not focus-scoped), so only the load generation can tell
    // a stale page from a live one.
    const generation = loadGenerationRef.current;
    const token = Symbol("studio-agent-load-earlier");
    earlierTokenRef.current = token;
    setLoadingEarlierTurns(true);
    setCommandError(null);
    try {
      const page = await apiClient.getSnapshot(currentThread.threadId, {
        beforeRootRunId: cursor.earliestRootRunId,
        signal: loadAbortRef.current?.signal,
      });
      if (generation !== loadGenerationRef.current) return;
      replaceHistory(
        prependStudioAgentHistorySeed(historyRef.current, createStudioAgentHistorySeed(page))
      );
      replaceTurnWindow(page.turnWindow);
    } catch (cause) {
      const nextError = toError(cause);
      if (generation === loadGenerationRef.current) setCommandError(nextError);
      throw nextError;
    } finally {
      if (earlierTokenRef.current === token) {
        earlierTokenRef.current = null;
        setLoadingEarlierTurns(false);
      }
    }
  }, [apiClient, replaceHistory, replaceTurnWindow]);

  const buildInvocation = useCallback<StoryStudioAgentBootstrap["buildInvocation"]>(
    ({ clientMessageId, parts, targetRunId, delivery }) => {
      const currentThread = threadRef.current;
      if (!currentThread || parts.length === 0) return null;
      return {
        kind: "submission",
        threadId: currentThread.threadId,
        clientMessageId,
        parts,
        targetRunId,
        delivery,
        scope: storyScope({ projectId, chapterId, workspaceId }),
        locale,
      };
    },
    [chapterId, locale, projectId, workspaceId]
  );

  const submitInvocation = useCallback<StoryStudioAgentBootstrap["submitInvocation"]>(
    async (request, invocation) => {
      await apiClient.sendInvocation({ ...request, ...invocation });
    },
    [apiClient]
  );

  const startNewConversation = useCallback<
    StoryStudioAgentBootstrap["startNewConversation"]
  >(async () => {
    const currentThread = threadRef.current;
    if (!currentThread) return;
    setCommandError(null);
    try {
      await apiClient.archiveThread(currentThread.threadId);
    } catch (cause) {
      const nextError = toError(cause);
      setCommandError(nextError);
      throw nextError;
    }
    // Re-resolve. The archived thread is no longer `active`, so this mints a new
    // one; `conversationKey` changes with it and `useChat` starts clean.
    setRetryToken((current) => current + 1);
  }, [apiClient]);

  const requestDurableCancel = useCallback<StoryStudioAgentBootstrap["requestDurableCancel"]>(
    async (runId) => {
      const currentThread = threadRef.current;
      if (!currentThread) return;
      await apiClient.cancelRun(currentThread.threadId, runId, {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        // Localized because it comes back: the server keeps this as the run's
        // reason, `StudioAgentRunView.summary` carries it, and the timeline
        // renders that string verbatim. An English literal here is a sentence a
        // zh-CN creator would read in the panel.
        reason: composerCopy("cancelReason"),
      });
    },
    [apiClient, composerCopy]
  );

  return {
    projectId,
    chapterId,
    workspaceId,
    status,
    error,
    thread,
    history,
    conversationKey: `${thread?.threadId ?? "pending"}:${retryToken}`,
    realtime,
    hasEarlierTurns: turnWindow.hasEarlier,
    loadingEarlierTurns,
    policyUpdating,
    commandError,
    clearCommandError: useCallback(() => setCommandError(null), []),
    reportCommandError: useCallback((next: Error | null) => setCommandError(next), []),
    retry: useCallback(() => setRetryToken((current) => current + 1), []),
    loadEarlierTurns,
    refreshControlPlane,
    buildInvocation,
    submitInvocation,
    requestDurableCancel,
    startNewConversation,
    overlayRef,
    uploadAttachment,
    updatePermissionMode,
  };
}

/**
 * The conversation.
 *
 * MUST be called inside `<AblyProvider><ChatTransportProvider>`; outside them
 * `useChatTransport` returns stubs that throw on access.
 */
export function useStoryStudioAgentSession(
  bootstrap: StoryStudioAgentBootstrap
): StoryStudioAgentSession {
  const queryClient = useQueryClient();
  const { session, chatTransport, sessionError, chatTransportError } = useChatTransport();
  const transportError = sessionError ?? chatTransportError ?? null;

  const chat = useChat<StudioAgentUIMessage>({
    id: bootstrap.conversationKey,
    // `useChat` reads this once, at construction. The provider subtree is only
    // mounted after the snapshot has loaded, so the seed is always complete
    // here — which is also why `conversationKey` has to change with the thread.
    messages: bootstrap.history.messages,
    // The provider bakes the codec's default generics, so the transport it
    // hands back is typed with the SDK's default UIMessage. Re-applying our own
    // parameterisation is a pure type-level narrowing: `createUIMessageCodec`
    // takes no runtime argument and its type parameters erase, so the wire, the
    // codec and the channel are byte-identical either way.
    transport: chatTransport as unknown as SdkChatTransport<StudioAgentUIMessage>,
    /**
     * What turns an approval into a resumed turn.
     *
     * `addToolApprovalResponse` only rewrites the local part; the decision
     * reaches the agent when the transport derives a `tool-approval-response`
     * from the overlay, and it only does that on a continuation. This predicate
     * is what fires that continuation, and it is narrow by construction — the
     * SDK's own helper requires the last assistant step to carry at least one
     * approval response with every approval answered, so an ordinary turn
     * finishing never trips it.
     */
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const {
    messages,
    setMessages,
    sendMessage,
    status: chatStatus,
    stop,
    addToolApprovalResponse,
  } = chat;

  useMessageSync<StudioAgentMessageMetadata, StudioAgentDataParts, UITools>({
    setMessages,
    messages: bootstrap.history.messages,
  });

  // The overlay, published upward for `prepareSendMessagesRequest`. Assigned
  // during render rather than in an effect: a send can be issued by
  // `sendAutomaticallyWhen` in the same commit that answers an approval, which
  // is before effects flush, and a stale overlay there is exactly the bug this
  // exists to prevent.
  bootstrap.overlayRef.current = messages;

  const wireRuns = useStudioAgentWireRuns(transportError ? null : session);

  // Deliberately NOT subscribed here: `ChatTransport.streaming` is the
  // transport's own "a stream is open" flag, and this panel already knows that
  // more precisely from two richer sources — `RunInfo` for the run's lifecycle
  // and `TextUIPart.state` for the individual reply that is arriving. A third
  // boolean saying a coarser version of the same thing is a second source of
  // truth, so it is not read.
  // The library surfaces a failed invocation POST here — the input event is
  // already on the channel by then, so this is the only place the creator
  // learns that the server refused to act on it.
  const { reportCommandError } = bootstrap;
  useEffect(() => {
    if (transportError) return;
    return session.on("error", (cause) => {
      reportCommandError(new Error(cause.message));
    });
  }, [reportCommandError, session, transportError]);

  /**
   * Prompts published into a live turn that the channel has not echoed yet.
   *
   * `useMessageSync` gates `setMessages` for the duration of an own-run stream,
   * so without this a steer sent mid-turn would be invisible until the turn
   * ended. Each entry clears the moment the composed conversation contains it.
   */
  const [pending, setPending] = useState<StudioAgentUIMessage[]>([]);
  const messageIds = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  // Derived, not pruned in an effect: the echo's arrival is a fact about
  // `messages`, so asking the question at read time is both cheaper and
  // impossible to get out of step. The state itself is compacted on the next
  // send, which is the only thing that can add to it.
  const visiblePending = useMemo(
    () => pending.filter((message) => !messageIds.has(message.id)),
    [messageIds, pending]
  );

  const panel = useMemo(
    () =>
      projectStudioAgentPanel({
        history: bootstrap.history,
        messages,
        wireRuns,
        pending: visiblePending,
      }),
    [bootstrap.history, messages, visiblePending, wireRuns]
  );
  const childRuns = useMemo(
    () => (panel.activeRun ? selectStudioAgentChildRuns(panel, panel.activeRun.id) : []),
    [panel]
  );

  // The channel moved, so the control plane may have too. This is the ONLY
  // trigger: no interval, no poll, no refetch on focus.
  const { refreshControlPlane } = bootstrap;
  const { revalidationToken } = panel;
  const settledRevalidationRef = useRef<string | null>(null);
  useEffect(() => {
    if (settledRevalidationRef.current === revalidationToken) return;
    const first = settledRevalidationRef.current === null;
    settledRevalidationRef.current = revalidationToken;
    if (first) return;
    refreshControlPlane();
  }, [refreshControlPlane, revalidationToken]);

  // An agent write landed (or provably did not). The canvas reads its story
  // projections through react-query with no channel of its own, so it is told
  // here — otherwise it keeps rendering the pre-edit draft and the creator's
  // next manual edit hits a spurious revision conflict.
  const { projectId } = bootstrap;
  const reconcileToken = `${bootstrap.history.writeToken}#${panel.turnTerminalToken ?? ""}`;
  const settledReconcileRef = useRef<string | null>(null);
  useEffect(() => {
    if (settledReconcileRef.current === reconcileToken) return;
    const first = settledReconcileRef.current === null;
    settledReconcileRef.current = reconcileToken;
    if (first) return;
    void queryClient.invalidateQueries({
      predicate: (query) => matchesStoryProjectionQueryKey(query.queryKey, projectId),
    });
  }, [projectId, queryClient, reconcileToken]);

  const [submitting, setSubmitting] = useState(false);
  const activeRunId = panel.activeRun?.id ?? null;
  const queuedCount = visiblePending.filter(
    (message) => message.metadata?.delivery === "enqueue"
  ).length;

  /**
   * A turn is in flight, whether or not it has a run id yet.
   *
   * The window between `sendMessage` and `ai-run-start` is real — the agent
   * mints the run id, so the browser has none until the workflow says so — and
   * it is exactly when a creator who mistyped reaches for Stop. Treating it as
   * "nothing to cancel" is why the stop button used to be inert there.
   */
  const inFlight = activeRunId !== null || chatStatus === "submitted" || chatStatus === "streaming";

  /**
   * The creator asked to stop, and the turn has not settled yet.
   *
   * Deliberately not cleared when `session.cancel()` resolves: publishing
   * `ai-cancel` is the whole of the client's part, and everything the creator is
   * actually waiting for — the agent unwinding, the canonical terminal landing
   * on the channel — happens after it. Clearing on the publish put the panel
   * back to "working" a tick after Stop was pressed, which read as the button
   * having done nothing.
   *
   * Only `inFlight` clears it, so it cannot bleed onto the next turn, and a
   * cancel the agent never honours keeps saying so instead of quietly reverting.
   */
  const [cancelRequested, setCancelRequested] = useState(false);
  // Derived, never cleared by an effect: `inFlight` going false IS the turn
  // settling, so ANDing against it retires the flag with no extra render. The
  // stale `true` left in state is harmless for the same reason, and `submit`
  // clears it before the next turn can set `inFlight` again.
  const cancelling = cancelRequested && inFlight;

  /**
   * THE PANEL MUST NOT SPIN FOREVER ON A TURN THAT STOPPED SPEAKING.
   *
   * Every other unstick in this hook depends on somebody publishing something:
   * the domain terminal, the wire's `ai-run-end`, a rich failure part. A worker
   * that DIES — OOM-killed, evicted, a container restart mid-activity —
   * publishes none of them. Temporal will eventually retry or fail the workflow,
   * but its schedule-to-close is minutes long and the browser is told nothing at
   * all in the meantime. There is no watchdog anywhere in this file today, so
   * that state is indistinguishable from a slow model and lasts until reload.
   *
   * This is a NOTICE, not a terminal. It does not cancel the turn, does not
   * write anything, and does not lock the composer — it says "this turn has not
   * reported progress" and lets the creator decide to wait or to stop. That is
   * what makes a generous, false-positive-tolerant bound the right shape: a
   * needlessly-shown notice costs a sentence, while a needlessly-failed turn
   * would cost the creator their reply.
   *
   * SUPPRESSED WHILE THE TURN IS WAITING ON THE CREATOR. `waiting_for_approval`
   * and `waiting_for_input` are silent by design and can stay silent for hours;
   * calling that a stall would be lying about the most common legitimate pause.
   *
   * THE PULSE IS CONTENT, NOT IDENTITY. `messages` gets a fresh array on every
   * delta, but `useMessageSync` also replaces it wholesale on a snapshot
   * refresh — including the refresh this very effect triggers. Keying on the
   * array's identity would let that refresh reset the window and hide a real
   * stall forever, so the pulse is a fingerprint of what has actually arrived.
   *
   * `stalled` is DERIVED from the pulse the stall was declared against, not
   * cleared by a second effect. The moment anything new arrives the key moves
   * and the notice is simply no longer true — which is both one render fewer and
   * impossible to leave stuck on a turn that recovered.
   */
  const channelPulse = useMemo(() => {
    const last = messages[messages.length - 1];
    const text =
      last?.parts.reduce(
        (total, part) => total + (part.type === "text" ? part.text.length : 0),
        0
      ) ?? 0;
    return `${messages.length}:${last?.id ?? ""}:${last?.parts.length ?? 0}:${text}`;
  }, [messages]);
  const awaitingCreator =
    panel.activeRun?.status === "waiting_for_approval" ||
    panel.activeRun?.status === "waiting_for_input";
  const stallWatchKey = `${inFlight}:${awaitingCreator}:${chatStatus}:${channelPulse}`;
  const [stalledAt, setStalledAt] = useState<string | null>(null);
  useEffect(() => {
    if (!inFlight || awaitingCreator) {
      return;
    }
    const timer = setTimeout(() => {
      setStalledAt(stallWatchKey);
      // One snapshot read, once per stall. If the run reached a terminal in
      // Postgres and the channel terminal was lost, this unsticks the panel for
      // real rather than only describing the symptom; if the run is still
      // `running`, nothing changes and the notice stands.
      refreshControlPlane();
    }, STUDIO_AGENT_STALL_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [awaitingCreator, inFlight, refreshControlPlane, stallWatchKey]);
  const stalled = stalledAt !== null && stalledAt === stallWatchKey;

  const submit = useCallback<StoryStudioAgentSession["submit"]>(
    async (text, mode, attachments = []) => {
      const normalized = text.trim();
      const currentThread = bootstrap.thread;
      if (
        (!normalized && attachments.length === 0) ||
        !currentThread ||
        bootstrap.status !== "ready" ||
        transportError
      ) {
        return false;
      }
      if (attachments.some((attachment) => attachment.status !== "ready")) {
        throw new Error("Only ready attachments can be submitted.");
      }
      const running = activeRunId !== null;
      if (running === (mode === "send")) {
        throw new Error("Studio Agent delivery mode does not match the active run state.");
      }

      setSubmitting(true);
      // A new turn is not the stopped one. This is where the cancel flag is
      // retired, rather than in an effect watching `inFlight` — the write
      // happens in the handler that causes the transition, so it costs no
      // extra render and cannot fire on a turn nobody asked to stop.
      setCancelRequested(false);
      bootstrap.clearCommandError();
      try {
        // One id for the message and for the idempotency key. The seam between
        // the persisted transcript and the channel is the domain `message.id`,
        // and the server persists this submission under exactly this id, so
        // minting two would guarantee a duplicate at the seam on reload.
        const clientMessageId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const parts = composeParts(normalized, attachments);

        if (mode === "steer" || mode === "enqueue") {
          const outgoing: StudioAgentUIMessage = {
            id: clientMessageId,
            role: "user",
            metadata: {
              threadId: currentThread.threadId,
              runId: activeRunId!,
              createdAt,
              format: "plain_text",
              clientMessageId,
              delivery: mode,
            },
            parts,
          };
          const invocation = bootstrap.buildInvocation({
            clientMessageId,
            parts: toStudioAgentMessageParts(parts),
            targetRunId: activeRunId,
            delivery: mode,
          });
          if (!invocation) throw new Error("The Studio Agent conversation is not resolved.");
          setPending((current) => [
            ...current.filter((message) => !messageIds.has(message.id)),
            outgoing,
          ]);
          try {
            const run = await session.view.send(codec.createUserMessage(outgoing) as never, {
              runId: activeRunId!,
            });
            await bootstrap.submitInvocation(invocation, run.toInvocation().toJSON());
          } catch (cause) {
            setPending((current) => current.filter((message) => message.id !== clientMessageId));
            // The run we aimed at is gone, and the panel is the last to know:
            // when a workflow dies without reporting, nothing is published on
            // the channel to say so. The server reconciles its own state on the
            // next submission — but this client keeps believing a turn is live
            // and keeps steering into it, so the creator would have to send the
            // same message twice with no idea why the first one bounced.
            if (isTargetRunInactive(cause)) {
              // Re-read the control plane so the panel stops believing a turn
              // is live...
              bootstrap.refreshControlPlane();
              // ...and send the message the creator actually wrote, as the
              // fresh turn it now is. ONLY the client can do this: the input
              // event was already published to the channel stamped with the run
              // being steered, and rewriting it server-side produces a turn the
              // control plane calls fresh and the channel calls a continuation
              // of a corpse — measured, and it dies at `run-start ... not
              // observed`. A new publish with no target is the only correctly
              // shaped one.
              //
              // Retried exactly once, and only for this code: the submission
              // was refused, so nothing was accepted that could be duplicated,
              // and the alternative is asking the creator to send the same
              // sentence twice for a reason nothing on screen explains.
              await sendMessage({
                id: crypto.randomUUID(),
                parts,
                metadata: {
                  threadId: currentThread.threadId,
                  createdAt: new Date().toISOString(),
                  format: "plain_text",
                  clientMessageId,
                },
              });
              return true;
            }
            throw cause;
          }
          return true;
        }

        if (mode === "stop_and_send") {
          // Two operations because it is two decisions: stop the turn, then
          // start a new one. The interrupt has to be published and the local
          // stream torn down before `sendMessage`, which useChat only accepts
          // from a settled state.
          await session.cancel(activeRunId!);
          await stop();
        }
        await sendMessage({
          id: clientMessageId,
          parts,
          metadata: {
            threadId: currentThread.threadId,
            createdAt,
            format: "plain_text",
            clientMessageId,
          },
        });
        return true;
      } catch (cause) {
        const nextError = toError(cause);
        bootstrap.reportCommandError(nextError);
        throw nextError;
      } finally {
        setSubmitting(false);
      }
    },
    [activeRunId, bootstrap, messageIds, sendMessage, session, stop, transportError]
  );

  const cancelActiveRun = useCallback(async () => {
    if (!inFlight || cancelling || transportError) return;
    setCancelRequested(true);
    bootstrap.clearCommandError();
    try {
      // One mechanism, published two ways for the two windows a turn has.
      //
      // With a run id, `session.cancel(runId)` addresses the run directly.
      // Without one — the turn is sent but `ai-run-start` has not landed — the
      // only handle that exists is the triggering input's codec-message-id, and
      // the transport owns it: aborting `useChat` runs the ChatTransport's
      // abort path, which calls `run.cancel()` keyed by that id, and the agent
      // buffers it until its input lookup resolves. So `stop()` is not local
      // cleanup here, it is the cancel, and it runs on both paths.
      //
      // `ai-cancel` fires the agent's `run.abortSignal`; the workflow unwinds
      // whatever it is holding and writes the canonical terminal itself.
      if (activeRunId) await session.cancel(activeRunId);
      await stop();
    } catch (cause) {
      setCancelRequested(false);
      const nextError = toError(cause);
      bootstrap.reportCommandError(nextError);
      throw nextError;
    }

    // AND THE DURABLE ONE, WHICH IS NOT REDUNDANT.
    //
    // `ai-cancel` only reaches a run object an activity is currently holding —
    // i.e. a turn inside a model step. Press stop while a tool is executing,
    // between two activities, or while the turn is parked on an approval or an
    // input, and the worker has nothing registered to route it to: the panel
    // says "stopping" and the turn finishes anyway. The HTTP route writes
    // `cancelling` and enqueues the outbox command that becomes the workflow's
    // `studio-agent.cancel` signal, which cancels the active Temporal scope
    // wherever the workflow is — including a `condition()` no activity holds.
    //
    // AFTER the channel publish, never instead of it: the channel path is
    // milliseconds and the outbox is a poll interval. Whichever lands first
    // drives the workflow through `cancelRun`; the other is a no-op.
    //
    // A failure here does NOT clear `cancelRequested` and does NOT throw. The
    // fast path already fired, so the stop may well have worked; the creator is
    // told the backstop failed and the stall watchdog below is what eventually
    // says the turn is not responding.
    if (activeRunId) {
      try {
        await bootstrap.requestDurableCancel(activeRunId);
      } catch (cause) {
        bootstrap.reportCommandError(toError(cause));
      }
    }
  }, [activeRunId, bootstrap, cancelling, inFlight, session, stop, transportError]);

  const respondToToolApproval = useCallback<StoryStudioAgentSession["respondToToolApproval"]>(
    async (approvalId, approved) => {
      if (transportError) return;
      bootstrap.clearCommandError();
      try {
        // The whole write. It rewrites the local tool part to
        // `approval-responded`, which satisfies `sendAutomaticallyWhen` above;
        // useChat then issues a continuation, and the ChatTransport derives the
        // `tool-approval-response` input from the difference between the
        // overlay and the session tree. Nothing here publishes, and nothing
        // here POSTs — doing either would be a second author for one decision.
        await addToolApprovalResponse({ id: approvalId, approved });
      } catch (cause) {
        const nextError = toError(cause);
        bootstrap.reportCommandError(nextError);
        throw nextError;
      }
    },
    [addToolApprovalResponse, bootstrap, transportError]
  );

  return {
    status: bootstrap.status,
    error: bootstrap.error,
    streamStatus: transportError ? "closed" : bootstrap.realtime.status,
    streamError: transportError ? new Error(transportError.message) : bootstrap.realtime.error,
    commandError: bootstrap.commandError ?? chat.error ?? null,
    thread: bootstrap.thread,
    timeline: panel.timeline,
    childRuns,
    turnFailure: panel.turnFailure,
    activeRun: panel.activeRun,
    isRunning: inFlight,
    stalled,
    queuedCount,
    submitting,
    cancelling,
    policyUpdating: bootstrap.policyUpdating,
    hasEarlierTurns: bootstrap.hasEarlierTurns,
    loadingEarlierTurns: bootstrap.loadingEarlierTurns,
    loadEarlierTurns: bootstrap.loadEarlierTurns,
    retry: bootstrap.retry,
    clearCommandError: bootstrap.clearCommandError,
    submit,
    uploadAttachment: bootstrap.uploadAttachment,
    cancelActiveRun,
    updatePermissionMode: bootstrap.updatePermissionMode,
    respondToToolApproval,
    startNewConversation: bootstrap.startNewConversation,
  };
}

/**
 * The same surface with no channel behind it.
 *
 * Renders the persisted transcript and refuses every write. This is what the
 * panel shows while the grant is in flight, and what the first-open hero and
 * the closed-panel failure notice read before the creator has ever opened
 * StoryOS.
 */
export function useDisconnectedStoryStudioAgentSession(
  bootstrap: StoryStudioAgentBootstrap
): StoryStudioAgentSession {
  const panel = useMemo(
    () =>
      projectStudioAgentPanel({
        history: bootstrap.history,
        messages: bootstrap.history.messages,
        wireRuns: [],
      }),
    [bootstrap.history]
  );
  const refuse = useCallback(async () => {
    throw new Error("The Studio Agent conversation is not connected.");
  }, []);

  return {
    // Available even disconnected, on purpose: a thread whose realtime grant
    // never resolved is exactly one a creator may want to abandon.
    startNewConversation: bootstrap.startNewConversation,
    status: bootstrap.status,
    error: bootstrap.error,
    streamStatus: bootstrap.realtime.status,
    streamError: bootstrap.realtime.error,
    commandError: bootstrap.commandError,
    thread: bootstrap.thread,
    timeline: panel.timeline,
    childRuns: panel.activeRun ? selectStudioAgentChildRuns(panel, panel.activeRun.id) : [],
    turnFailure: panel.turnFailure,
    activeRun: panel.activeRun,
    isRunning: panel.activeRun !== null,
    // A disconnected panel has no channel to be silent on: the grant has not
    // resolved, so "no channel activity" is the normal state, not a stall.
    stalled: false,
    queuedCount: 0,
    submitting: false,
    cancelling: false,
    policyUpdating: bootstrap.policyUpdating,
    hasEarlierTurns: bootstrap.hasEarlierTurns,
    loadingEarlierTurns: bootstrap.loadingEarlierTurns,
    loadEarlierTurns: bootstrap.loadEarlierTurns,
    retry: bootstrap.retry,
    clearCommandError: bootstrap.clearCommandError,
    submit: async () => false,
    uploadAttachment: bootstrap.uploadAttachment,
    cancelActiveRun: refuse,
    updatePermissionMode: bootstrap.updatePermissionMode,
    respondToToolApproval: refuse,
  };
}

/** The channel name for a thread, so the provider and the token agree. */
export function storyStudioAgentChannel(threadId: string): string {
  return studioAgentThreadChannel(threadId);
}

/**
 * Live `RunInfo` for the visible window.
 *
 * Reads `session.view` directly rather than through `useView`, deliberately:
 * `useMessageSync`'s backward walk owns that view's pagination, and a second
 * paginator crossing the seam would reintroduce the duplicate it exists to
 * avoid. `runs()` and the `run` / `update` subscriptions page nothing.
 */
function useStudioAgentWireRuns(session: StudioAgentClientSession | null): RunInfo[] {
  // Seeded from the view rather than from `[]`: the revalidation token is
  // derived from these, and a first paint that reported "no runs" followed
  // immediately by "one active run" would read as the channel having moved and
  // send the panel to the server for a control plane that had not changed.
  const [runs, setRuns] = useState<RunInfo[]>(() => session?.view.runs() ?? []);
  useEffect(() => {
    if (!session) return;
    const view = session.view;
    const read = () => setRuns(view.runs());
    read();
    const offRun = view.on("run", read);
    const offUpdate = view.on("update", read);
    return () => {
      offRun();
      offUpdate();
    };
  }, [session]);
  // With no session there is no wire, so there are no wire runs — derived
  // rather than written, so a torn-down session cannot leave the composer
  // locked on a run nobody is watching any more.
  return session ? runs : NO_WIRE_RUNS;
}

function composeParts(
  text: string,
  attachments: readonly StoryStudioAgentAttachment[]
): StudioAgentUIMessage["parts"] {
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...attachments.map(studioAgentAttachmentPart),
  ];
}

function storyScope({
  projectId,
  chapterId,
  workspaceId,
}: StoryStudioAgentScope): StudioAgentThreadScope {
  return {
    workspaceId,
    container: {
      resourceType: "story.project" as const,
      resourceId: projectId,
      revision: null,
    },
    focus: chapterId
      ? {
          resourceType: "story.chapter" as const,
          resourceId: chapterId,
          revision: null,
        }
      : null,
  };
}

function applyPolicy(
  threadRef: { current: StudioAgentThread | null },
  replaceThread: (next: StudioAgentThread) => void,
  expectedThreadId: string,
  permissionPolicy: StudioAgentPermissionPolicy
): void {
  const latestThread = threadRef.current;
  if (latestThread?.threadId === expectedThreadId) {
    replaceThread({ ...latestThread, permissionPolicy });
  }
}

function assertSnapshotScope(
  snapshotThread: StudioAgentThread,
  resolvedThread: StudioAgentThread,
  projectId: string,
  workspaceId: string
): void {
  if (snapshotThread.threadId !== resolvedThread.threadId) {
    throw new Error("Studio Agent snapshot does not match the resolved thread.");
  }
  if (
    snapshotThread.surfaceId !== STORY_SURFACE_ID ||
    snapshotThread.scenario.id !== STORY_SCENARIO.id ||
    snapshotThread.scenario.version !== STORY_SCENARIO.version
  ) {
    throw new Error("Studio Agent resolved an incompatible Story Studio scenario.");
  }
  if (
    snapshotThread.scope.workspaceId !== workspaceId ||
    snapshotThread.scope.container.resourceType !== "story.project" ||
    snapshotThread.scope.container.resourceId !== projectId
  ) {
    throw new Error("Studio Agent snapshot does not match the active story project.");
  }
  if (snapshotThread.scope.focus !== null || resolvedThread.scope.focus !== null) {
    throw new Error("Studio Agent conversation identity must not contain mutable chapter focus.");
  }
}

export function isAmbiguousSubmitFailure(cause: unknown): boolean {
  if (!(cause instanceof ApiRequestError)) return true;
  return (
    cause.status === 0 ||
    cause.status === 408 ||
    cause.status === 425 ||
    cause.status === 429 ||
    cause.status >= 500
  );
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export type { ClientSession as StudioAgentTransportSession };
