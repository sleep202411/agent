import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { toast } from "sonner";
import { backendApi } from "@/src/lib/api";
import { selectCurrentInstance, type ProjectDetail } from "@/src/store/slices/projectSlice";
import { uploadWorkspaceFile, computeFileHash } from "@/src/lib/uploads/workspace-upload";
import {
  sendAssistantChat,
  saveConversation,
  fetchConversationHistory,
  clearConversation as clearConversationApi,
} from "@/src/lib/assistant/assistant-client";
import type {
  AssistantAttachment,
  AssistantMessage,
  AssistantMessagePart,
  AssistantMutationResult,
  AssistantToolResult,
  AssistantWorkspaceSelection,
  PendingAssistantToolUi,
} from "@/src/lib/assistant/assistant-types";
import type { AssistantAgentType } from "@/src/types/assistant-contracts";
import {
  getAssistantToolName,
  isAssistantInteractiveToolName,
  isAssistantToolPart,
} from "@/src/lib/assistant/assistant-types";
import type { RootState, AppDispatch } from "@/src/store/index";
import {
  setDetail as setProjectDetail,
  setActivePanel,
  setActiveTab,
  touchProjectList,
  touchWorld,
  touchEpisodes,
  touchCharacters,
  touchScenes,
  touchProps,
  touchStoryboard,
} from "./projectSlice";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

// AbortController per project — used to cancel in-flight streams when a tool result takes over
const streamAbortControllers = new Map<string, AbortController>();

function abortProjectStream(projectId: string) {
  const existing = streamAbortControllers.get(projectId);
  if (existing) {
    existing.abort();
    streamAbortControllers.delete(projectId);
  }
}

function createProjectAbortController(projectId: string) {
  abortProjectStream(projectId);
  const controller = new AbortController();
  streamAbortControllers.set(projectId, controller);
  return controller;
}

function createWelcomeMessage(): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "",
        state: "done",
      },
    ],
  };
}

function createEmptyConversation() {
  return {
    messages: [createWelcomeMessage()] as AssistantMessage[],
    draftInput: "",
    attachments: [] as AssistantAttachment[],
    agentType: "general" as AssistantAgentType,
    sending: false,
    streaming: false,
    error: null as string | null,
    panelOpen: false,
    panelExpanded: false,
    pendingToolUi: [] as PendingAssistantToolUi[],
    submittingToolCallId: null as string | null,
    /** Whether history has been loaded from server */
    historyLoaded: false,
    /** Number of messages loaded from server history (for separator) */
    historyMessageCount: 0,
    /** Message limit for the current tier */
    messageLimit: 50,
    /** Current tier name */
    tier: "free" as string,
    /** Conversation ID from server */
    conversationId: "" as string,
    /** History retention in days */
    retentionDays: 1,
  };
}

export type AssistantConversationState = ReturnType<typeof createEmptyConversation>;

const EMPTY_CONVERSATION = createEmptyConversation();

function isImageMime(mimeType?: string) {
  return Boolean(mimeType?.startsWith("image/"));
}

function getFileExtension(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? (parts.pop() ?? "") : "";
}

function isTextLikeFile(file: File) {
  if (file.type.startsWith("text/")) return true;
  return ["txt", "md", "markdown", "json", "csv", "yaml", "yml", "xml"].includes(
    getFileExtension(file.name)
  );
}

function isDocxFile(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    getFileExtension(file.name) === "docx"
  );
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || getFileExtension(file.name) === "pdf";
}

function isSupportedAttachment(file: File) {
  return isTextLikeFile(file) || isDocxFile(file) || isPdfFile(file);
}

const MAX_EXCERPT_CHARS = 80000;
const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024;

async function readAttachmentExcerpt(file: File): Promise<{ excerpt: string; truncated: boolean }> {
  // PDF and DOCX: text extraction happens server-side.
  // Frontend only uploads the file; excerpt stays empty.
  // Server downloads from OSS and extracts text when pipeline starts.
  if (isPdfFile(file) || isDocxFile(file)) {
    return { excerpt: "", truncated: false };
  }

  // Plain text files: can extract directly in browser (small files)
  if (!isTextLikeFile(file)) return { excerpt: "", truncated: false };
  if (file.size > MAX_TEXT_FILE_SIZE) {
    return { excerpt: "", truncated: true };
  }
  try {
    const text = (await file.text()).trim();
    if (!text) return { excerpt: "", truncated: false };
    const truncated = text.length > MAX_EXCERPT_CHARS;
    return { excerpt: text.slice(0, MAX_EXCERPT_CHARS), truncated };
  } catch {
    return { excerpt: "", truncated: false };
  }
}

