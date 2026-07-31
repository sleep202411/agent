"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useChat } from "@ai-sdk/react";
import { useChatTransport, useMessageSync } from "@ably/ai-transport/vercel/react";
import type { ClientSession, RunInfo } from "@ably/ai-transport/react";
import { createUIMessageCodec } from "@ably/ai-transport/vercel";
import type {
  AgentCancellationResult,
  AgentConversationGrant,
  AgentInvocationAccepted,
  AgentInvocationStatus,
} from "@repo/shared/agent-platform";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type ChatTransport as SdkChatTransport,
  type UITools,
} from "ai";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";

import type { StudioAgentAttachmentUploadLease } from "@/components/studio-agent";
import { STUDIO_AGENT_DOCUMENT_MEDIA_TYPES } from "@/components/studio-agent";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  AgentPlatformApiClient,
  EMPTY_STUDIO_AGENT_HISTORY_SEED,
  createStudioAgentHistorySeed,
  prependStudioAgentHistorySeed,
  projectStudioAgentPanel,
  reconcileStudioAgentMessages,
  refreshStudioAgentHistorySeed,
  selectStudioAgentChildRuns,
  selectStudioAgentDocumentAttachmentIds,
  studioAgentRealtimeUnavailableError,
  studioAgentAttachmentFilePart,
  studioAgentAttachmentPart,
  useStudioAgentDocumentAnalysis,
  useStudioAgentRealtime,
  waitForAgentAttachmentReady,
  type StudioAgentAttachment,
  type StudioAgentDocumentAnalysisMap,
  type StudioAgentCanvasPreviewPart,
  type StudioAgentDataParts,
  type StudioAgentDeliveryMode,
  type StudioAgentFailedRunView,
  type StudioAgentHistorySeed,
  type StudioAgentMessageMetadata,
  type StudioAgentPermissionMode,
  type StudioAgentRunView,
  type StudioAgentStreamStatus,
  type StudioAgentTimelineItemView,
  type StudioAgentUIMessage,
} from "@/lib/studio-agent";

import { matchesStoryProjectionQueryKey } from "./story-canvas-edit-policy";

const STUDIO_AGENT_STALL_NOTICE_MS = 120_000;
const HISTORY_PAGE_SIZE = 50;
const INVOCATION_STATUS_PAGE_SIZE = 50;
const INVOCATION_TERMINAL_WINDOW_SIZE = 100;
const INVOCATION_PRE_WIRE_RECONCILE_MS = 2_000;
const INVOCATION_LIVE_WIRE_RECONCILE_MS = 15_000;
const NO_WIRE_RUNS: RunInfo[] = [];
const codec = createUIMessageCodec<StudioAgentMessageMetadata, StudioAgentDataParts, UITools>();

type SessionStatus = "loading" | "ready" | "error";
type StudioAgentClientSession = ReturnType<typeof useChatTransport>["session"];
type StudioAgentClientRun = Awaited<ReturnType<StudioAgentClientSession["view"]["send"]>>;

interface TrackedClientRun {
  conversationKey: string;
  messageId: string;
  delivery: StudioAgentDeliveryMode;
  handle: StudioAgentClientRun;
  invocationId: string | null;
  cancelRequested: boolean;
}

export type StoryStudioAgentAttachment = StudioAgentAttachment;

export interface StoryStudioAgentScope {
  projectId: string;
  chapterId: string | null;
  workspaceId: string;
}

export interface StoryStudioAgentConversation {
  threadId: string;
  permissionPolicy: {
    mode: StudioAgentPermissionMode;
  };
}

export interface StoryStudioAgentBootstrap extends StoryStudioAgentScope {
  locale: string;
  status: SessionStatus;
  error: Error | null;
  thread: StoryStudioAgentConversation | null;
  history: StudioAgentHistorySeed;
  invocations: readonly AgentInvocationStatus[];
  /**
   * Live document-analysis state for this conversation's attachments.
   *
   * Tracked here rather than in the panel session because the job starts the
   * moment ingest finishes — before the prompt is even sent — and outlives
   * both the composer chip and any single turn.
   */
  documentAnalysis: StudioAgentDocumentAnalysisMap;
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
  refreshHistory: () => void;
  refreshInvocations: () => void;
  invoke: (input: {
    inputEventId: string;
    clientMessageId: string;
    continuationOfInvocationId?: string;
  }) => Promise<AgentInvocationAccepted>;
  /** `null` when no conversation is resolved and the cancel never left the client. */
  requestDurableCancel: (invocationId: string) => Promise<AgentCancellationResult | null>;
  startNewConversation: () => Promise<void>;
  uploadAttachment: (
    file: File,
    context: {
      signal: AbortSignal;
      onProgress: (percent: number) => void;
      onProcessing?: (percent: number) => void;
    }
  ) => Promise<StudioAgentAttachmentUploadLease>;
  updatePermissionMode: (mode: StudioAgentPermissionMode) => Promise<void>;
}

export interface StoryStudioAgentSession {
  startNewConversation: () => Promise<void>;
  status: SessionStatus;
  error: Error | null;
  streamStatus: StudioAgentStreamStatus;
  streamError: Error | null;
  commandError: Error | null;
  thread: StoryStudioAgentConversation | null;
  timeline: StudioAgentTimelineItemView[];
  /** Live document-analysis state for this conversation's attachments. */
  documentAnalysis: StudioAgentDocumentAnalysisMap;
  childRuns: StudioAgentRunView[];
  turnFailure: StudioAgentFailedRunView | null;
  activeRun: StudioAgentRunView | null;
  activeCanvasPreview: StudioAgentCanvasPreviewPart | null;
  /** Whether this client owns a live Run handle that can be steered safely. */
  canSteer: boolean;
  isRunning: boolean;
  queuedCount: number;
  submitting: boolean;
  cancelling: boolean;
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
  respondToToolApproval: (approvalId: string, approved: boolean) => Promise<void>;
  /** Product lifecycle, not the earlier Ably suspend, opens the approval gate. */
  canRespondToToolApproval: (runId: string | null) => boolean;
  /** Retry a durably rejected outbox attempt against its original Ably input. */
  retryRejectedAttempt: (runId: string) => Promise<boolean>;
  /** Present only while an unresolved continuation admission can be retried. */
  commandErrorRetry: (() => Promise<void>) | null;
}

