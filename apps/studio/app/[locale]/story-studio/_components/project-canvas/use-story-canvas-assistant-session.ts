"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  COPILOT_DOCUMENT_EXTENSIONS,
  COPILOT_DOCUMENT_MAX_FILE_BYTES,
  CopilotDocumentPartSchema,
  type CopilotDocumentRef,
} from "@repo/shared/copilot-documents";
import {
  STORY_DIRECTING_SKILL_KEYS,
  type StoryDirectingSkillKey,
} from "@repo/shared/story-directing-skills";
import type { UIMessage } from "ai";
import { useAuth } from "@/app/_components/auth-provider";
import { uploadCopilotDocument } from "@/lib/copilot-documents-api";
import { copilotStreamErrorDetails } from "@/components/copilot/copilot-history";
import {
  clearCopilotPendingTurn,
  isRecord,
  readCopilotPendingTurn,
  writeCopilotPendingTurn,
  type CopilotPendingTurn,
  type CopilotPendingTurnScope,
} from "@/components/copilot/copilot-pending-turn";
import { useCopilotHistory } from "@/components/copilot/use-copilot-history";
import { useCopilotScopeLifecycle } from "@/components/copilot/use-copilot-scope-lifecycle";
import {
  createStoryCanvasChatTransport,
  type StoryCanvasChatRequestContext,
} from "./story-canvas-chat-transport";
import { storyCanvasSkillKeyFromHistory } from "./story-canvas-skill-catalog";

export type StoryCanvasUIMessage = UIMessage;

export type StoryCanvasAttachmentError = "unsupported" | "tooLarge" | "uploadFailed";

interface StoryCanvasPendingTurnMetadata {
  selectedSkillKey: StoryDirectingSkillKey | null;
}

type StoryCanvasPendingTurn = CopilotPendingTurn<
  StoryCanvasUIMessage,
  StoryCanvasPendingTurnMetadata
>;