function getAttachmentUploadType(file: File) {
  if (file.type.startsWith("image/")) return "PROJECT";
  if (file.type.startsWith("video/")) return "SHOT_VALUE_VIDEO";
  if (file.type.startsWith("audio/")) return "SHOT_VALUE_AUDIO";
  return "WORLD";
}

function cleanupAttachmentPreview(attachment: AssistantAttachment) {
  if (attachment.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

function cleanupConversation(conversation: AssistantConversationState) {
  for (const attachment of conversation.attachments) {
    cleanupAttachmentPreview(attachment);
  }
  for (const message of conversation.messages) {
    for (const attachment of message.metadata?.attachments ?? []) {
      cleanupAttachmentPreview(attachment);
    }
  }
}

function sanitizeMessageAttachment(attachment: AssistantAttachment): AssistantAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    path: attachment.path,
    url: attachment.url,
    previewUrl: attachment.previewUrl,
    excerpt: attachment.excerpt,
  };
}

function buildUserMessage(text: string, attachments: AssistantAttachment[]): AssistantMessage {
  const metadataAttachments = attachments.map(sanitizeMessageAttachment);
  const parts: AssistantMessagePart[] = [];

  if (text) {
    parts.push({ type: "text", text, state: "done" });
  }

  for (const attachment of metadataAttachments) {
    if (attachment.url) {
      parts.push({
        type: "file",
        mediaType: attachment.mimeType || "application/octet-stream",
        filename: attachment.name,
        url: attachment.url,
      });
    }
  }

  return {
    id: crypto.randomUUID(),
    role: "user",
    metadata: metadataAttachments.length ? { attachments: metadataAttachments } : undefined,
    parts,
  };
}

function buildPendingToolUi(messages: AssistantMessage[]): PendingAssistantToolUi[] {
  // Only check the LAST assistant message for pending interactive tools.
  // Historical messages with unfinished tools (e.g. from a refreshed page)
  // should not show as pending — they are stale.
  const pending: PendingAssistantToolUi[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isAssistantToolPart(part)) continue;
      if (part.state !== "input-available" && part.state !== "approval-requested") continue;
      const toolName = getAssistantToolName(part);
      if (!isAssistantInteractiveToolName(toolName)) continue;
      pending.push({
        messageId: message.id,
        toolCallId: part.toolCallId,
        toolName,
        title: part.title,
      });
    }
    break; // Only check the last assistant message
  }
  return pending;
}

function isMutationResult(value: unknown): value is AssistantMutationResult {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return raw.success === true && typeof raw.action === "string" && typeof raw.message === "string";
}

function cloneMessageWithToolResult(
  message: AssistantMessage,
  result: AssistantToolResult
): AssistantMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (!isAssistantToolPart(part) || part.toolCallId !== result.toolCallId) {
        return part;
      }
      return { ...part, state: "output-available", output: result.output };
    }),
  };
}

// ─── State ──────────────────────────────────────────────

interface AssistantStoreState {
  projects: Record<string, AssistantConversationState>;
}

const initialState: AssistantStoreState = {
  projects: {},
};

// ─── Helper: upload attachment (thunk-internal) ─────────

async function uploadAttachmentFile(
  dispatch: AppDispatch,
  getState: () => RootState,
  projectId: string,
  attachmentId: string
) {
  const state = getState();
  const project = state.assistant.projects[projectId];
  const attachment = project?.attachments.find((item) => item.id === attachmentId);

  if (!attachment?.file) return;

  try {
    const uploaded = await uploadWorkspaceFile(attachment.file, {
      uploadType: getAttachmentUploadType(attachment.file),
      sourceType: "LOCAL",
      maxSize: MAX_ATTACHMENT_SIZE,
    });
    const storagePath = uploaded.path;

    dispatch(
      updateAttachment({
        projectId,
        attachmentId,
        updates: { path: storagePath, url: uploaded.url, status: "uploaded", error: undefined },
      })
    );
  } catch (error) {
    dispatch(
      updateAttachment({
        projectId,
        attachmentId,
        updates: {
          status: "error",
          error: error instanceof Error ? error.message : "上传失败",
        },
      })
    );
    toast.error(error instanceof Error ? error.message : "上传失败");
  }
}

