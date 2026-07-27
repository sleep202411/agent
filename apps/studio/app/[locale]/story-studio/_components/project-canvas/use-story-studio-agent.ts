"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentSubmitMessageRequestSchema,
  type StudioAgentMessagePart,
  type StudioAgentPermissionMode,
  type StudioAgentPermissionPolicy,
  type StudioAgentSubmitMessageRequest,
  type StudioAgentThread,
  type StudioAgentTurnWindow,
} from "@repo/shared";
import { useLocale } from "next-intl";

import { ApiRequestError } from "@/lib/api";
import { canonicalJsonString } from "@/lib/canonical-json";
import type { StudioAgentAttachmentUploadLease } from "@/components/studio-agent";
import {
  StudioAgentApiClient,
  StudioAgentSseClient,
  StudioAgentSseHttpError,
  appendStudioAgentEvents,
  createStudioAgentEventState,
  createStudioAgentEventStateFromSnapshot,
  hydrateStudioAgentEarlierTurns,
  hydrateStudioAgentEventState,
  hydrateStudioAgentSubmitResult,
  parseStudioAgentWireEvent,
  type StudioAgentDeliveryMode,
  type StudioAgentEventState,
  type StudioAgentStreamStatus,
} from "@/lib/studio-agent";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import { STUDIO_AGENT_DOCUMENT_MEDIA_TYPES } from "@/components/studio-agent";

import { matchesStoryProjectionQueryKey } from "./story-canvas-edit-policy";

const STORY_SURFACE_ID = "story.studio";
const STORY_SCENARIO = {
  id: "story.studio.assistant",
  version: "1.0.0",
} as const;
const EVENT_PAGE_LIMIT = 500;
const EMPTY_TURN_WINDOW: StudioAgentTurnWindow = {
  earliestRootRunId: null,
  hasEarlier: false,
};
const PENDING_SUBMISSION_STORAGE_PREFIX = "fizzdragon:studio-agent:pending-submission:";

type SessionStatus = "loading" | "ready" | "error";

export interface StoryStudioAgentSession {
  status: SessionStatus;
  error: Error | null;
  streamStatus: StudioAgentStreamStatus;
  streamError: Error | null;
  commandError: Error | null;
  thread: StudioAgentThread | null;
  eventState: StudioAgentEventState;
  activeRun: StudioAgentRunView | null;
  isRunning: boolean;
  queuedCount: number;
  submitting: boolean;
  cancelling: boolean;
  policyUpdating: boolean;
  resolvingApprovalIds: ReadonlySet<string>;
  /** Whether history exists before the loaded turn window. */
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
  uploadAttachment: (
    file: File,
    context: {
      signal: AbortSignal;
      onProgress: (percent: number) => void;
      onProcessing?: () => void;
    }
  ) => Promise<StudioAgentAttachmentUploadLease>;
  cancelActiveRun: (reason: string) => Promise<void>;
  updatePermissionMode: (mode: StudioAgentPermissionMode) => Promise<void>;
  resolveApproval: (
    approvalId: string,
    decision: "approved" | "denied",
    persistCapability: boolean
  ) => Promise<void>;
}

type StudioAgentRunView = StudioAgentEventState["runs"][string];
type StoryStudioAgentAttachment = Extract<StudioAgentMessagePart, { type: "attachment" }>;
type StoryStudioAgentSubmitPayload = Omit<StudioAgentSubmitMessageRequest, "clientMessageId">;

interface PendingStoryStudioAgentSubmission {
  readonly threadId: string;
  readonly signature: string;
  readonly clientMessageId: string;
  readonly payload: StoryStudioAgentSubmitPayload;
}