export function useStoryStudioAgentBootstrap({
  projectId,
  chapterId,
  workspaceId,
  active,
}: StoryStudioAgentScope & { active: boolean }): StoryStudioAgentBootstrap {
  const locale = useLocale();
  const apiClient = useMemo(
    () => new AgentPlatformApiClient({ workspaceId, locale }),
    [locale, workspaceId]
  );
  const [retryToken, setRetryToken] = useState(0);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [error, setError] = useState<Error | null>(null);
  const [commandError, setCommandError] = useState<Error | null>(null);
  const [grant, setGrant] = useState<AgentConversationGrant | null>(null);
  const [history, setHistory] = useState<StudioAgentHistorySeed>(EMPTY_STUDIO_AGENT_HISTORY_SEED);
  const [invocations, setInvocations] = useState<readonly AgentInvocationStatus[]>([]);
  // Documents registered by this mount. The transcript only learns about an
  // attachment once its prompt is durable, but the analysis behind it starts at
  // ingest — so the chip would otherwise sit on "Ready" saying nothing.
  const [uploadedDocumentIds, setUploadedDocumentIds] = useState<readonly string[]>([]);
  const [loadingEarlierTurns, setLoadingEarlierTurns] = useState(false);
  const [policyUpdating, setPolicyUpdating] = useState(false);

  const grantRef = useRef<AgentConversationGrant | null>(null);
  const historyRef = useRef(history);
  const invocationsRef = useRef<readonly AgentInvocationStatus[]>(invocations);
  const invocationRevisionRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const earlierTokenRef = useRef<symbol | null>(null);
  const refreshRunningRef = useRef(false);
  const refreshRequestedRef = useRef(false);
  const invocationRefreshRunningRef = useRef(false);
  const invocationRefreshRequestedRef = useRef(false);
  const permissionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const permissionTokensRef = useRef(new Set<symbol>());

  const replaceGrant = useCallback((next: AgentConversationGrant | null) => {
    grantRef.current = next;
    setGrant(next);
  }, []);
  const replaceHistory = useCallback((next: StudioAgentHistorySeed) => {
    historyRef.current = next;
    setHistory(next);
  }, []);
  const replaceInvocations = useCallback((next: readonly AgentInvocationStatus[]) => {
    invocationsRef.current = next;
    setInvocations(next);
  }, []);

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const controller = new AbortController();
    loadAbortRef.current?.abort();
    loadAbortRef.current = controller;
    grantRef.current = null;
    historyRef.current = EMPTY_STUDIO_AGENT_HISTORY_SEED;
    invocationsRef.current = [];
    invocationRevisionRef.current = null;
    earlierTokenRef.current = null;
    refreshRunningRef.current = false;
    refreshRequestedRef.current = false;
    invocationRefreshRunningRef.current = false;
    invocationRefreshRequestedRef.current = false;
    permissionQueueRef.current = Promise.resolve();
    permissionTokensRef.current.clear();

    queueMicrotask(() => {
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      setStatus("loading");
      setError(null);
      setCommandError(null);
      setGrant(null);
      setHistory(EMPTY_STUDIO_AGENT_HISTORY_SEED);
      setUploadedDocumentIds([]);
      replaceInvocations([]);
      setLoadingEarlierTurns(false);
      setPolicyUpdating(false);
    });

    void (async () => {
      try {
        const resolved = await apiClient.resolveStoryConversation(projectId, controller.signal);
        assertStoryGrant(resolved, projectId);
        const [page, invocationPage] = await Promise.all([
          apiClient.history(resolved.conversation.id, {
            limit: HISTORY_PAGE_SIZE,
            signal: controller.signal,
          }),
          apiClient.invocationStatus(resolved.conversation.id, {
            limit: INVOCATION_STATUS_PAGE_SIZE,
            signal: controller.signal,
          }),
        ]);
        const seed = await createStudioAgentHistorySeed(page);
        if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
        replaceGrant(resolved);
        replaceHistory(seed);
        invocationRevisionRef.current = invocationPage.revision;
        replaceInvocations(invocationPage.invocations);
        setStatus("ready");
      } catch (cause) {
        if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
        setError(toError(cause));
        setStatus("error");
      }
    })();

    return () => controller.abort();
  }, [apiClient, projectId, replaceGrant, replaceHistory, replaceInvocations, retryToken]);

  const conversationId = grant?.conversation.id ?? null;
  const authorize = useCallback(() => {
    const current = grantRef.current;
    if (!current) return Promise.reject(new Error("No Agent conversation is resolved."));
    return apiClient.authorizeConversation(current.conversation.id);
  }, [apiClient]);
  const realtime = useStudioAgentRealtime({
    threadId: conversationId,
    enabled: status === "ready" && active,
    initialGrant: grant,
    authorize,
  });

  const refreshHistory = useCallback(() => {
    refreshRequestedRef.current = true;
    if (refreshRunningRef.current) return;
    refreshRunningRef.current = true;
    const generation = loadGenerationRef.current;

    void (async () => {
      try {
        while (refreshRequestedRef.current && generation === loadGenerationRef.current) {
          refreshRequestedRef.current = false;
          const current = grantRef.current;
          if (!current) return;
          const page = await apiClient.history(current.conversation.id, {
            limit: HISTORY_PAGE_SIZE,
            signal: loadAbortRef.current?.signal,
          });
          const window = await createStudioAgentHistorySeed(page);
          if (generation !== loadGenerationRef.current) return;
          replaceHistory(refreshStudioAgentHistorySeed(historyRef.current, window));
        }
      } catch {
        // This is channel-driven reconciliation, not a creator command. The
        // durable history remains available through retry/load on the surface.
      } finally {
        refreshRunningRef.current = false;
      }
    })();
  }, [apiClient, replaceHistory]);

  const loadEarlierTurns = useCallback(async () => {
    const current = grantRef.current;
    const cursor = historyRef.current.nextCursor;
    if (!current || !cursor || earlierTokenRef.current) return;
    const generation = loadGenerationRef.current;
    const token = Symbol("agent-history-page");
    earlierTokenRef.current = token;
    setLoadingEarlierTurns(true);
    setCommandError(null);
    try {
      const page = await apiClient.history(current.conversation.id, {
        cursor,
        limit: HISTORY_PAGE_SIZE,
        signal: loadAbortRef.current?.signal,
      });
      const older = await createStudioAgentHistorySeed(page);
      if (generation !== loadGenerationRef.current) return;
      replaceHistory(prependStudioAgentHistorySeed(historyRef.current, older));
    } catch (cause) {
      const next = toError(cause);
      if (generation === loadGenerationRef.current) setCommandError(next);
      throw next;
    } finally {
      if (earlierTokenRef.current === token) {
        earlierTokenRef.current = null;
        setLoadingEarlierTurns(false);
      }
    }
  }, [apiClient, replaceHistory]);

  const refreshInvocations = useCallback(() => {
    invocationRefreshRequestedRef.current = true;
    if (invocationRefreshRunningRef.current) return;
    invocationRefreshRunningRef.current = true;
    const generation = loadGenerationRef.current;

    void (async () => {
      try {
        while (invocationRefreshRequestedRef.current && generation === loadGenerationRef.current) {
          invocationRefreshRequestedRef.current = false;
          const current = grantRef.current;
          if (!current) return;
          let hasMore = true;
          while (hasMore && generation === loadGenerationRef.current) {
            const previousRevision = invocationRevisionRef.current;
            const page = await apiClient.invocationStatus(current.conversation.id, {
              sinceRevision: previousRevision ?? undefined,
              limit: INVOCATION_STATUS_PAGE_SIZE,
              signal: loadAbortRef.current?.signal,
            });
            if (generation !== loadGenerationRef.current) return;
            if (page.hasMore && page.revision === previousRevision) {
              throw new Error("Invocation status pagination did not advance its revision.");
            }
            invocationRevisionRef.current = page.revision;
            replaceInvocations(
              previousRevision === null
                ? page.invocations
                : mergeInvocationStatuses(invocationsRef.current, page.invocations)
            );
            hasMore = page.hasMore;
          }
        }
      } catch {
        // Ably remains the live path. The next poll or a reconnect bootstrap
        // retries the durable lifecycle projection without disrupting output.
      } finally {
        invocationRefreshRunningRef.current = false;
      }
    })();
  }, [apiClient, replaceInvocations]);

  const uploadAttachment = useCallback<StoryStudioAgentBootstrap["uploadAttachment"]>(
    async (file, context) => {
      const current = grantRef.current;
      if (!current || status !== "ready") {
        throw new Error("The Agent conversation is not ready for attachments.");
      }
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: STUDIO_AGENT_DOCUMENT_MEDIA_TYPES.some((mediaType) => mediaType === file.type)
          ? "agent_attachment_document"
          : "agent_attachment_image",
        workspaceId,
        contentType: file.type,
        signal: context.signal,
        onProgress: context.onProgress,
      });
      if (grantRef.current?.conversation.id !== current.conversation.id) {
        throw new Error("The active Agent conversation changed during upload.");
      }
      let registeredId: string | null = null;
      let leased = false;
      try {
        const registered = await apiClient.registerAttachment(
          current.conversation.id,
          uploaded.mediaAssetId,
          file.name,
          context.signal
        );
        registeredId = registered.id;
        const resolved = await waitForAgentAttachmentReady({
          initial: registered,
          signal: context.signal,
          onStatus: (summary) => {
            if (summary.status !== "processing") return;
            context.onProcessing?.(summary.ingest?.progress ?? 0);
          },
          readStatus: (signal) =>
            apiClient.attachmentStatus(current.conversation.id, registered.id, signal),
        });
        const sizeBytes = Number(resolved.sizeBytes);
        if (!Number.isSafeInteger(sizeBytes)) {
          throw new Error("The attachment size is outside the browser's safe integer range.");
        }
        const attachment: StudioAgentAttachment = {
          type: "attachment",
          attachmentId: resolved.id,
          fileName: resolved.fileName,
          mediaType: resolved.mediaType,
          sizeBytes,
          status: "ready",
        };
        let abandonment: Promise<void> | null = null;
        const lease: StudioAgentAttachmentUploadLease = {
          attachment,
          abandon() {
            setUploadedDocumentIds((tracked) => tracked.filter((id) => id !== resolved.id));
            abandonment ??= apiClient
              .revokeAttachment(current.conversation.id, resolved.id)
              .then(() => undefined);
            return abandonment;
          },
        };
        if (
          context.signal.aborted ||
          grantRef.current?.conversation.id !== current.conversation.id
        ) {
          void Promise.resolve(lease.abandon()).catch(() => undefined);
          throw new Error("The active Agent conversation changed during registration.");
        }
        if (!resolved.mediaType.startsWith("image/")) {
          setUploadedDocumentIds((tracked) =>
            tracked.includes(resolved.id) ? tracked : [...tracked, resolved.id]
          );
        }
        leased = true;
        return lease;
      } catch (cause) {
        if (registeredId && !leased) {
          void apiClient
            .revokeAttachment(current.conversation.id, registeredId)
            .catch(() => undefined);
        }
        throw cause;
      }
    },
    [apiClient, status, workspaceId]
  );

  const updatePermissionMode = useCallback(
    async (mode: StudioAgentPermissionMode) => {
      const current = grantRef.current;
      if (!current || current.conversation.permissionMode === mode) return;
      const token = Symbol("agent-permission-update");
      permissionTokensRef.current.add(token);
      setPolicyUpdating(true);
      setCommandError(null);
      const queued = permissionQueueRef.current.then(async () => {
        const latest = grantRef.current;
        if (!latest || latest.conversation.id !== current.conversation.id) {
          throw new Error("The active Agent conversation changed.");
        }
        const updated = await apiClient.updatePermissionMode(latest.conversation.id, mode);
        if (grantRef.current?.conversation.id === updated.conversation.id) replaceGrant(updated);
      });
      permissionQueueRef.current = queued.then(
        () => undefined,
        () => undefined
      );
      try {
        await queued;
      } catch (cause) {
        const next = toError(cause);
        setCommandError(next);
        throw next;
      } finally {
        permissionTokensRef.current.delete(token);
        setPolicyUpdating(permissionTokensRef.current.size > 0);
      }
    },
    [apiClient, replaceGrant]
  );

  const startNewConversation = useCallback(async () => {
    const current = grantRef.current;
    if (!current) return;
    setCommandError(null);
    try {
      const created = await apiClient.createStoryConversation(
        projectId,
        current.conversation.permissionMode
      );
      assertStoryGrant(created, projectId);
      replaceGrant(created);
      replaceHistory(EMPTY_STUDIO_AGENT_HISTORY_SEED);
      // The lifecycle projection is conversation-scoped but its cursor is a
      // table-wide sequence. Carrying either across would show the previous
      // conversation's runs (and its pinned failure) under an empty thread, and
      // every status poll would 400 on a revision this conversation never had.
      replaceInvocations([]);
      invocationRevisionRef.current = null;
      setStatus("ready");
    } catch (cause) {
      const next = toError(cause);
      setCommandError(next);
      throw next;
    }
  }, [apiClient, projectId, replaceGrant, replaceHistory, replaceInvocations]);

  const invoke = useCallback<StoryStudioAgentBootstrap["invoke"]>(
    async (invocation) => {
      const current = grantRef.current;
      if (!current) throw new Error("The Agent conversation is not resolved.");
      return apiClient.invoke({
        conversationId: current.conversation.id,
        sessionName: current.sessionName,
        ...invocation,
      });
    },
    [apiClient]
  );

  const requestDurableCancel = useCallback<StoryStudioAgentBootstrap["requestDurableCancel"]>(
    async (invocationId) => {
      const current = grantRef.current;
      if (!current) return null;
      return apiClient.cancel(current.conversation.id, invocationId);
    },
    [apiClient]
  );

  const thread = useMemo<StoryStudioAgentConversation | null>(
    () =>
      grant
        ? {
            threadId: grant.conversation.id,
            permissionPolicy: { mode: grant.conversation.permissionMode },
          }
        : null,
    [grant]
  );

  const readAttachmentStatus = useCallback(
    (attachmentId: string, signal: AbortSignal) => {
      const current = grantRef.current;
      if (!current) {
        return Promise.reject(new Error("The Agent conversation is not resolved."));
      }
      return apiClient.attachmentStatus(current.conversation.id, attachmentId, signal);
    },
    [apiClient]
  );
  const trackedDocumentIds = useMemo(() => {
    const ids = new Set([
      ...selectStudioAgentDocumentAttachmentIds(history.messages),
      ...uploadedDocumentIds,
    ]);
    return [...ids].sort();
  }, [history.messages, uploadedDocumentIds]);
  const documentAnalysis = useStudioAgentDocumentAnalysis({
    attachmentIds: trackedDocumentIds,
    readStatus: readAttachmentStatus,
  });

  return {
    projectId,
    chapterId,
    workspaceId,
    locale,
    status,
    error,
    thread,
    history,
    invocations,
    documentAnalysis,
    conversationKey: grant?.conversation.id ?? `pending:${retryToken}`,
    realtime,
    hasEarlierTurns: history.nextCursor !== null,
    loadingEarlierTurns,
    policyUpdating,
    commandError,
    clearCommandError: useCallback(() => setCommandError(null), []),
    reportCommandError: useCallback((next: Error | null) => setCommandError(next), []),
    retry: useCallback(() => setRetryToken((current) => current + 1), []),
    loadEarlierTurns,
    refreshHistory,
    refreshInvocations,
    invoke,
    requestDurableCancel,
    startNewConversation,
    uploadAttachment,
    updatePermissionMode,
  };
}