// ─── Async: refresh project detail ──────────────────────

async function refreshProjectDetail(dispatch: AppDispatch, projectId: string) {
  try {
    const detail = await backendApi.post<ProjectDetail>(`/api/user/project/detail/${projectId}`);
    dispatch(setProjectDetail(detail));
  } catch (error) {
    console.error("[assistantSlice] 刷新项目详情失败:", error);
  }
}

async function applyWorkspaceMutationEffects(
  dispatch: AppDispatch,
  projectId: string,
  message: AssistantMessage | null
) {
  if (!message) return;

  const outputs = message.parts
    .filter(isAssistantToolPart)
    .filter((part) => part.state === "output-available")
    .map((part) => part.output)
    .filter(isMutationResult);

  if (outputs.length === 0) return;

  for (const output of outputs) {
    switch (output.action) {
      case "project.updated":
        dispatch(touchProjectList());
        await refreshProjectDetail(dispatch, projectId);
        break;
      case "world.updated":
        dispatch(touchWorld());
        break;
      case "episode.created":
      case "episode.batch_created":
      case "episode.updated":
      case "episode.deleted":
        dispatch(touchEpisodes());
        break;
      case "character.created":
      case "character.updated":
      case "character.deleted":
      case "character.batch_created":
        dispatch(touchCharacters());
        break;
      case "scene.created":
      case "scene.updated":
      case "scene.deleted":
      case "scene.batch_created":
        dispatch(touchScenes());
        break;
      case "prop.created":
      case "prop.updated":
      case "prop.deleted":
      case "prop.batch_created":
        dispatch(touchProps());
        break;
      case "storyboard.cell_filled":
      case "storyboard.saved":
        dispatch(touchStoryboard());
        break;
      default:
        break;
    }
  }
}

function buildWorkspaceContext(state: RootState, projectId: string): AssistantWorkspaceSelection {
  const inst = state.project.instances[projectId] ?? selectCurrentInstance(state);
  return {
    worldId: inst.worldId,
    episodeId: inst.activeEpisodeId,
    activeTab: inst.activeTab,
    activePanel: inst.activePanel,
    locale: typeof document !== "undefined" ? document.documentElement.lang || "zh-CN" : "zh-CN",
  };
}

// ─── Thunks ─────────────────────────────────────────────

export const addAttachments = createAsyncThunk<
  void,
  {
    projectId: string;
    files: File[];
    t: (key: string, params?: Record<string, string | number | Date>) => string;
  },
  { state: RootState; dispatch: AppDispatch }
>("assistant/addAttachments", async ({ projectId, files, t }, { dispatch, getState }) => {
  dispatch(ensureProject(projectId));

  const current = getState().assistant.projects[projectId] ?? createEmptyConversation();
  const availableSlots = MAX_ATTACHMENTS - current.attachments.length;

  if (availableSlots <= 0) {
    toast.warning(t("maxAttachments", { max: MAX_ATTACHMENTS }));
    return;
  }

  const incoming = files.slice(0, availableSlots);
  if (incoming.length < files.length) {
    toast.warning(t("maxAttachmentsExceeded", { max: MAX_ATTACHMENTS }));
  }

  for (const file of incoming) {
    if (!isSupportedAttachment(file)) {
      toast.warning(t("unsupportedAttachmentType", { name: file.name }));
      continue;
    }

    if (file.size > MAX_ATTACHMENT_SIZE) {
      toast.warning(
        t("fileExceedsSizeLimit", {
          name: file.name,
          size: Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024),
        })
      );
      continue;
    }

    const hash = await computeFileHash(file);

    const previewUrl = isImageMime(file.type) ? URL.createObjectURL(file) : "";
    const { excerpt, truncated } = await readAttachmentExcerpt(file);

    if (truncated && !excerpt) {
      toast.warning(t("fileTooLargeForAi", { name: file.name, size: 2 }));
    } else if (truncated) {
      toast.info(
        t("fileContentTruncated", { name: file.name, size: Math.round(MAX_EXCERPT_CHARS / 10000) })
      );
    }

    const attachmentId = crypto.randomUUID();

    dispatch(
      pushAttachment({
        projectId,
        attachment: {
          id: attachmentId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          previewUrl,
          excerpt,
          hash,
          file,
          status: "uploading",
        },
      })
    );

    void uploadAttachmentFile(dispatch, getState, projectId, attachmentId);
  }
});