export function useStoryStudioAgent({
  projectId,
  chapterId,
  workspaceId,
}: {
  projectId: string;
  chapterId: string | null;
  workspaceId: string;
}): StoryStudioAgentSession {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const apiClient = useMemo(
    () => new StudioAgentApiClient({ workspaceId, locale }),
    [locale, workspaceId]
  );
  const [retryToken, setRetryToken] = useState(0);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [error, setError] = useState<Error | null>(null);
  const [streamStatus, setStreamStatus] = useState<StudioAgentStreamStatus>("idle");
  const [streamError, setStreamError] = useState<Error | null>(null);
  const [commandError, setCommandError] = useState<Error | null>(null);
  const [thread, setThread] = useState<StudioAgentThread | null>(null);
  const [eventState, setEventState] = useState<StudioAgentEventState>(() =>
    createStudioAgentEventState(`pending:${projectId}:${chapterId ?? "project"}`)
  );
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [policyUpdating, setPolicyUpdating] = useState(false);
  const [resolvingApprovalIds, setResolvingApprovalIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [turnWindow, setTurnWindow] = useState<StudioAgentTurnWindow>(EMPTY_TURN_WINDOW);
  const [loadingEarlierTurns, setLoadingEarlierTurns] = useState(false);
  const threadRef = useRef(thread);
  const eventStateRef = useRef(eventState);
  const turnWindowRef = useRef(turnWindow);
  const earlierTokenRef = useRef<symbol | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const submittingTokenRef = useRef<symbol | null>(null);
  const pendingSubmissionRef = useRef<PendingStoryStudioAgentSubmission | null>(null);
  const cancellingTokenRef = useRef<symbol | null>(null);
  const policyMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const policyMutationTokensRef = useRef(new Set<symbol>());
  const approvalMutationTokensRef = useRef(new Map<string, symbol>());

  const replaceThread = useCallback((next: StudioAgentThread | null) => {
    threadRef.current = next;
    setThread(next);
  }, []);

  const replaceTurnWindow = useCallback((next: StudioAgentTurnWindow) => {
    turnWindowRef.current = next;
    setTurnWindow(next);
  }, []);

  const replaceEventState = useCallback((next: StudioAgentEventState) => {
    eventStateRef.current = next;
    setEventState(next);
  }, []);

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

  const enqueuePolicyMutation = useCallback(
    async (
      expectedThreadId: string,
      transform: (
        current: StudioAgentPermissionPolicy
      ) => Pick<StudioAgentPermissionPolicy, "mode" | "rules"> | null
    ): Promise<StudioAgentPermissionPolicy> => {
      return enqueuePolicyOperation(
        expectedThreadId,
        async (currentThread) => {
          const nextPolicy = transform(currentThread.permissionPolicy);
          if (!nextPolicy) return currentThread.permissionPolicy;

          const permissionPolicy = await updatePolicy(apiClient, currentThread, nextPolicy);
          const latestThread = threadRef.current;
          if (latestThread?.threadId === expectedThreadId) {
            replaceThread({ ...latestThread, permissionPolicy });
          }
          return permissionPolicy;
        },
        true
      );
    },
    [apiClient, enqueuePolicyOperation, replaceThread]
  );

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const abortController = new AbortController();
    let stream: StudioAgentSseClient | null = null;
    const pendingState = createStudioAgentEventState(
      `pending:${projectId}:${chapterId ?? "project"}`
    );
    threadRef.current = null;
    eventStateRef.current = pendingState;
    // Synchronous, not in the microtask block: the thread id survives a chapter
    // switch, so an in-flight earlier page has only the load generation and
    // this cursor to tell it that its window is gone.
    turnWindowRef.current = EMPTY_TURN_WINDOW;
    earlierTokenRef.current = null;
    loadAbortRef.current = abortController;
    submittingTokenRef.current = null;
    pendingSubmissionRef.current = null;
    cancellingTokenRef.current = null;
    policyMutationQueueRef.current = Promise.resolve();
    policyMutationTokensRef.current.clear();
    approvalMutationTokensRef.current.clear();

    // Reset visible state at the next microtask boundary. This keeps the
    // effect focused on synchronizing with the external session while still
    // guaranteeing that a scope change clears the previous conversation
    // before any awaited network response can commit.
    queueMicrotask(() => {
      if (abortController.signal.aborted || generation !== loadGenerationRef.current) return;
      setStatus("loading");
      setError(null);
      setStreamError(null);
      setStreamStatus("idle");
      setCommandError(null);
      setThread(null);
      setEventState(pendingState);
      setSubmitting(false);
      setCancelling(false);
      setPolicyUpdating(false);
      setResolvingApprovalIds(new Set());
      setTurnWindow(EMPTY_TURN_WINDOW);
      setLoadingEarlierTurns(false);
    });

    const load = async () => {
      try {
        const resolved = await apiClient.resolveThread(
          {
            schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
            surfaceId: STORY_SURFACE_ID,
            scenario: STORY_SCENARIO,
            scope: {
              workspaceId,
              container: {
                resourceType: "story.project",
                resourceId: projectId,
                revision: null,
              },
              focus: chapterId
                ? {
                    resourceType: "story.chapter",
                    resourceId: chapterId,
                    revision: null,
                  }
                : null,
            },
            locale,
          },
          abortController.signal
        );
        const snapshot = await apiClient.getSnapshot(resolved.thread.threadId, {
          signal: abortController.signal,
        });
        assertSnapshotScope(snapshot.thread, resolved.thread, projectId, workspaceId);

        let nextState = createStudioAgentEventStateFromSnapshot(snapshot);
        let afterSequence = snapshot.latestEventSequence;
        let hasMore = true;
        while (hasMore) {
          const page = await apiClient.getEventPage(
            snapshot.thread.threadId,
            afterSequence,
            EVENT_PAGE_LIMIT,
            abortController.signal
          );
          assertEventPage(page.events, snapshot.thread.threadId, afterSequence);
          nextState = appendStudioAgentEvents(nextState, page.events);
          if (page.events.length > 0) {
            afterSequence = page.events.at(-1)!.sequence;
          }
          hasMore = page.hasMore;
          if (hasMore && page.events.length === 0) {
            throw new Error("Studio Agent event replay returned an empty non-terminal page.");
          }
          if (!hasMore && afterSequence !== page.latestSequence) {
            throw new Error(
              "Studio Agent event replay did not reach the advertised latest sequence."
            );
          }
        }

        if (abortController.signal.aborted || generation !== loadGenerationRef.current) return;
        const pendingSubmission = readPendingSubmission(snapshot.thread.threadId);
        if (pendingSubmission) {
          const accepted = Object.values(nextState.messages).some(
            (message) => message.clientMessageId === pendingSubmission.clientMessageId
          );
          if (accepted) {
            clearPendingSubmission(pendingSubmission);
          } else {
            pendingSubmissionRef.current = pendingSubmission;
          }
        }
        replaceEventState(nextState);
        replaceThread(snapshot.thread);
        replaceTurnWindow(snapshot.turnWindow);
        setStatus("ready");

        stream = new StudioAgentSseClient({
          url: (cursor) => apiClient.eventStreamUrl(snapshot.thread.threadId, cursor),
          initialCursor: String(nextState.cursor?.sequence ?? snapshot.latestEventSequence),
          headers: apiClient.eventStreamHeaders(),
          parseEvent(data, metadata) {
            const event = parseStudioAgentWireEvent(data, metadata);
            if (event.threadId !== snapshot.thread.threadId) {
              throw new Error("Studio Agent event stream crossed thread boundaries.");
            }
            return event;
          },
          onEvents(events) {
            const current = eventStateRef.current;
            const projected = appendStudioAgentEvents(current, events);
            replaceEventState(projected);
            stream?.acknowledge(String(projected.cursor?.sequence ?? projected.baseSequence));
            // An applied change-set means the agent mutated the story draft/
            // layout server-side (draft.revision bumped). The canvas loads its
            // projections via react-query with no realtime channel, so refetch
            // them here — otherwise the canvas keeps rendering the pre-edit
            // draft and the user's next manual edit hits a spurious revision
            // conflict.
            if (events.some((event) => event.type === "changeset.applied")) {
              void queryClient.invalidateQueries({
                predicate: (query) => matchesStoryProjectionQueryKey(query.queryKey, projectId),
              });
            }
            if (projected.issues.length > current.issues.length) {
              setStreamError(new Error("Studio Agent event ordering became inconsistent."));
              stream?.stop();
            }
          },
          onStatusChange(nextStatus) {
            if (generation !== loadGenerationRef.current) return;
            setStreamStatus(nextStatus);
            if (nextStatus === "connected") setStreamError(null);
          },
          onError(nextError) {
            if (generation !== loadGenerationRef.current) return;
            setStreamError(nextError);
            if (nextError instanceof StudioAgentSseHttpError && nextError.status === 401) {
              window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
            }
          },
        });
        stream.start();
      } catch (cause) {
        if (abortController.signal.aborted || generation !== loadGenerationRef.current) return;
        setError(toError(cause));
        setStatus("error");
      }
    };

    void load();
    return () => {
      abortController.abort();
      stream?.stop();
    };
  }, [
    apiClient,
    chapterId,
    locale,
    projectId,
    queryClient,
    replaceEventState,
    replaceThread,
    retryToken,
    workspaceId,
  ]);

  const activeRun = useMemo(() => selectActiveRootRun(eventState), [eventState]);
  const isRunning = activeRun !== null;
  const queuedCount = useMemo(
    () =>
      Object.values(eventState.inputs).filter(
        (input) => input.status === "accepted" && input.delivery === "enqueue"
      ).length,
    [eventState.inputs]
  );

  const uploadAttachment = useCallback(
    async (
      file: File,
      context: {
        signal: AbortSignal;
        onProgress: (percent: number) => void;
        onProcessing?: () => void;
      }
    ): Promise<StudioAgentAttachmentUploadLease> => {
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

  const submit = useCallback(
    async (
      text: string,
      mode: StudioAgentDeliveryMode,
      attachments: readonly StoryStudioAgentAttachment[] = []
    ) => {
      const normalized = text.trim();
      const currentThread = threadRef.current;
      if (
        (!normalized && attachments.length === 0) ||
        !currentThread ||
        status !== "ready" ||
        submittingTokenRef.current
      ) {
        return false;
      }
      if (attachments.some((attachment) => attachment.status !== "ready")) {
        throw new Error("Only ready attachments can be submitted.");
      }
      const currentRun = selectActiveRootRun(eventStateRef.current);
      const targeted = currentRun !== null;
      if (targeted === (mode === "send")) {
        throw new Error("Studio Agent delivery mode does not match the active run state.");
      }

      const token = Symbol("studio-agent-submit");
      submittingTokenRef.current = token;
      setSubmitting(true);
      setCommandError(null);
      const payload: StoryStudioAgentSubmitPayload = {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        parts: [
          ...(normalized
            ? [{ type: "text" as const, format: "plain_text" as const, text: normalized }]
            : []),
          ...attachments.map((attachment) => ({ ...attachment })),
        ],
        scope: {
          workspaceId,
          container: {
            resourceType: "story.project",
            resourceId: projectId,
            revision: null,
          },
          focus: chapterId
            ? {
                resourceType: "story.chapter",
                resourceId: chapterId,
                revision: null,
              }
            : null,
        },
        locale,
        targetRunId: currentRun?.id ?? null,
        delivery: mode === "send" ? null : mode,
      };
      const signature = canonicalJsonString(payload);
      const previousSubmission = pendingSubmissionRef.current;
      const pendingSubmission =
        previousSubmission?.threadId === currentThread.threadId &&
        previousSubmission.signature === signature
          ? previousSubmission
          : {
              threadId: currentThread.threadId,
              signature,
              clientMessageId: crypto.randomUUID(),
              payload,
            };
      pendingSubmissionRef.current = pendingSubmission;
      persistPendingSubmission(pendingSubmission);
      try {
        const result = await apiClient.submitMessage(currentThread.threadId, {
          ...pendingSubmission.payload,
          clientMessageId: pendingSubmission.clientMessageId,
        });
        if (pendingSubmissionRef.current === pendingSubmission) {
          pendingSubmissionRef.current = null;
        }
        clearPendingSubmission(pendingSubmission);
        if (threadRef.current?.threadId === currentThread.threadId) {
          const next = hydrateStudioAgentSubmitResult(eventStateRef.current, result);
          replaceEventState(next);
        }
        return true;
      } catch (cause) {
        if (
          !isAmbiguousSubmitFailure(cause) &&
          pendingSubmissionRef.current === pendingSubmission
        ) {
          pendingSubmissionRef.current = null;
          clearPendingSubmission(pendingSubmission);
        }
        const nextError = toError(cause);
        if (threadRef.current?.threadId === currentThread.threadId) {
          setCommandError(nextError);
        }
        throw nextError;
      } finally {
        if (submittingTokenRef.current === token) {
          submittingTokenRef.current = null;
          setSubmitting(false);
        }
      }
    },
    [apiClient, chapterId, locale, projectId, replaceEventState, status, workspaceId]
  );

  const cancelActiveRun = useCallback(
    async (reason: string) => {
      const currentThread = threadRef.current;
      const run = selectActiveRootRun(eventStateRef.current);
      if (!currentThread || !run || cancellingTokenRef.current) return;
      const token = Symbol("studio-agent-cancel");
      cancellingTokenRef.current = token;
      setCancelling(true);
      setCommandError(null);
      try {
        const cancelled = await apiClient.cancelRun(currentThread.threadId, run.id, {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          reason,
        });
        if (threadRef.current?.threadId === currentThread.threadId) {
          replaceEventState(
            hydrateStudioAgentEventState(eventStateRef.current, { runs: [cancelled] })
          );
        }
      } catch (cause) {
        const nextError = toError(cause);
        if (threadRef.current?.threadId === currentThread.threadId) {
          setCommandError(nextError);
        }
        throw nextError;
      } finally {
        if (cancellingTokenRef.current === token) {
          cancellingTokenRef.current = null;
          setCancelling(false);
        }
      }
    },
    [apiClient, replaceEventState]
  );

  const loadEarlierTurns = useCallback(async () => {
    const currentThread = threadRef.current;
    const cursor = turnWindowRef.current;
    if (!currentThread || !cursor.hasEarlier || !cursor.earliestRootRunId) return;
    if (earlierTokenRef.current) return;
    // The thread id survives a chapter switch (thread identity is
    // container-scoped, not focus-scoped), so only the load generation can tell
    // a stale page from a live one. Merging a page against a cursor the session
    // no longer holds would splice a hole into the transcript that no cursor in
    // this protocol can ever fill.
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
      replaceEventState(hydrateStudioAgentEarlierTurns(eventStateRef.current, page));
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
  }, [apiClient, replaceEventState, replaceTurnWindow]);

  const updatePermissionMode = useCallback(
    async (mode: StudioAgentPermissionMode) => {
      const currentThread = threadRef.current;
      if (!currentThread || mode === currentThread.permissionPolicy.mode) return;
      setCommandError(null);
      try {
        await enqueuePolicyMutation(currentThread.threadId, (permissionPolicy) => ({
          mode,
          rules: permissionPolicy.rules,
        }));
      } catch (cause) {
        const nextError = toError(cause);
        if (threadRef.current?.threadId === currentThread.threadId) {
          setCommandError(nextError);
        }
        throw nextError;
      }
    },
    [enqueuePolicyMutation]
  );

  const resolveApproval = useCallback(
    async (approvalId: string, decision: "approved" | "denied", persistCapability: boolean) => {
      const currentThread = threadRef.current;
      if (!currentThread || approvalMutationTokensRef.current.has(approvalId)) return;
      const approval = eventStateRef.current.approvals[approvalId];
      if (!approval || approval.status !== "pending") return;

      const token = Symbol(`studio-agent-approval:${approvalId}`);
      approvalMutationTokensRef.current.set(approvalId, token);
      setResolvingApprovalIds((current) => new Set(current).add(approvalId));
      setCommandError(null);
      try {
        if (decision === "approved" && persistCapability && !approval.capabilityVersion) {
          throw new Error("The requested capability version is unavailable.");
        }

        const result = await enqueuePolicyOperation(
          currentThread.threadId,
          async (operationThread) => {
            const resolved = await apiClient.resolveApproval(operationThread.threadId, approvalId, {
              schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
              decision,
              actionInputHash: approval.actionInputHash,
              note: null,
              persistentGrant:
                decision === "approved" && persistCapability
                  ? {
                      expectedPolicyRevision: operationThread.permissionPolicy.revision,
                      capability: {
                        id: approval.capability,
                        version: approval.capabilityVersion!,
                      },
                    }
                  : null,
            });
            const latestThread = threadRef.current;
            if (latestThread?.threadId === operationThread.threadId) {
              replaceThread({
                ...latestThread,
                permissionPolicy: resolved.permissionPolicy,
              });
            }
            return resolved;
          },
          decision === "approved" && persistCapability
        );
        if (threadRef.current?.threadId === currentThread.threadId) {
          replaceEventState(
            hydrateStudioAgentEventState(eventStateRef.current, {
              approvals: [result.approval],
            })
          );
        }
      } catch (cause) {
        const nextError = toError(cause);
        if (threadRef.current?.threadId === currentThread.threadId) {
          setCommandError(nextError);
        }
        throw nextError;
      } finally {
        if (approvalMutationTokensRef.current.get(approvalId) === token) {
          approvalMutationTokensRef.current.delete(approvalId);
          setResolvingApprovalIds((current) => {
            const next = new Set(current);
            next.delete(approvalId);
            return next;
          });
        }
      }
    },
    [apiClient, enqueuePolicyOperation, replaceEventState, replaceThread]
  );

  return {
    status,
    error,
    streamStatus,
    streamError,
    commandError,
    thread,
    eventState,
    activeRun,
    isRunning,
    queuedCount,
    submitting,
    cancelling,
    policyUpdating,
    resolvingApprovalIds,
    hasEarlierTurns: turnWindow.hasEarlier,
    loadingEarlierTurns,
    loadEarlierTurns,
    retry: () => {
      setRetryToken((current) => current + 1);
    },
    clearCommandError: () => setCommandError(null),
    submit,
    uploadAttachment,
    cancelActiveRun,
    updatePermissionMode,
    resolveApproval,
  };
}

function selectActiveRootRun(state: StudioAgentEventState): StudioAgentRunView | null {
  return (
    Object.values(state.runs)
      .filter((run) => run.parentRunId === null && !isTerminalRun(run.status))
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.sequence - left.sequence ||
          right.id.localeCompare(left.id)
      )[0] ?? null
  );
}