export function useStoryStudioAgentSession(
  bootstrap: StoryStudioAgentBootstrap
): StoryStudioAgentSession {
  const queryClient = useQueryClient();
  const { session, chatTransport, sessionError, chatTransportError } = useChatTransport();
  const transportError = sessionError ?? chatTransportError ?? null;
  const incomingSeed = bootstrap.history.messages;
  const [heldSeed, setHeldSeed] = useState<{
    key: string;
    messages: StudioAgentUIMessage[];
  }>({ key: bootstrap.conversationKey, messages: incomingSeed });
  const adopt =
    heldSeed.key !== bootstrap.conversationKey ||
    (seamOf(incomingSeed) === seamOf(heldSeed.messages) &&
      incomingSeed.length > heldSeed.messages.length);
  if (adopt) {
    setHeldSeed({ key: bootstrap.conversationKey, messages: incomingSeed });
  }
  const seededMessages = adopt ? incomingSeed : heldSeed.messages;

  const chat = useChat<StudioAgentUIMessage>({
    id: bootstrap.conversationKey,
    messages: seededMessages,
    transport: chatTransport as unknown as SdkChatTransport<StudioAgentUIMessage>,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const {
    messages,
    setMessages,
    status: chatStatus,
    stop,
    addToolApprovalResponse,
    clearError: clearChatError,
  } = chat;
  useMessageSync<StudioAgentMessageMetadata, StudioAgentDataParts, UITools>({
    setMessages,
    messages: seededMessages,
  });
  const reconciledMessages = useMemo(() => reconcileStudioAgentMessages(messages), [messages]);
  const overlayHasOverlap = reconciledMessages.length !== messages.length;
  useEffect(() => {
    // Never rewrite useChat's overlay while its own writer owns the stream.
    // Once the writer settles, collapse any reconnect/history seam overlap so
    // the next model turn cannot inherit duplicated context.
    if (!overlayHasOverlap || chatStatus !== "ready") return;
    setMessages(reconciledMessages);
  }, [chatStatus, overlayHasOverlap, reconciledMessages, setMessages]);

  const wire = useStudioAgentWireState(transportError ? null : session);
  const invocationByClientMessageId = useMemo(
    () =>
      new Map(bootstrap.invocations.map((invocation) => [invocation.clientMessageId, invocation])),
    [bootstrap.invocations]
  );
  const projectedMessages = useMemo(
    () =>
      reconciledMessages.map((message) => {
        const persistedRunId = message.metadata?.runId;
        const run = wire.runByMessageId.get(message.id);
        // The product invocation is reserved with the creator UIMessage's id
        // as `clientMessageId`. Ably carries our metadata while the message is
        // live, but Mastra's durable replay may contain only the canonical
        // message id. Treat that id as the durable join key for creator
        // messages; otherwise a reload turns their failed Runs into orphans and
        // appends every old failure to the bottom of the conversation.
        const clientMessageId =
          message.metadata?.clientMessageId ?? (message.role === "user" ? message.id : null);
        const durableRun = clientMessageId
          ? invocationByClientMessageId.get(clientMessageId)
          : undefined;
        const historicalRun =
          message.role === "assistant" && !persistedRunId
            ? invocationForHistoricalAssistantMessage(message, bootstrap.invocations)
            : undefined;
        const runId = persistedRunId ?? run?.runId ?? durableRun?.runId ?? historicalRun?.runId;
        if (!runId) return message;
        return {
          ...message,
          metadata: {
            ...message.metadata,
            runId,
          },
        };
      }),
    [bootstrap.invocations, invocationByClientMessageId, reconciledMessages, wire.runByMessageId]
  );

  const { reportCommandError } = bootstrap;
  useEffect(() => {
    if (transportError) return;
    return session.on("error", () => reportCommandError(studioAgentRealtimeUnavailableError()));
  }, [reportCommandError, session, transportError]);

  const [pending, setPending] = useState<StudioAgentUIMessage[]>([]);
  const messageIds = useMemo(
    () => new Set(projectedMessages.map((message) => message.id)),
    [projectedMessages]
  );
  const currentConversationId = bootstrap.thread?.threadId ?? null;
  const visiblePending = useMemo(
    () =>
      currentConversationId
        ? pending.filter(
            (message) =>
              message.metadata?.conversationId === currentConversationId &&
              !messageIds.has(message.id)
          )
        : [],
    [currentConversationId, messageIds, pending]
  );
  const projectedPending = useMemo(
    () =>
      visiblePending.map((message) => {
        const clientMessageId = message.metadata?.clientMessageId;
        const runId = clientMessageId
          ? invocationByClientMessageId.get(clientMessageId)?.runId
          : undefined;
        if (!runId) return message;
        return {
          ...message,
          metadata: {
            ...message.metadata,
            runId,
          },
        };
      }),
    [invocationByClientMessageId, visiblePending]
  );
  const durableRuns = useMemo(
    () => bootstrap.invocations.map(invocationStatusToRunView),
    [bootstrap.invocations]
  );
  const panel = useMemo(
    () =>
      projectStudioAgentPanel({
        history: {
          ...bootstrap.history,
          runs: durableRuns,
        },
        messages: projectedMessages,
        wireRuns: wire.runs,
        pending: projectedPending,
      }),
    [bootstrap.history, durableRuns, projectedMessages, projectedPending, wire.runs]
  );
  const canRespondToToolApproval = useCallback(
    (runId: string | null) =>
      runId !== null &&
      bootstrap.invocations.some(
        (invocation) =>
          invocation.runId === runId &&
          invocation.status === "waiting_for_approval" &&
          invocation.latestAttempt.status === "dispatched"
      ),
    [bootstrap.invocations]
  );
  const rejectedContinuation = useMemo(
    () =>
      bootstrap.invocations.findLast(
        (invocation) =>
          invocation.status === "waiting_for_approval" &&
          invocation.latestAttempt.ordinal > 0 &&
          invocation.latestAttempt.status === "rejected"
      ) ?? null,
    [bootstrap.invocations]
  );
  const rejectedAttemptId = rejectedContinuation?.latestAttempt.attemptId ?? null;
  const rejectedAttemptMessage = rejectedContinuation?.latestAttempt.error?.message ?? null;
  const rejectedConversationKey = bootstrap.conversationKey;
  const rejectedAttemptCommand = useMemo(() => {
    if (!rejectedAttemptId || !rejectedAttemptMessage) return null;
    const error = new Error(rejectedAttemptMessage);
    error.name = "AgentContinuationAdmissionError";
    return {
      conversationKey: rejectedConversationKey,
      attemptId: rejectedAttemptId,
      error,
    };
  }, [rejectedAttemptId, rejectedAttemptMessage, rejectedConversationKey]);
  const reportedRejectedAttemptRef = useRef<{
    conversationKey: string;
    attemptId: string;
  } | null>(null);
  useEffect(() => {
    if (!rejectedAttemptCommand) return;
    const reported = reportedRejectedAttemptRef.current;
    if (
      reported?.conversationKey === rejectedAttemptCommand.conversationKey &&
      reported.attemptId === rejectedAttemptCommand.attemptId
    ) {
      return;
    }
    reportedRejectedAttemptRef.current = {
      conversationKey: rejectedAttemptCommand.conversationKey,
      attemptId: rejectedAttemptCommand.attemptId,
    };
    bootstrap.reportCommandError(rejectedAttemptCommand.error);
  }, [bootstrap, rejectedAttemptCommand]);
  const childRuns = useMemo(
    () => (panel.activeRun ? selectStudioAgentChildRuns(panel, panel.activeRun.id) : []),
    [panel]
  );

  const { refreshHistory, refreshInvocations } = bootstrap;
  const settledRevalidationRef = useRef<string | null>(null);
  useEffect(() => {
    if (settledRevalidationRef.current === panel.revalidationToken) return;
    const first = settledRevalidationRef.current === null;
    settledRevalidationRef.current = panel.revalidationToken;
    if (!first) {
      refreshHistory();
      refreshInvocations();
    }
  }, [panel.revalidationToken, refreshHistory, refreshInvocations]);

  const settledReconcileRef = useRef<string | null>(null);
  const reconcileToken = `${bootstrap.history.writeToken}#${panel.turnTerminalToken ?? ""}`;
  useEffect(() => {
    if (settledReconcileRef.current === reconcileToken) return;
    const first = settledReconcileRef.current === null;
    settledReconcileRef.current = reconcileToken;
    if (first) return;
    void queryClient.invalidateQueries({
      predicate: (query) => matchesStoryProjectionQueryKey(query.queryKey, bootstrap.projectId),
    });
  }, [bootstrap.projectId, queryClient, reconcileToken]);

  const [submitting, setSubmitting] = useState(false);
  const activeRunId = panel.activeRun?.id ?? null;
  const trackedRunsRef = useRef(new Map<string, TrackedClientRun>());
  const [trackedRunsSnapshot, setTrackedRunsSnapshot] = useState<TrackedClientRun[]>([]);
  const publishTrackedRuns = useCallback(
    () => setTrackedRunsSnapshot([...trackedRunsRef.current.values()]),
    []
  );

  const trackRun = useCallback(
    (messageId: string, delivery: StudioAgentDeliveryMode, handle: StudioAgentClientRun) => {
      for (const [trackedMessageId, tracked] of trackedRunsRef.current) {
        if (
          tracked.conversationKey !== bootstrap.conversationKey ||
          tracked.handle.status === "complete" ||
          tracked.handle.status === "cancelled" ||
          tracked.handle.status === "error"
        ) {
          trackedRunsRef.current.delete(trackedMessageId);
        }
      }
      const entry: TrackedClientRun = {
        conversationKey: bootstrap.conversationKey,
        messageId,
        delivery,
        handle,
        invocationId: null,
        cancelRequested: false,
      };
      trackedRunsRef.current.set(messageId, entry);
      publishTrackedRuns();
      void handle.started.then(publishTrackedRuns, publishTrackedRuns);
      return entry;
    },
    [bootstrap.conversationKey, publishTrackedRuns]
  );

  const terminalInvocationIds = new Set(
    bootstrap.invocations.flatMap((invocation) =>
      invocation.status === "succeeded" ||
      invocation.status === "failed" ||
      invocation.status === "cancelled"
        ? [invocation.invocationId]
        : []
    )
  );
  const trackedRuns = trackedRunsSnapshot.filter((entry) => {
    if (entry.conversationKey !== bootstrap.conversationKey) return false;
    if (entry.invocationId) return !terminalInvocationIds.has(entry.invocationId);
    return !isClientRunTerminal(entry.handle);
  });
  const liveTrackedRuns = trackedRuns.filter((entry) => !isClientRunTerminal(entry.handle));
  const activeClientRun =
    activeRunId === null
      ? null
      : (liveTrackedRuns.find((entry) => entry.handle.runId === activeRunId) ?? null);
  const pendingRootRun =
    activeRunId === null
      ? (liveTrackedRuns.find((entry) => entry.handle.runId === "") ?? null)
      : null;
  const locallyAdmittedRun = trackedRuns.find((entry) => entry.invocationId !== null) ?? null;
  const nonterminalInvocations = bootstrap.invocations.filter(
    (invocation) =>
      invocation.status !== "succeeded" &&
      invocation.status !== "failed" &&
      invocation.status !== "cancelled"
  );
  // Stop means "stop the turn producing output". `panel.activeRun` is the
  // NEWEST non-terminal root run, so an enqueued follow-up outranks the turn
  // the creator is watching the moment one exists — stopping that would destroy
  // a prompt that never ran and leave the visible turn streaming. The running
  // invocation is the target whenever there is one.
  const runningInvocation =
    nonterminalInvocations.find(
      (invocation) =>
        invocation.status === "running" || invocation.status === "waiting_for_approval"
    ) ?? null;
  const activeDurableInvocation =
    runningInvocation ??
    nonterminalInvocations.find((invocation) => invocation.runId === activeRunId) ??
    (nonterminalInvocations.length === 1 ? nonterminalInvocations[0] : null);
  const cancelTargetRunId = runningInvocation?.runId ?? activeRunId;
  const cancelTargetClientRun =
    cancelTargetRunId === null
      ? null
      : (liveTrackedRuns.find((entry) => entry.handle.runId === cancelTargetRunId) ?? null);
  const activeInvocationId =
    activeDurableInvocation?.invocationId ??
    activeClientRun?.invocationId ??
    pendingRootRun?.invocationId ??
    locallyAdmittedRun?.invocationId ??
    null;
  const inFlight =
    activeRunId !== null ||
    pendingRootRun !== null ||
    locallyAdmittedRun !== null ||
    chatStatus === "submitted" ||
    chatStatus === "streaming";
  const queuedCount = new Set([
    ...visiblePending.flatMap((message) =>
      message.metadata?.delivery === "enqueue" ? [message.id] : []
    ),
    ...trackedRuns.flatMap((entry) =>
      entry.delivery === "enqueue" && entry.handle.runId === "" ? [entry.messageId] : []
    ),
  ]).size;
  /**
   * The Stop the creator asked for, and the one invocation it answers for.
   *
   * The id can still be unknown at the click, because admission is async —
   * that is the only reason this is latched at all. It never moves on: a
   * follow-up the creator enqueued behind the stopped turn is a different turn,
   * and inheriting the Stop would destroy a prompt that never ran.
   */
  const [cancelTarget, setCancelTarget] = useState<{ invocationId: string | null } | null>(null);
  const lateCancelRef = useRef<string | null>(null);
  const cancelling =
    cancelTarget !== null &&
    inFlight &&
    (cancelTarget.invocationId === null || cancelTarget.invocationId === activeInvocationId);
  const durableCancellationRef = useRef(new Set<string>());

  useEffect(() => {
    durableCancellationRef.current.clear();
    lateCancelRef.current = null;
  }, [bootstrap.conversationKey]);

  const requestDurableCancellationById = useCallback(
    async (invocationId: string | null | undefined) => {
      if (!invocationId || durableCancellationRef.current.has(invocationId)) return undefined;
      durableCancellationRef.current.add(invocationId);
      try {
        const result = await bootstrap.requestDurableCancel(invocationId);
        // `not-active` means nothing durable saw the Stop: the invocation is
        // still in the admission outbox and will be dispatched afterwards.
        // Holding the latch would make every later Stop a permanent no-op.
        if (result?.status === "not-active") durableCancellationRef.current.delete(invocationId);
        return result?.status;
      } catch (cause) {
        durableCancellationRef.current.delete(invocationId);
        bootstrap.reportCommandError(toError(cause));
        return undefined;
      }
    },
    [bootstrap]
  );
  const requestDurableCancellation = useCallback(
    () => requestDurableCancellationById(activeInvocationId),
    [activeInvocationId, requestDurableCancellationById]
  );

  const requestTrackedRunCancellation = useCallback(
    async (entry: TrackedClientRun | null) => {
      if (!entry) return;
      entry.cancelRequested = true;
      const durableCancellation = requestDurableCancellationById(entry.invocationId);
      requestRealtimeCancellation(() => entry.handle.cancel());
      publishTrackedRuns();
      await durableCancellation;
    },
    [publishTrackedRuns, requestDurableCancellationById]
  );

  // Completes a Stop whose invocation id only became known after the click. It
  // fires once per Stop: the first id it sees is the one that was stopped, so
  // no later turn can inherit it.
  useEffect(() => {
    if (cancelTarget === null || cancelTarget.invocationId !== null || !inFlight) return;
    if (activeInvocationId === null || lateCancelRef.current !== null) return;
    lateCancelRef.current = activeInvocationId;
    void requestDurableCancellationById(activeInvocationId);
  }, [activeInvocationId, cancelTarget, inFlight, requestDurableCancellationById]);

  const channelPulse = useMemo(() => {
    const last = projectedMessages.at(-1);
    const text =
      last?.parts.reduce(
        (total, part) => total + (part.type === "text" ? part.text.length : 0),
        0
      ) ?? 0;
    return `${projectedMessages.length}:${last?.id ?? ""}:${last?.parts.length ?? 0}:${text}`;
  }, [projectedMessages]);
  const awaitingCreator = panel.activeRun?.status === "waiting_for_approval";
  const stallWatchKey = `${inFlight}:${awaitingCreator}:${chatStatus}:${channelPulse}`;
  const [stalledAt, setStalledAt] = useState<string | null>(null);
  useEffect(() => {
    if (!inFlight || awaitingCreator) return;
    const timer = setTimeout(() => {
      setStalledAt(stallWatchKey);
      refreshHistory();
    }, STUDIO_AGENT_STALL_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [awaitingCreator, inFlight, refreshHistory, stallWatchKey]);
  const stalled = stalledAt !== null && stalledAt === stallWatchKey;

  const hasLiveWireRun = wire.runs.some(
    (run) => run.status === "active" || run.status === "suspended"
  );
  const awaitingDurableApproval = panel.timeline.some(
    (item) =>
      item.kind === "toolApproval" &&
      item.toolApproval.decision === null &&
      !canRespondToToolApproval(item.toolApproval.runId)
  );
  useEffect(() => {
    if (!inFlight) return;
    refreshInvocations();
    // Before Ably has a run, durable admission is the only source that can
    // reveal an outbox rejection, so check promptly. Once a live run exists,
    // wire lifecycle changes refresh immediately through revalidationToken and
    // this becomes only a low-frequency lost-event backstop. This avoids the
    // old one-request-per-second auth storm during every model response.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(
        () => {
          refreshInvocations();
          schedule();
        },
        hasLiveWireRun && !awaitingDurableApproval
          ? INVOCATION_LIVE_WIRE_RECONCILE_MS
          : INVOCATION_PRE_WIRE_RECONCILE_MS
      );
    };
    const resume = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        return;
      }
      refreshInvocations();
      schedule();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    schedule();
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [awaitingDurableApproval, hasLiveWireRun, inFlight, refreshInvocations]);

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
      const running = inFlight;
      if (running === (mode === "send")) {
        throw new Error("Agent delivery mode does not match the active run state.");
      }

      setSubmitting(true);
      lateCancelRef.current = null;
      setCancelTarget(null);
      // Both error latches, not just the bootstrap's: `useChat` holds its own
      // terminal error until told otherwise, and a fresh send is the creator
      // moving on — the previous turn's transport failure must not keep a
      // banner pinned over a conversation that is working again.
      clearChatError();
      bootstrap.clearCommandError();
      try {
        const clientMessageId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const parts = composeParts(normalized, attachments);

        if (mode === "steer") {
          if (!activeClientRun) {
            throw new Error(
              "This live turn was started by another session and cannot be steered from this device."
            );
          }
          const outgoing: StudioAgentUIMessage = {
            id: clientMessageId,
            role: "user",
            metadata: {
              conversationId: currentThread.threadId,
              runId: activeRunId!,
              createdAt,
              format: "plain_text",
              clientMessageId,
              delivery: "steer",
            },
            parts,
          };
          setPending((current) => [
            ...current.filter(
              (message) =>
                message.metadata?.conversationId === currentThread.threadId &&
                !messageIds.has(message.id)
            ),
            outgoing,
          ]);
          try {
            const { published, outcome } = activeClientRun.handle.steer(
              codec.createUserMessage(outgoing) as never
            );
            await published;
            void outcome.then(
              (result) => {
                if (!result.consumed) {
                  bootstrap.reportCommandError(
                    new Error(
                      "The turn ended before it consumed your steering message. Send it again as a new turn."
                    )
                  );
                }
              },
              (cause: unknown) => bootstrap.reportCommandError(toError(cause))
            );
          } catch {
            setPending((current) => current.filter((message) => message.id !== clientMessageId));
            throw studioAgentRealtimeUnavailableError();
          }
          return true;
        }

        if (mode === "stop_and_send") {
          const durableCancellation = requestDurableCancellation();
          const stopping = cancelTargetClientRun ?? pendingRootRun;
          if (stopping) {
            await requestTrackedRunCancellation(stopping);
          } else if (cancelTargetRunId) {
            requestRealtimeCancellation(() => session.cancel(cancelTargetRunId));
          }
          await stop();
          await durableCancellation;
        }

        const outgoing: StudioAgentUIMessage = {
          id: clientMessageId,
          role: "user",
          parts,
          metadata: {
            conversationId: currentThread.threadId,
            createdAt,
            format: "plain_text",
            clientMessageId,
            ...(mode === "enqueue" ? { delivery: "enqueue" as const } : {}),
          },
        };
        setPending((current) => [
          ...current.filter(
            (message) =>
              message.metadata?.conversationId === currentThread.threadId &&
              !messageIds.has(message.id)
          ),
          outgoing,
        ]);
        let tracked: TrackedClientRun | null = null;
        try {
          let handle: StudioAgentClientRun;
          try {
            handle = await session.view.send(codec.createUserMessage(outgoing) as never);
          } catch {
            throw studioAgentRealtimeUnavailableError();
          }
          tracked = trackRun(clientMessageId, mode, handle);
          const accepted = await bootstrap.invoke({
            ...handle.toInvocation().toJSON(),
            clientMessageId,
          });
          tracked.invocationId = accepted.invocationId;
          if (tracked.cancelRequested) {
            await requestDurableCancellationById(accepted.invocationId);
          }
          publishTrackedRuns();
          refreshInvocations();
        } catch (cause) {
          setPending((current) => current.filter((message) => message.id !== clientMessageId));
          if (tracked) trackedRunsRef.current.delete(tracked.messageId);
          publishTrackedRuns();
          refreshInvocations();
          throw cause;
        }
        return true;
      } catch (cause) {
        const next = toError(cause);
        bootstrap.reportCommandError(next);
        throw next;
      } finally {
        setSubmitting(false);
      }
    },
    [
      activeRunId,
      activeClientRun,
      bootstrap,
      cancelTargetClientRun,
      cancelTargetRunId,
      clearChatError,
      inFlight,
      messageIds,
      pendingRootRun,
      publishTrackedRuns,
      requestDurableCancellation,
      requestDurableCancellationById,
      requestTrackedRunCancellation,
      refreshInvocations,
      session,
      stop,
      trackRun,
      transportError,
    ]
  );

  const cancelActiveRun = useCallback(async () => {
    if (!inFlight || cancelling) return;
    lateCancelRef.current = null;
    setCancelTarget({ invocationId: activeInvocationId });
    bootstrap.clearCommandError();
    try {
      const durableCancellation = requestDurableCancellation();
      const stopping = cancelTargetClientRun ?? pendingRootRun;
      if (stopping) {
        await requestTrackedRunCancellation(stopping);
      } else if (cancelTargetRunId) {
        requestRealtimeCancellation(() => session.cancel(cancelTargetRunId));
      }
      await stop();
      const outcome = await durableCancellation;
      if (outcome === "not-active") {
        // The turn was never handed to Temporal, so this Stop did not land and
        // the outbox will dispatch it anyway. Release the control instead of
        // sitting on "Stopping…" for a turn that is about to start talking.
        lateCancelRef.current = null;
        setCancelTarget(null);
        bootstrap.reportCommandError(
          new Error("This turn had not started yet, so it could not be stopped. Try again.")
        );
      }
    } catch (cause) {
      lateCancelRef.current = null;
      setCancelTarget(null);
      const next = toError(cause);
      bootstrap.reportCommandError(next);
      throw next;
    }
  }, [
    activeInvocationId,
    bootstrap,
    cancelTargetClientRun,
    cancelTargetRunId,
    cancelling,
    inFlight,
    pendingRootRun,
    requestDurableCancellation,
    requestTrackedRunCancellation,
    session,
    stop,
  ]);

  const respondToToolApproval = useCallback<StoryStudioAgentSession["respondToToolApproval"]>(
    async (approvalId, approved) => {
      bootstrap.clearCommandError();
      if (transportError) {
        const next = studioAgentRealtimeUnavailableError();
        bootstrap.reportCommandError(next);
        throw next;
      }
      const approval = panel.timeline.find(
        (item) => item.kind === "toolApproval" && item.toolApproval.id === approvalId
      );
      if (
        !approval ||
        approval.kind !== "toolApproval" ||
        !canRespondToToolApproval(approval.toolApproval.runId)
      ) {
        throw new Error("The approval checkpoint is still becoming durable. Please wait.");
      }
      try {
        await addToolApprovalResponse({ id: approvalId, approved });
      } catch {
        const next = studioAgentRealtimeUnavailableError();
        bootstrap.reportCommandError(next);
        throw next;
      }
    },
    [addToolApprovalResponse, bootstrap, canRespondToToolApproval, panel.timeline, transportError]
  );

  const retryRejectedAttempt = useCallback<StoryStudioAgentSession["retryRejectedAttempt"]>(
    async (runId) => {
      const rejected = bootstrap.invocations.find(
        (invocation) =>
          invocation.runId === runId &&
          invocation.latestAttempt.status === "rejected" &&
          invocation.latestAttempt.error?.retryable === true
      );
      if (!rejected) return false;
      try {
        clearChatError();
        bootstrap.clearCommandError();
        const accepted = await bootstrap.invoke({
          inputEventId: rejected.latestAttempt.inputEventId,
          clientMessageId: rejected.latestAttempt.clientMessageId,
          ...(rejected.latestAttempt.ordinal > 0
            ? { continuationOfInvocationId: rejected.invocationId }
            : {}),
        });
        if (accepted.invocationId !== rejected.invocationId) {
          throw new Error("The Agent retry returned a different invocation identity.");
        }
        bootstrap.refreshInvocations();
        return true;
      } catch (cause) {
        const error = toError(cause);
        bootstrap.reportCommandError(error);
        throw error;
      }
    },
    [bootstrap, clearChatError]
  );
  const commandErrorRetry = useMemo(() => {
    if (
      !rejectedContinuation ||
      !rejectedAttemptCommand ||
      bootstrap.commandError !== rejectedAttemptCommand.error ||
      rejectedContinuation.latestAttempt.error?.retryable !== true
    ) {
      return null;
    }
    return async () => {
      await retryRejectedAttempt(rejectedContinuation.runId);
    };
  }, [bootstrap.commandError, rejectedAttemptCommand, rejectedContinuation, retryRejectedAttempt]);

  const startNewConversation = useCallback(async () => {
    if (inFlight) {
      throw new Error("Stop the active Agent turn before starting a new conversation.");
    }
    await bootstrap.startNewConversation();
  }, [bootstrap, inFlight]);

  // `commandError` surfaces TWO latches: the bootstrap's and `useChat`'s. The
  // AI SDK keeps its terminal error until `clearError()` is called, so a
  // dismiss that only cleared the bootstrap half left "realtime unavailable"
  // pinned forever after a transport-thrown turn — long after the turn itself
  // was terminal and the composer usable again.
  const { clearCommandError: clearBootstrapCommandError } = bootstrap;
  const clearCommandError = useCallback(() => {
    clearChatError();
    clearBootstrapCommandError();
  }, [clearBootstrapCommandError, clearChatError]);

  return {
    status: bootstrap.status,
    error: bootstrap.error,
    streamStatus: transportError ? "closed" : bootstrap.realtime.status,
    streamError: transportError ? studioAgentRealtimeUnavailableError() : bootstrap.realtime.error,
    commandError:
      bootstrap.commandError ?? (chat.error ? studioAgentRealtimeUnavailableError() : null),
    thread: bootstrap.thread,
    timeline: panel.timeline,
    documentAnalysis: bootstrap.documentAnalysis,
    childRuns,
    turnFailure: panel.turnFailure,
    activeRun: panel.activeRun,
    activeCanvasPreview: panel.activeCanvasPreview,
    canSteer: activeClientRun !== null,
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
    clearCommandError,
    submit,
    uploadAttachment: bootstrap.uploadAttachment,
    cancelActiveRun,
    updatePermissionMode: bootstrap.updatePermissionMode,
    respondToToolApproval,
    canRespondToToolApproval,
    retryRejectedAttempt,
    commandErrorRetry,
    startNewConversation,
  };
}