export const retryAttachment = createAsyncThunk<
  void,
  { projectId: string; attachmentId: string },
  { state: RootState; dispatch: AppDispatch }
>("assistant/retryAttachment", async ({ projectId, attachmentId }, { dispatch, getState }) => {
  dispatch(
    updateAttachment({
      projectId,
      attachmentId,
      updates: { status: "uploading", error: undefined },
    })
  );
  await uploadAttachmentFile(dispatch, getState, projectId, attachmentId);
});

// ─── Load history from server ─────────────────────────

export const loadHistory = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>(
  "assistant/loadHistory",
  async (projectId, { dispatch }) => {
    dispatch(ensureProject(projectId));

    try {
      const data = await fetchConversationHistory(projectId);
      dispatch(
        setHistory({
          projectId,
          messages: data.messages as AssistantMessage[],
          messageLimit: data.messageLimit,
          tier: data.tier,
          conversationId: data.conversationId,
          retentionDays: data.retentionDays,
        })
      );
    } catch (error) {
      // History load failure is non-fatal — just use empty conversation
      console.warn("[assistant] Failed to load history:", error);
      dispatch(markHistoryLoaded({ projectId }));
    }
  },
  {
    condition: (projectId, { getState }) => {
      const current = getState().assistant.projects[projectId];
      return !current?.historyLoaded;
    },
  }
);

// ─── Clear conversation ───────────────────────────────

export const newConversation = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>("assistant/newConversation", async (projectId, { dispatch }) => {
  try {
    const data = await clearConversationApi(projectId);
    dispatch(resetProjectConversation(projectId));
    dispatch(
      setMessageLimit({
        projectId,
        messageLimit: data.messageLimit,
      })
    );
  } catch (error) {
    console.warn("[assistant] Failed to clear conversation:", error);
    toast.error("清空对话失败，请重试");
  }
});

// ─── Send single user message ─────────────────────────

export const sendUserMessage = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>(
  "assistant/sendUserMessage",
  async (projectId, { dispatch, getState }) => {
    dispatch(ensureProject(projectId));
    const current = getState().assistant.projects[projectId] ?? createEmptyConversation();

    const hasUploading = current.attachments.some(
      (attachment) => attachment.status === "uploading"
    );
    if (hasUploading) {
      toast.warning("请等待附件上传完成后再发送");
      return;
    }

    const uploadedAttachments = current.attachments.filter(
      (attachment) => attachment.status === "uploaded" && attachment.url
    );
    const text =
      current.draftInput.trim() || (uploadedAttachments.length > 0 ? "请结合附件继续分析。" : "");
    if (!text && uploadedAttachments.length === 0) return;

    const userMessage = buildUserMessage(text, uploadedAttachments);

    dispatch(commitUserMessage({ projectId, userMessage }));

    const abortController = createProjectAbortController(projectId);

    try {
      const nextMessages = getState().assistant.projects[projectId]?.messages ?? [];
      const workspaceContext = buildWorkspaceContext(getState(), projectId);
      const agentType = getState().assistant.projects[projectId]?.agentType ?? "general";

      const finalMessage = await sendAssistantChat({
        projectId,
        messages: nextMessages,
        workspaceContext,
        agentType,
        signal: abortController.signal,
        onMessage: (message) => {
          dispatch(appendStreamChunk({ projectId, message }));
        },
      });

      // If aborted (tool result took over), skip finalization
      if (abortController.signal.aborted) return;

      dispatch(finalizeAssistantMessage({ projectId, message: finalMessage }));
      await applyWorkspaceMutationEffects(dispatch, projectId, finalMessage);

      // Save to Redis (fire-and-forget)
      const finalMessages = getState().assistant.projects[projectId]?.messages ?? [];
      void saveConversation(projectId, finalMessages);
    } catch (error) {
      if (abortController.signal.aborted) return;
      const errMsg = error instanceof Error ? error.message : "AI 请求失败";
      if (errMsg.startsWith("MESSAGE_LIMIT_REACHED:")) {
        const [, cur, max] = errMsg.split(":");
        dispatch(streamError({ projectId, error: `MESSAGE_LIMIT_REACHED:${cur}:${max}` }));
        return;
      }
      dispatch(streamError({ projectId, error: errMsg }));
      toast.error(errMsg);
    }
  },
  {
    condition: (projectId, { getState }) => {
      const current = getState().assistant.projects[projectId];
      return !current?.sending;
    },
  }
);