export function useStoryCanvasAssistantSession({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const conversationId = useMemo(() => `story-canvas:${projectId}`, [projectId]);
  const { user } = useAuth();
  const authenticatedUserId = user?.id == null ? null : String(user.id);
  const recoveryScope = useMemo<CopilotPendingTurnScope | null>(
    () =>
      authenticatedUserId
        ? {
            userId: authenticatedUserId,
            workspaceId,
            projectId,
            mode: "story-canvas",
            conversationId,
          }
        : null,
    [authenticatedUserId, conversationId, projectId, workspaceId]
  );
  const [draft, setDraft] = useState("");
  const [recoveryStorageError, setRecoveryStorageError] = useState(false);
  const [selectedSkillKey, setSelectedSkillKey] = useState<StoryDirectingSkillKey | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<StoryCanvasAttachmentError | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [recoveredTurn, setRecoveredTurn] = useState<StoryCanvasPendingTurn | null>(null);
  const recoveredTurnRef = useRef<StoryCanvasPendingTurn | null>(null);
  const pendingSubmittedTurnRef = useRef<StoryCanvasPendingTurn | null>(null);
  const deliberatelyAbortedMessageIdRef = useRef<string | null>(null);
  const recoveryScopeRef = useRef(recoveryScope);
  useLayoutEffect(() => {
    recoveryScopeRef.current = recoveryScope;
  }, [recoveryScope]);

  const preserveTurn = useCallback((turn: StoryCanvasPendingTurn) => {
    recoveredTurnRef.current = turn;
    setRecoveredTurn(turn);
    if (!writeCopilotPendingTurn(recoveryScopeRef.current, turn)) {
      setRecoveryStorageError(true);
    }
  }, []);

  const clearRecoveredTurn = useCallback((messageId?: string) => {
    const current = recoveredTurnRef.current;
    if (!messageId || current?.message.id === messageId) {
      recoveredTurnRef.current = null;
      setRecoveredTurn(null);
    }
    if (!messageId || pendingSubmittedTurnRef.current?.message.id === messageId) {
      pendingSubmittedTurnRef.current = null;
    }
    clearCopilotPendingTurn(recoveryScopeRef.current, messageId);
    setRecoveryStorageError(false);
  }, []);

  useEffect(() => {
    let active = true;
    pendingSubmittedTurnRef.current = null;
    deliberatelyAbortedMessageIdRef.current = null;
    const restored = readCopilotPendingTurn(recoveryScope, parseStoryCanvasPendingTurn);
    recoveredTurnRef.current = restored;
    queueMicrotask(() => {
      if (!active) return;
      setRecoveryStorageError(false);
      setRecoveredTurn(restored);
    });
    return () => {
      active = false;
    };
  }, [recoveryScope]);
  const [transportController] = useState(() =>
    createStoryCanvasChatTransport({
      conversationId,
      projectId,
      workspaceId,
      selectedSkillKey,
    })
  );
  const chat = useChat<StoryCanvasUIMessage>({
    id: conversationId,
    transport: transportController.transport,
    onFinish({ isAbort, isError }) {
      const submittedTurn = pendingSubmittedTurnRef.current;
      if (!submittedTurn) return;
      if (
        isError &&
        !isAbort &&
        deliberatelyAbortedMessageIdRef.current !== submittedTurn.message.id
      ) {
        preserveTurn(submittedTurn);
      }
    },
  });
  const {
    messages,
    status,
    error,
    setMessages,
    sendMessage,
    regenerate: regenerateChat,
    stop: stopChat,
    clearError,
  } = chat;

  const requestContext = useMemo<StoryCanvasChatRequestContext>(
    () => ({
      conversationId,
      projectId,
      workspaceId,
      selectedSkillKey,
    }),
    [conversationId, projectId, selectedSkillKey, workspaceId]
  );
  useLayoutEffect(() => {
    transportController.updateContext(requestContext);
  }, [requestContext, transportController]);
  const updateTransportForSkill = useCallback(
    (skill: StoryDirectingSkillKey | null) => {
      transportController.updateContext({ ...requestContext, selectedSkillKey: skill });
    },
    [requestContext, transportController]
  );

  const restoreHistoryMetadata = useCallback(
    (payload: { selectedSkillKeys?: unknown; messages: StoryCanvasUIMessage[] }) => {
      setSelectedSkillKey(storyCanvasSkillKeyFromHistory(payload.selectedSkillKeys));
      const stored = readCopilotPendingTurn(recoveryScopeRef.current, parseStoryCanvasPendingTurn);
      if (!stored) return;
      if (payload.messages.some((message) => message.id === stored.message.id)) {
        clearRecoveredTurn(stored.message.id);
        return;
      }
      if (pendingSubmittedTurnRef.current?.message.id !== stored.message.id) {
        recoveredTurnRef.current = stored;
        setRecoveredTurn(stored);
      }
    },
    [clearRecoveredTurn]
  );
  const history = useCopilotHistory<StoryCanvasUIMessage>({
    conversationId,
    workspaceId,
    mode: "story-canvas",
    projectId,
    setMessages,
    onLoaded: restoreHistoryMetadata,
  });
  const streamError = copilotStreamErrorDetails(error);
  const retryHistory = history.retry;
  const handledErrorRef = useRef<Error | undefined>(undefined);
  useEffect(() => {
    if (!error || handledErrorRef.current === error) return;
    handledErrorRef.current = error;
    const action = copilotStreamErrorDetails(error)?.action;
    const optimisticTurn = pendingSubmittedTurnRef.current;
    queueMicrotask(() => {
      if (optimisticTurn && deliberatelyAbortedMessageIdRef.current !== optimisticTurn.message.id) {
        preserveTurn(optimisticTurn);
      }
      if (action === "refresh_history") void retryHistory();
    });
  }, [error, preserveTurn, retryHistory]);

  useEffect(() => {
    const recoveredId = recoveredTurn?.message.id;
    if (!recoveredId || !history.payload?.messages.some((message) => message.id === recoveredId)) {
      return;
    }
    queueMicrotask(() => {
      clearRecoveredTurn(recoveredId);
    });
  }, [clearRecoveredTurn, history.payload?.messages, recoveredTurn?.message.id]);

  const reconcileDispatchedTurn = useCallback(
    async (turn: StoryCanvasPendingTurn): Promise<boolean> => {
      const canonical = await retryHistory();
      if (canonical?.messages.some((message) => message.id === turn.message.id)) {
        clearRecoveredTurn(turn.message.id);
        return true;
      }
      preserveTurn(turn);
      return false;
    },
    [clearRecoveredTurn, preserveTurn, retryHistory]
  );

  const busy = status === "submitted" || status === "streaming";

  const attachDocument = useCallback((file: File): boolean => {
    const lower = file.name.toLowerCase();
    if (!COPILOT_DOCUMENT_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
      setAttachmentError("unsupported");
      return false;
    }
    if (file.size > COPILOT_DOCUMENT_MAX_FILE_BYTES) {
      setAttachmentError("tooLarge");
      return false;
    }
    setAttachmentError(null);
    setAttachment(file);
    return true;
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachment(null);
    setAttachmentError(null);
  }, []);

  const submit = useCallback(
    async (text = draft): Promise<boolean> => {
      const normalized = text.trim();
      const attachedFile = attachment;
      if (
        (!normalized && !attachedFile) ||
        busy ||
        attachmentUploading ||
        history.status !== "ready" ||
        history.conversationStatus !== "ready"
      )
        return false;
      // Upload on send, like the removed image flow: the document becomes a
      // durable server-side row first, and the message carries only its
      // reference part. A failed upload keeps both draft and attachment.
      let documentRef: CopilotDocumentRef | null = null;
      if (attachedFile) {
        setAttachmentUploading(true);
        setAttachmentError(null);
        try {
          documentRef = await uploadCopilotDocument({
            file: attachedFile,
            conversationId,
            projectId,
            workspaceId,
          });
        } catch {
          setAttachmentError("uploadFailed");
          return false;
        } finally {
          setAttachmentUploading(false);
        }
      }
      // Freeze the latest Skill into this request before AI SDK
      // begins sending. A layout effect alone is not enough when selection and
      // submission happen in one interaction.
      const outgoingMessage: StoryCanvasUIMessage = {
        id: globalThis.crypto.randomUUID(),
        role: "user",
        parts: [
          ...(normalized ? [{ type: "text" as const, text: normalized }] : []),
          ...(documentRef ? [{ type: "data-document" as const, data: documentRef }] : []),
        ],
      };
      const outgoingTurn: StoryCanvasPendingTurn = {
        message: outgoingMessage,
        metadata: { selectedSkillKey },
      };
      deliberatelyAbortedMessageIdRef.current = null;
      if (!writeCopilotPendingTurn(recoveryScopeRef.current, outgoingTurn)) {
        setRecoveryStorageError(true);
        return false;
      }
      setRecoveryStorageError(false);
      pendingSubmittedTurnRef.current = outgoingTurn;
      updateTransportForSkill(outgoingTurn.metadata.selectedSkillKey);
      setDraft("");
      setAttachment(null);
      try {
        void sendMessage(outgoingMessage)
          .then(() => reconcileDispatchedTurn(outgoingTurn))
          .catch(() => {
            if (deliberatelyAbortedMessageIdRef.current !== outgoingMessage.id) {
              preserveTurn(outgoingTurn);
            }
          });
      } catch {
        preserveTurn(outgoingTurn);
        return false;
      }
      return true;
    },
    [
      attachment,
      attachmentUploading,
      busy,
      conversationId,
      draft,
      history.conversationStatus,
      history.status,
      preserveTurn,
      projectId,
      reconcileDispatchedTurn,
      selectedSkillKey,
      sendMessage,
      updateTransportForSkill,
      workspaceId,
    ]
  );

  const regenerate = useCallback(async (): Promise<boolean> => {
    if (busy || history.resetting) return false;
    const canonical = await retryHistory();
    if (!canonical || (canonical.status !== "failed" && canonical.status !== "aborted")) {
      return false;
    }
    deliberatelyAbortedMessageIdRef.current = null;
    updateTransportForSkill(storyCanvasSkillKeyFromHistory(canonical.selectedSkillKeys));
    try {
      await regenerateChat();
      const settled = await retryHistory();
      return settled?.status === "ready";
    } catch {
      return false;
    }
  }, [busy, history.resetting, regenerateChat, retryHistory, updateTransportForSkill]);

  const retryRecoveredMessage = useCallback(async (): Promise<boolean> => {
    const recovered = recoveredTurn;
    if (!recovered || busy || history.resetting) return false;
    const canonical = await retryHistory();
    if (!canonical) return false;
    const canonicalHasMessage = canonical.messages.some(
      (message) => message.id === recovered.message.id
    );
    updateTransportForSkill(
      canonicalHasMessage
        ? storyCanvasSkillKeyFromHistory(canonical.selectedSkillKeys)
        : recovered.metadata.selectedSkillKey
    );
    deliberatelyAbortedMessageIdRef.current = null;
    try {
      if (
        canonicalHasMessage &&
        (canonical.status === "failed" || canonical.status === "aborted")
      ) {
        clearRecoveredTurn(recovered.message.id);
        await regenerateChat();
      } else if (canonical.status === "ready" && !canonicalHasMessage) {
        pendingSubmittedTurnRef.current = recovered;
        await sendMessage(recovered.message);
      } else if (canonical.status !== "ready" || !canonicalHasMessage) {
        return false;
      } else {
        // The original request completed even though its response never reached
        // this tab. The canonical transcript already contains the full turn.
        clearRecoveredTurn(recovered.message.id);
        return true;
      }
      const settled = await retryHistory();
      const completed =
        settled?.status === "ready" &&
        settled.messages.some((message) => message.id === recovered.message.id);
      if (!completed) return false;
      clearRecoveredTurn(recovered.message.id);
      return true;
    } catch {
      return false;
    }
  }, [
    busy,
    clearRecoveredTurn,
    history.resetting,
    recoveredTurn,
    regenerateChat,
    retryHistory,
    sendMessage,
    updateTransportForSkill,
  ]);

  const startNewConversation = useCallback(async (): Promise<boolean> => {
    if (busy || history.resetting) return false;
    const reset = await history.reset();
    if (!reset) return false;
    clearRecoveredTurn();
    pendingSubmittedTurnRef.current = null;
    deliberatelyAbortedMessageIdRef.current = null;
    handledErrorRef.current = undefined;
    clearError();
    setDraft("");
    setAttachment(null);
    setAttachmentError(null);
    return true;
  }, [busy, clearError, clearRecoveredTurn, history]);

  const discardRecoveredMessage = useCallback(() => {
    const recovered = recoveredTurnRef.current;
    if (recovered) clearRecoveredTurn(recovered.message.id);
  }, [clearRecoveredTurn]);

  const stop = useCallback(() => {
    const submittedTurn = pendingSubmittedTurnRef.current;
    deliberatelyAbortedMessageIdRef.current = submittedTurn?.message.id ?? null;
    if (submittedTurn) clearRecoveredTurn(submittedTurn.message.id);
    pendingSubmittedTurnRef.current = null;
    void stopChat().finally(() => retryHistory());
  }, [clearRecoveredTurn, retryHistory, stopChat]);

  const disposeSession = useCallback(() => stopChat(), [stopChat]);
  useCopilotScopeLifecycle(disposeSession);

  return {
    conversationId,
    messages,
    status,
    error,
    errorMessage: streamError?.message ?? error?.message ?? null,
    errorAction: streamError?.action ?? null,
    errorQuota: streamError?.quota ?? null,
    recoveryStorageError,
    recoveryReady: recoveryScope !== null,
    busy,
    history,
    recoveredMessage: recoveredTurn?.message ?? null,
    draft,
    setDraft,
    selectedSkillKey,
    setSelectedSkillKey,
    attachment,
    attachmentError,
    attachmentUploading,
    attachDocument,
    removeAttachment,
    submit,
    regenerate,
    retryRecoveredMessage,
    discardRecoveredMessage,
    startNewConversation,
    stop,
  } as const;
}

export type StoryCanvasAssistantSession = ReturnType<typeof useStoryCanvasAssistantSession>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECOVERED_TEXT_BYTES = 512 * 1_024;

function parseStoryCanvasPendingTurn(value: unknown): StoryCanvasPendingTurn | null {
  if (!isRecord(value) || !isRecord(value.message) || !isRecord(value.metadata)) return null;
  if (!hasOnlyKeys(value, ["message", "metadata"])) return null;
  const { message, metadata } = value;
  if (
    !hasOnlyKeys(message, ["id", "role", "parts"]) ||
    typeof message.id !== "string" ||
    !UUID_PATTERN.test(message.id) ||
    message.role !== "user" ||
    !Array.isArray(message.parts) ||
    message.parts.length < 1 ||
    message.parts.length > 2 ||
    !hasOnlyKeys(metadata, ["selectedSkillKey"])
  ) {
    return null;
  }
  const selectedSkillKey = metadata.selectedSkillKey;
  if (
    selectedSkillKey !== null &&
    (typeof selectedSkillKey !== "string" ||
      !STORY_DIRECTING_SKILL_KEYS.includes(selectedSkillKey as StoryDirectingSkillKey))
  ) {
    return null;
  }

  // At most one text part and one document part, in any combination ≥ 1.
  let textParts = 0;
  let documentParts = 0;
  for (const part of message.parts) {
    if (!isRecord(part)) return null;
    if (part.type === "text") {
      textParts += 1;
      if (
        textParts > 1 ||
        !hasOnlyKeys(part, ["type", "text"]) ||
        typeof part.text !== "string" ||
        !part.text.trim() ||
        new TextEncoder().encode(part.text).byteLength > MAX_RECOVERED_TEXT_BYTES
      ) {
        return null;
      }
      continue;
    }
    documentParts += 1;
    if (documentParts > 1 || !CopilotDocumentPartSchema.safeParse(part).success) {
      return null;
    }
  }
  if (textParts + documentParts === 0) return null;

  return {
    message: message as unknown as StoryCanvasUIMessage,
    metadata: {
      selectedSkillKey: selectedSkillKey as StoryDirectingSkillKey | null,
    },
  };
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key)) && keys.every((key) => key in value);
}