function isTerminalRun(status: StudioAgentRunView["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

async function updatePolicy(
  apiClient: StudioAgentApiClient,
  thread: StudioAgentThread,
  policy: Pick<StudioAgentPermissionPolicy, "mode" | "rules">
): Promise<StudioAgentPermissionPolicy> {
  return apiClient.updatePermissionPolicy(thread.threadId, {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    expectedRevision: thread.permissionPolicy.revision,
    mode: policy.mode,
    rules: policy.rules,
  });
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

function assertEventPage(
  events: readonly { threadId: string; sequence: number }[],
  threadId: string,
  afterSequence: number
): void {
  let expectedSequence = afterSequence + 1;
  for (const event of events) {
    if (event.threadId !== threadId) {
      throw new Error("Studio Agent event replay crossed thread boundaries.");
    }
    if (event.sequence !== expectedSequence) {
      throw new Error("Studio Agent event replay contains a sequence gap.");
    }
    expectedSequence += 1;
  }
}

function pendingSubmissionStorageKey(threadId: string): string {
  return `${PENDING_SUBMISSION_STORAGE_PREFIX}${threadId}`;
}

function persistPendingSubmission(pending: PendingStoryStudioAgentSubmission): void {
  window.sessionStorage.setItem(
    pendingSubmissionStorageKey(pending.threadId),
    JSON.stringify({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId: pending.threadId,
      signature: pending.signature,
      request: {
        ...pending.payload,
        clientMessageId: pending.clientMessageId,
      },
    })
  );
}

function readPendingSubmission(threadId: string): PendingStoryStudioAgentSubmission | null {
  const key = pendingSubmissionStorageKey(threadId);
  const raw = window.sessionStorage.getItem(key);
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    window.sessionStorage.removeItem(key);
    return null;
  }
  const entry = value as Record<string, unknown>;
  const request = StudioAgentSubmitMessageRequestSchema.safeParse(entry.request);
  if (
    entry.schemaVersion !== STUDIO_AGENT_SCHEMA_VERSION ||
    entry.threadId !== threadId ||
    typeof entry.signature !== "string" ||
    !request.success
  ) {
    window.sessionStorage.removeItem(key);
    return null;
  }

  const { clientMessageId, ...payload } = request.data;
  const signature = canonicalJsonString(payload);
  if (entry.signature !== signature) {
    window.sessionStorage.removeItem(key);
    return null;
  }
  return {
    threadId,
    signature,
    clientMessageId,
    payload,
  };
}

function clearPendingSubmission(pending: PendingStoryStudioAgentSubmission): void {
  const key = pendingSubmissionStorageKey(pending.threadId);
  const raw = window.sessionStorage.getItem(key);
  if (raw === null) return;
  try {
    const value = JSON.parse(raw) as {
      request?: { clientMessageId?: unknown };
    };
    if (value.request?.clientMessageId !== pending.clientMessageId) return;
  } catch {
    // A corrupt local journal cannot represent another valid command.
  }
  window.sessionStorage.removeItem(key);
}

/**
 * A retry must preserve its idempotency key whenever the browser cannot prove
 * that the server rejected the command before applying it. Network failures,
 * timeouts, retryable HTTP responses, and response-contract failures are all
 * ambiguous. A concrete non-retryable server rejection is definitive and may
 * rotate the key on the next attempt.
 */
function isAmbiguousSubmitFailure(cause: unknown): boolean {
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