export const applyToolResult = createAsyncThunk<
  void,
  { projectId: string; result: AssistantToolResult },
  { state: RootState; dispatch: AppDispatch }
>("assistant/applyToolResult", async ({ projectId, result }, { dispatch, getState }) => {
  // Cancel any in-flight stream from the previous sendUserMessage/applyToolResult
  abortProjectStream(projectId);

  dispatch(ensureProject(projectId));
  const current = getState().assistant.projects[projectId] ?? createEmptyConversation();

  const nextMessages = current.messages.map((message) =>
    message.parts.some((part) => isAssistantToolPart(part) && part.toolCallId === result.toolCallId)
      ? cloneMessageWithToolResult(message, result)
      : message
  );

  dispatch(
    commitToolResult({
      projectId,
      messages: nextMessages,
      toolCallId: result.toolCallId,
    })
  );

  const abortController = createProjectAbortController(projectId);

  try {
    const workspaceContext = buildWorkspaceContext(getState(), projectId);
    const agentType = getState().assistant.projects[projectId]?.agentType ?? "general";

    const finalMessage = await sendAssistantChat({
      projectId,
      messages: nextMessages,
      workspaceContext,
      agentType,
      signal: abortController.signal,
      onMessage: (message) => {
        dispatch(appendStreamChunk({ projectId, message }));
      },
    });

    if (abortController.signal.aborted) return;

    dispatch(finalizeAssistantMessage({ projectId, message: finalMessage }));
    await applyWorkspaceMutationEffects(dispatch, projectId, finalMessage);

    // Save to Redis (fire-and-forget)
    const finalMessages = getState().assistant.projects[projectId]?.messages ?? [];
    void saveConversation(projectId, finalMessages);
  } catch (error) {
    if (abortController.signal.aborted) return;
    const errMsg = error instanceof Error ? error.message : "AI 请求失败";
    dispatch(streamError({ projectId, error: errMsg }));
    toast.error(errMsg);
  }
});

// ─── Slice ──────────────────────────────────────────────