export function useDisconnectedStoryStudioAgentSession(
  bootstrap: StoryStudioAgentBootstrap
): StoryStudioAgentSession {
  const panel = useMemo(
    () =>
      projectStudioAgentPanel({
        history: {
          ...bootstrap.history,
          runs: bootstrap.invocations.map(invocationStatusToRunView),
        },
        messages: bootstrap.history.messages,
        wireRuns: NO_WIRE_RUNS,
      }),
    [bootstrap.history, bootstrap.invocations]
  );
  const refuse = useCallback(async () => {
    throw new Error("The Agent conversation is not connected.");
  }, []);

  return {
    startNewConversation: bootstrap.startNewConversation,
    status: bootstrap.status,
    error: bootstrap.error,
    streamStatus: bootstrap.realtime.status,
    streamError: bootstrap.realtime.error,
    commandError: bootstrap.commandError,
    thread: bootstrap.thread,
    timeline: panel.timeline,
    documentAnalysis: bootstrap.documentAnalysis,
    childRuns: [],
    turnFailure: panel.turnFailure,
    activeRun: panel.activeRun,
    activeCanvasPreview: panel.activeCanvasPreview,
    canSteer: false,
    isRunning: panel.activeRun !== null,
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
    canRespondToToolApproval: () => false,
    retryRejectedAttempt: async () => false,
    commandErrorRetry: null,
  };
}