export const assistantSlice = createSlice({
  name: "assistant",
  initialState,
  reducers: {
    ensureProject: (state, action: PayloadAction<string>) => {
      if (!state.projects[action.payload]) {
        state.projects[action.payload] = createEmptyConversation();
      }
    },

    setPanelOpen: (state, action: PayloadAction<{ projectId: string; open: boolean }>) => {
      const { projectId, open } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        panelOpen: open,
        panelExpanded: open ? current.panelExpanded : false,
      };
    },

    setPanelExpanded: (state, action: PayloadAction<{ projectId: string; expanded: boolean }>) => {
      const { projectId, expanded } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, panelExpanded: expanded };
    },

    setAgentType: (
      state,
      action: PayloadAction<{ projectId: string; agentType: AssistantAgentType }>
    ) => {
      const { projectId, agentType } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, agentType };
    },

    setDraft: (state, action: PayloadAction<{ projectId: string; draft: string }>) => {
      const { projectId, draft } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, draftInput: draft };
    },

    pushAttachment: (
      state,
      action: PayloadAction<{ projectId: string; attachment: AssistantAttachment }>
    ) => {
      const { projectId, attachment } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        attachments: [...current.attachments, attachment],
      };
    },

    updateAttachment: (
      state,
      action: PayloadAction<{
        projectId: string;
        attachmentId: string;
        updates: Partial<AssistantAttachment>;
      }>
    ) => {
      const { projectId, attachmentId, updates } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        attachments: current.attachments.map((item) =>
          item.id === attachmentId ? { ...item, ...updates } : item
        ),
      };
    },

    removeAttachment: (
      state,
      action: PayloadAction<{ projectId: string; attachmentId: string }>
    ) => {
      const { projectId, attachmentId } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      const target = current.attachments.find((item) => item.id === attachmentId);
      if (target) cleanupAttachmentPreview(target);
      state.projects[projectId] = {
        ...current,
        attachments: current.attachments.filter((item) => item.id !== attachmentId),
      };
    },

    commitUserMessage: (
      state,
      action: PayloadAction<{ projectId: string; userMessage: AssistantMessage }>
    ) => {
      const { projectId, userMessage } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        messages: [...current.messages, userMessage],
        draftInput: "",
        attachments: [],
        sending: true,
        streaming: true,
        error: null,
        submittingToolCallId: null,
      };
    },

    commitToolResult: (
      state,
      action: PayloadAction<{
        projectId: string;
        messages: AssistantMessage[];
        toolCallId: string;
      }>
    ) => {
      const { projectId, messages, toolCallId } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        messages,
        sending: true,
        streaming: true,
        error: null,
        pendingToolUi: buildPendingToolUi(messages),
        submittingToolCallId: toolCallId,
      };
    },

    appendStreamChunk: (
      state,
      action: PayloadAction<{ projectId: string; message: AssistantMessage }>
    ) => {
      const { projectId, message } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      const index = current.messages.findIndex((item) => item.id === message.id);
      const messages =
        index >= 0
          ? current.messages.map((item, i) => (i === index ? message : item))
          : [...current.messages, message];
      const pendingToolUi = buildPendingToolUi(messages);
      // When an interactive tool is detected, stop showing "sending" state
      // so the tool card buttons become actionable immediately.
      const hasNewPendingTool = pendingToolUi.length > 0 && current.pendingToolUi.length === 0;
      state.projects[projectId] = {
        ...current,
        messages,
        pendingToolUi,
        ...(hasNewPendingTool ? { sending: false, streaming: false } : {}),
      };
    },

    finalizeAssistantMessage: (
      state,
      action: PayloadAction<{ projectId: string; message: AssistantMessage | null }>
    ) => {
      const { projectId, message } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      const messages =
        message && !current.messages.some((item) => item.id === message.id)
          ? [...current.messages, message]
          : current.messages;
      state.projects[projectId] = {
        ...current,
        messages,
        sending: false,
        streaming: false,
        error: null,
        pendingToolUi: buildPendingToolUi(messages),
        submittingToolCallId: null,
      };
    },

    streamError: (state, action: PayloadAction<{ projectId: string; error: string }>) => {
      const { projectId, error } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [{ type: "text", text: `请求失败：${error}`, state: "done" }],
          },
        ],
        sending: false,
        streaming: false,
        error,
      };
    },

    setHistory: (
      state,
      action: PayloadAction<{
        projectId: string;
        messages: AssistantMessage[];
        messageLimit: number;
        tier: string;
        conversationId: string;
        retentionDays: number;
      }>
    ) => {
      const { projectId, messages, messageLimit, tier, conversationId, retentionDays } =
        action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      const welcomeMsg = createWelcomeMessage();
      state.projects[projectId] = {
        ...current,
        messages: messages.length > 0 ? [welcomeMsg, ...messages] : [welcomeMsg],
        historyLoaded: true,
        historyMessageCount: messages.length,
        messageLimit,
        tier,
        conversationId,
        retentionDays,
      };
    },

    markHistoryLoaded: (state, action: PayloadAction<{ projectId: string }>) => {
      const { projectId } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, historyLoaded: true };
    },

    setMessageLimit: (
      state,
      action: PayloadAction<{ projectId: string; messageLimit: number }>
    ) => {
      const { projectId, messageLimit } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, messageLimit };
    },

    resetProjectConversation: (state, action: PayloadAction<string>) => {
      const projectId = action.payload;
      const current = state.projects[projectId];
      if (current) cleanupConversation(current);
      state.projects[projectId] = {
        ...createEmptyConversation(),
        panelOpen: current?.panelOpen ?? false,
        panelExpanded: current?.panelExpanded ?? false,
        historyLoaded: true,
      };
    },
  },
});

export const {
  ensureProject,
  setPanelOpen,
  setPanelExpanded,
  setAgentType,
  setDraft,
  pushAttachment,
  updateAttachment,
  removeAttachment,
  commitUserMessage,
  commitToolResult,
  appendStreamChunk,
  finalizeAssistantMessage,
  streamError,
  setHistory,
  markHistoryLoaded,
  setMessageLimit,
  resetProjectConversation,
} = assistantSlice.actions;

// ─── Selectors ──────────────────────────────────────────

export function getAssistantConversation(
  projectId: string | null | undefined,
  state?: RootState
): AssistantConversationState {
  if (!projectId) return EMPTY_CONVERSATION;
  if (state) return state.assistant.projects[projectId] ?? EMPTY_CONVERSATION;
  // For non-React contexts, use store.getState()
  return EMPTY_CONVERSATION;
}

export const selectAssistantConversation = (
  state: { assistant: AssistantStoreState },
  projectId: string | null | undefined
) => {
  if (!projectId) return EMPTY_CONVERSATION;
  return state.assistant.projects[projectId] ?? EMPTY_CONVERSATION;
};