function useStudioAgentWireState(session: StudioAgentClientSession | null): {
  runs: RunInfo[];
  runByMessageId: ReadonlyMap<string, RunInfo>;
} {
  const store = useMemo(() => createStudioAgentWireStore(session), [session]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function createStudioAgentWireStore(session: StudioAgentClientSession | null): {
  getSnapshot: () => ReturnType<typeof readStudioAgentWireState>;
  subscribe: (onStoreChange: () => void) => () => void;
} {
  let snapshot = readStudioAgentWireState(session);
  return {
    getSnapshot: () => snapshot,
    subscribe: (onStoreChange) => {
      if (!session) return () => undefined;
      const update = () => {
        snapshot = readStudioAgentWireState(session);
        onStoreChange();
      };
      const offRun = session.view.on("run", update);
      const offUpdate = session.view.on("update", update);
      return () => {
        offRun();
        offUpdate();
      };
    },
  };
}

function readStudioAgentWireState(session: StudioAgentClientSession | null): {
  runs: RunInfo[];
  runByMessageId: ReadonlyMap<string, RunInfo>;
} {
  if (!session) {
    return {
      runs: NO_WIRE_RUNS,
      runByMessageId: new Map<string, RunInfo>(),
    };
  }
  const runByMessageId = new Map<string, RunInfo>();
  for (const item of session.view.getMessages()) {
    const run = session.view.runOf(item.codecMessageId);
    if (run) runByMessageId.set(item.message.id, run);
  }
  return {
    runs: session.view.runs(),
    runByMessageId,
  };
}

function composeParts(
  text: string,
  attachments: readonly StoryStudioAgentAttachment[]
): StudioAgentUIMessage["parts"] {
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...attachments.flatMap((attachment) => [
      studioAgentAttachmentPart(attachment),
      studioAgentAttachmentFilePart(attachment),
    ]),
  ];
}

function seamOf(messages: readonly StudioAgentUIMessage[]): string | null {
  return messages.at(-1)?.id ?? null;
}

function isClientRunTerminal(run: StudioAgentClientRun): boolean {
  return run.status === "complete" || run.status === "cancelled" || run.status === "error";
}

function invocationStatusToRunView(invocation: AgentInvocationStatus): StudioAgentRunView {
  const status =
    invocation.status === "admitting" || invocation.status === "queued"
      ? "queued"
      : invocation.status === "waiting_for_approval"
        ? "waiting_for_approval"
        : invocation.status;
  return {
    id: invocation.runId,
    parentRunId: null,
    title: "Agent response",
    summary: invocation.error?.message ?? null,
    error: invocation.error
      ? {
          ...invocation.error,
          details: null,
        }
      : null,
    status,
    progress: status === "succeeded" || status === "failed" || status === "cancelled" ? 1 : null,
    createdAt: invocation.createdAt,
    startedAt: invocation.startedAt,
    completedAt: invocation.completedAt,
  };
}

/**
 * Fold a monotonic lifecycle delta into one authoritative Run aggregate.
 *
 * Durable history owns old completed turns, so a long-lived creator tab keeps
 * every active Run and only a bounded recent terminal window. This preserves
 * exact cancellation and optimistic-admission reconciliation without making
 * the panel slower as a conversation grows.
 */
export function mergeInvocationStatuses(
  current: readonly AgentInvocationStatus[],
  changes: readonly AgentInvocationStatus[]
): AgentInvocationStatus[] {
  const byInvocationId = new Map(
    current.map((invocation) => [invocation.invocationId, invocation])
  );
  for (const invocation of changes) {
    byInvocationId.set(invocation.invocationId, invocation);
  }
  const all = [...byInvocationId.values()];
  const active = all.filter((invocation) => !isTerminalInvocationStatus(invocation.status));
  const terminals = all
    .filter((invocation) => isTerminalInvocationStatus(invocation.status))
    .sort(byInvocationCreatedAtDescending)
    .slice(0, INVOCATION_TERMINAL_WINDOW_SIZE);
  return [...active, ...terminals].sort(byInvocationCreatedAtAscending);
}

function isTerminalInvocationStatus(status: AgentInvocationStatus["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function byInvocationCreatedAtAscending(
  left: AgentInvocationStatus,
  right: AgentInvocationStatus
): number {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.invocationId.localeCompare(right.invocationId)
  );
}

function byInvocationCreatedAtDescending(
  left: AgentInvocationStatus,
  right: AgentInvocationStatus
): number {
  return byInvocationCreatedAtAscending(right, left);
}

/**
 * Legacy Mastra rows predate exact run attribution. Invocation execution is
 * serialized per conversation, so an assistant row created inside exactly one
 * started/completed interval belongs to that run. New rows carry runId and
 * never enter this compatibility path.
 */
function invocationForHistoricalAssistantMessage(
  message: StudioAgentUIMessage,
  invocations: readonly AgentInvocationStatus[]
): AgentInvocationStatus | undefined {
  const createdAt = Date.parse(message.metadata?.createdAt ?? "");
  if (!Number.isFinite(createdAt)) return undefined;

  const matches = invocations.filter((invocation) => {
    if (!invocation.startedAt) return false;
    const startedAt = Date.parse(invocation.startedAt);
    const completedAt = invocation.completedAt
      ? Date.parse(invocation.completedAt)
      : Number.POSITIVE_INFINITY;
    return (
      Number.isFinite(startedAt) &&
      Number.isFinite(completedAt) &&
      createdAt >= startedAt &&
      createdAt <= completedAt
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function assertStoryGrant(grant: AgentConversationGrant, projectId: string): void {
  if (grant.conversation.surface !== "story-studio") {
    throw new Error("Agent Platform resolved a conversation for the wrong surface.");
  }
  if (!grant.sessionName.endsWith(grant.conversation.id) || projectId.length === 0) {
    throw new Error("Agent Platform returned an invalid Story conversation identity.");
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Realtime cancellation is the low-latency signal, not the execution
 * authority. It must never hold the UI or Temporal cancellation hostage when
 * a channel is reconnecting or has lost continuity. The session already
 * reports transport failures through its error boundary; this observes the
 * promise solely to prevent an unhandled rejection.
 */
function requestRealtimeCancellation(cancel: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(cancel)
    .catch(() => undefined);
}

export type { ClientSession as StudioAgentTransportSession };
