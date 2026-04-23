import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { toast } from "sonner";
import { backendApi } from "@/src/lib/api";
import { selectCurrentInstance, type ProjectDetail } from "@/src/store/slices/projectSlice";
import { uploadWorkspaceFile, computeFileHash } from "@/src/lib/uploads/workspace-upload";
import {
  submitMessageToAgent,
  saveConversation,
  fetchConversationHistory,
  clearConversation as clearConversationApi,
  type ConfirmProjectParamsPayload,
} from "@/src/lib/assistant/assistant-client";
import {
  cancelWorkflow,
  startWorkflow,
  type WorkflowName,
} from "@/src/lib/workflow/workflow-client";
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
    videoPromptStyle: "default" as "default" | "seedance",
    sending: false,
    streaming: false,
    error: null as string | null,
    panelOpen: false,
    panelExpanded: false,
    pendingToolUi: [] as PendingAssistantToolUi[],
    submittingToolCallId: null as string | null,
    /** Whether history has been loaded from server */
    historyLoaded: false,
    /** Conversation ID from server */
    conversationId: "" as string,
    /**
     * In-flight generative workflow for this project. Set by ToolWorkflowCard
     * when it sees the workflow enter queued/running, cleared on terminal
     * state. Used to swap the chat composer into a "工作中 + 停止" pill —
     * typing isn't actionable while a workflow is running.
     */
    activeWorkflow: null as {
      runId: string;
      workflowName: WorkflowName;
      status: "queued" | "running" | "suspended";
    } | null,
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

export async function refreshProjectDetail(dispatch: AppDispatch, projectId: string) {
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

/**
 * Run post-turn effects once the agent returns to idle. Looks up the most
 * recent assistant message in state, flips `sending/streaming=false`, and
 * runs any workspace mutation side-effects (touchProjectList, etc.) based
 * on that message's tool outputs.
 *
 * Wired from the project-scoped WS session's onAgentState handler —
 * replaces the post-await block that lived inside each submit thunk in
 * the old SSE pipeline.
 */
export const finalizeTurnOnIdle = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>("assistant/finalizeTurnOnIdle", async (projectId, { dispatch, getState }) => {
  const conversation = getState().assistant.projects[projectId];
  if (!conversation) return;
  const lastAssistant =
    [...conversation.messages].reverse().find((m) => m.role === "assistant") ?? null;
  dispatch(finalizeAssistantMessage({ projectId, message: null }));
  await applyWorkspaceMutationEffects(dispatch, projectId, lastAssistant);
});

function buildWorkspaceContext(state: RootState, projectId: string): AssistantWorkspaceSelection {
  const inst = state.project.instances[projectId] ?? selectCurrentInstance(state);
  const videoPromptStyle = state.assistant.projects[projectId]?.videoPromptStyle ?? "default";
  const detail = inst.detail;
  // Language + style are project-level params the user sets in
  // ProjectParamsForm. dialogLanguage isn't persisted by Java yet — read the
  // localStorage mirror as a fallback for reloaded sessions.
  let dialogLanguage: string | null | undefined = detail?.dialogLanguage;
  if (!dialogLanguage && typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(`fizzos:dialog-language:${projectId}`);
      if (raw && raw.length > 0) dialogLanguage = raw;
    } catch {}
  }
  // shotsPerEpisode — no Java column; localStorage is authoritative. Keep
  // undefined on failure so the agent falls back to its default 15-40.
  let shotsPerEpisode: number | undefined;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(`fizzos:shots-per-episode:${projectId}`);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 5 && n <= 60) shotsPerEpisode = n;
      }
    } catch {}
  }
  // targetEpisodeCount — same localStorage-only story as shotsPerEpisode.
  // Prefer the Redux projectDetail mirror (populated on form submit), fall
  // back to localStorage for reloads where Redux was cleared.
  let targetEpisodeCount: number | undefined =
    typeof detail?.targetEpisodeCount === "number" && detail.targetEpisodeCount > 0
      ? detail.targetEpisodeCount
      : undefined;
  if (targetEpisodeCount === undefined && typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(`fizzos:episode-count:${projectId}`);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 1) targetEpisodeCount = n;
      }
    } catch {}
  }
  return {
    worldId: inst.worldId,
    episodeId: inst.activeEpisodeId,
    activeTab: inst.activeTab,
    activePanel: inst.activePanel,
    locale: typeof document !== "undefined" ? document.documentElement.lang || "zh-CN" : "zh-CN",
    dialogLanguage: dialogLanguage ?? undefined,
    stylePainting: detail?.stylePainting ?? undefined,
    shotsPerEpisode,
    targetEpisodeCount,
    videoPromptStyle,
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
          conversationId: data.conversationId,
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
      if (current?.historyLoaded) return false;
      // Defensive: if we already have real messages (beyond the welcome
      // placeholder), don't re-fetch — a stale empty-history response would
      // clobber an in-flight conversation. historyLoaded *should* already
      // guard this, but panel remounts (Next.js RSC refetch) have been seen
      // to land here mid-stream.
      if ((current?.messages.length ?? 0) > 1) return false;
      return true;
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
    await clearConversationApi(projectId);
    dispatch(resetProjectConversation(projectId));
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
    const typedText =
      current.draftInput.trim() || (uploadedAttachments.length > 0 ? "请结合附件继续分析。" : "");
    if (!typedText && uploadedAttachments.length === 0) return;

    const userMessage = buildUserMessage(typedText, uploadedAttachments);

    dispatch(commitUserMessage({ projectId, userMessage }));

    const abortController = createProjectAbortController(projectId);

    try {
      const nextMessages = getState().assistant.projects[projectId]?.messages ?? [];
      const workspaceContext = buildWorkspaceContext(getState(), projectId);

      await submitMessageToAgent({
        projectId,
        messages: nextMessages,
        workspaceContext,
        signal: abortController.signal,
      });
      // Live updates land via the project-scoped WS session (see
      // chat-session.ts + panel mount). Post-turn effects fire in
      // finalizeTurnOnIdle when agent_state flips to "idle".
    } catch (error) {
      if (abortController.signal.aborted) return;
      const errMsg = error instanceof Error ? error.message : "AI 请求失败";
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

// ─── Apply a persona's suggestedAction (button path) ───
//
// The persona's reply may include a structured `suggestedAction` (see
// `ask-persona.ts`). When the user clicks the "apply" button on a
// tool-persona-card, we post a visible user message like "应用上面的
// 方案：<label>" and let the supervisor match it against the most
// recent ask_* tool result (whose output.suggestedAction carries
// `{tool, input}`) — supervisor then invokes the referenced tool
// directly per the rule in storyos.ts.
//
// Separate from sendUserMessage because that one reads from draftInput;
// this one takes an explicit text so the chat-composer state is left
// alone.

export const applyPersonaAction = createAsyncThunk<
  void,
  { projectId: string; label: string },
  { state: RootState; dispatch: AppDispatch }
>("assistant/applyPersonaAction", async ({ projectId, label }, { dispatch, getState }) => {
  abortProjectStream(projectId);
  dispatch(ensureProject(projectId));

  const userMessage: AssistantMessage = {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    parts: [{ type: "text", text: `应用上面的方案：${label}`, state: "done" }],
  };
  dispatch(commitUserMessage({ projectId, userMessage }));

  const abortController = createProjectAbortController(projectId);

  try {
    const nextMessages = getState().assistant.projects[projectId]?.messages ?? [];
    const workspaceContext = buildWorkspaceContext(getState(), projectId);

    await submitMessageToAgent({
      projectId,
      messages: nextMessages,
      workspaceContext,
      signal: abortController.signal,
    });
  } catch (err) {
    if (abortController.signal.aborted) return;
    const errMsg = err instanceof Error ? err.message : "应用方案失败";
    dispatch(streamError({ projectId, error: errMsg }));
    toast.error(errMsg);
  }
});

// ─── Workflow dispatch via supervisor (button path) ─────
//
// Unified with the freeform chat path (oii-style). Button clicks post a user
// message AND send `forceEnterWorkflow = {workflowName, inputData}` to the
// supervisor. The supervisor sees the flag, skips routing / preflight, still
// produces the pre-dispatch 3-段 persona narration, then invokes the named
// workflow. Single entry point, consistent conversation surface, persona
// narration on every action — at the cost of one extra LLM round-trip
// vs the old direct-to-engine path.

export const startWorkflowFromButton = createAsyncThunk<
  void,
  {
    projectId: string;
    userLabel: string;
    workflowName: WorkflowName;
    inputData?: Record<string, unknown>;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  "assistant/startWorkflowFromButton",
  async ({ projectId, userLabel, workflowName, inputData }, { dispatch, getState }) => {
    abortProjectStream(projectId);
    dispatch(ensureProject(projectId));

    // Enforce single-in-flight-workflow-per-project: if there's already an
    // active workflow for this project (queued / running / suspended), cancel
    // it before starting a new one. Prevents the "retry spawns duplicate
    // runs / 2 cards on screen" problem reported in manual testing.
    const prevActive = getState().assistant.projects[projectId]?.activeWorkflow;
    if (prevActive && prevActive.runId) {
      try {
        await cancelWorkflow(prevActive.runId, projectId);
      } catch (err) {
        // Non-fatal — worst case the old run finishes in the background;
        // its results won't be auto-committed because the user's HITL focus
        // has moved on.
        console.warn(
          "[startWorkflowFromButton] cancelWorkflow failed:",
          err instanceof Error ? err.message : err
        );
      }
    }

    const userMessage: AssistantMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      parts: [{ type: "text", text: userLabel, state: "done" }],
    };
    dispatch(commitUserMessage({ projectId, userMessage }));

    const abortController = createProjectAbortController(projectId);

    try {
      const nextMessages = getState().assistant.projects[projectId]?.messages ?? [];
      const workspaceContext = buildWorkspaceContext(getState(), projectId);

      await submitMessageToAgent({
        projectId,
        messages: nextMessages,
        workspaceContext,
        signal: abortController.signal,
        forceEnterWorkflow: { workflowName, inputData: inputData ?? {} },
      });
    } catch (err) {
      if (abortController.signal.aborted) return;
      const errMsg = err instanceof Error ? err.message : "派发 workflow 失败";
      dispatch(streamError({ projectId, error: errMsg }));
      toast.error(errMsg);
    }
  }
);

// ─── HITL confirm/revise via supervisor (unified path) ──
//
// Same shape as startWorkflowFromButton but for in-flight workflow HITL
// gates. The supervisor sees a `<CONFIRM_WORKFLOW>` tag and calls the
// `resume_workflow` tool, which enqueues a resume job on the engine.
// Replaces the old direct `/workflow/:runId/confirm` REST call so every
// user action on a workflow card flows through the same chat pipe.

export const confirmWorkflowFromButton = createAsyncThunk<
  void,
  {
    projectId: string;
    runId: string;
    userLabel: string;
    approved: boolean;
    feedback?: string;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  "assistant/confirmWorkflowFromButton",
  async ({ projectId, runId, userLabel, approved, feedback }, { dispatch, getState }) => {
    abortProjectStream(projectId);
    dispatch(ensureProject(projectId));

    const userMessage: AssistantMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      parts: [{ type: "text", text: userLabel, state: "done" }],
    };
    dispatch(commitUserMessage({ projectId, userMessage }));

    const abortController = createProjectAbortController(projectId);

    try {
      const nextMessages = getState().assistant.projects[projectId]?.messages ?? [];
      const workspaceContext = buildWorkspaceContext(getState(), projectId);

      await submitMessageToAgent({
        projectId,
        messages: nextMessages,
        workspaceContext,
        signal: abortController.signal,
        confirmWorkflow: { runId, approved, feedback },
      });
    } catch (err) {
      if (abortController.signal.aborted) return;
      const errMsg = err instanceof Error ? err.message : "确认 workflow 失败";
      dispatch(streamError({ projectId, error: errMsg }));
      toast.error(errMsg);
    }
  }
);

// ─── Project params "儲存並繼續" (supervisor-owned save) ──
//
// User submits the ProjectParamsForm. Nest owns the Java write (server is the
// source of truth), we only:
//   1. transition the require_project_params tool part to output-available so
//      the inline form goes readOnly;
//   2. append a visible "信息已確認" user bubble;
//   3. optimistically setDetail so the readOnly form renders with the picked
//      values (Nest will persist them; if it fails we show a toast);
//   4. hit submit-message-to-agent with confirmProjectParams payload so Nest
//      does the Java save + injects <PROJECT_PARAMS_CONFIRMED /> for the LLM.

export const confirmProjectParamsFromForm = createAsyncThunk<
  void,
  {
    projectId: string;
    toolCallId: string;
    params: ConfirmProjectParamsPayload;
    userLabel: string;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  "assistant/confirmProjectParamsFromForm",
  async ({ projectId, toolCallId, params, userLabel }, { dispatch, getState }) => {
    abortProjectStream(projectId);
    dispatch(ensureProject(projectId));

    const current = getState().assistant.projects[projectId] ?? createEmptyConversation();

    const messagesWithToolResult = current.messages.map((message) =>
      message.parts.some((part) => isAssistantToolPart(part) && part.toolCallId === toolCallId)
        ? cloneMessageWithToolResult(message, {
            toolCallId,
            toolName: "require_project_params",
            output: { confirmed: true, autoConfirmed: false },
          })
        : message
    );

    const userMessage: AssistantMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      parts: [{ type: "text", text: userLabel, state: "done" }],
    };
    const nextMessages = [...messagesWithToolResult, userMessage];

    dispatch(commitToolResult({ projectId, messages: nextMessages, toolCallId }));

    const projectDetail = selectCurrentInstance(getState()).detail;
    dispatch(
      setProjectDetail({
        ...(projectDetail ?? {}),
        aspectRatioType: params.aspectRatioType,
        chapterLength: params.chapterLength,
        stylePainting: params.stylePainting,
        dialogLanguage: params.dialogLanguage,
        // Client-side only — Java doesn't persist this yet. See
        // project-params-form.tsx:loadEpisodeCount for the localStorage
        // mirror that survives reload.
        ...(params.targetEpisodeCount != null
          ? { targetEpisodeCount: params.targetEpisodeCount }
          : {}),
      })
    );

    const abortController = createProjectAbortController(projectId);

    try {
      const workspaceContext = buildWorkspaceContext(getState(), projectId);
      await submitMessageToAgent({
        projectId,
        messages: nextMessages,
        workspaceContext,
        signal: abortController.signal,
        confirmProjectParams: params,
      });
    } catch (err) {
      if (abortController.signal.aborted) return;
      const errMsg = err instanceof Error ? err.message : "保存项目参数失败";
      dispatch(streamError({ projectId, error: errMsg }));
      toast.error(errMsg);
    }
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

  // Refresh storyboard if a storyboard proposal was accepted
  if (
    result.toolName === "propose_storyboard_patch" &&
    (result.output as Record<string, unknown>)?.action === "accept"
  ) {
    dispatch(touchStoryboard());
  }

  const abortController = createProjectAbortController(projectId);

  try {
    const workspaceContext = buildWorkspaceContext(getState(), projectId);

    await submitMessageToAgent({
      projectId,
      messages: nextMessages,
      workspaceContext,
      signal: abortController.signal,
    });
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

    setVideoPromptStyle: (
      state,
      action: PayloadAction<{ projectId: string; style: "default" | "seedance" }>
    ) => {
      const { projectId, style } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, videoPromptStyle: style };
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

    /**
     * Streaming text delta — append to the target message's text part in
     * place, no REST fetch. Fires once per WS `message_chunk` frame.
     *
     * Missing-message guard: if `message_chunk` arrives before we've seen
     * `message_added` (race — shouldn't normally happen, since the backend
     * always calls addMessage before the first chunk), drop the delta. The
     * message will eventually land via the normal add/update path with
     * full text, so we won't permanently lose content.
     */
    appendMessageChunk: (
      state,
      action: PayloadAction<{
        projectId: string;
        messageId: string;
        partIndex: number;
        appendText: string;
      }>
    ) => {
      const { projectId, messageId, partIndex, appendText } = action.payload;
      if (!appendText) return;
      const current = state.projects[projectId];
      if (!current) return;
      const msgIdx = current.messages.findIndex((m) => m.id === messageId);
      if (msgIdx < 0) return;
      const msg = current.messages[msgIdx];
      const parts = Array.isArray(msg.parts) ? [...msg.parts] : [];
      // Ensure the target part exists as a text part. If parts is shorter,
      // grow it with empty text parts up to partIndex (rare but possible
      // if a text part appears after some other part).
      while (parts.length <= partIndex) {
        parts.push({ type: "text", text: "", state: "streaming" });
      }
      const existing = parts[partIndex];
      if (
        existing &&
        typeof existing === "object" &&
        (existing as { type?: unknown }).type === "text"
      ) {
        const prev = (existing as { text?: unknown }).text;
        const prevText = typeof prev === "string" ? prev : "";
        parts[partIndex] = {
          ...(existing as object),
          type: "text",
          text: prevText + appendText,
          state: "streaming",
        } as (typeof parts)[number];
      } else {
        // Slot occupied by a non-text part — prepend a new text part instead
        // of clobbering. Shouldn't happen under normal flow; logged as a
        // last-resort fallback.
        parts.splice(partIndex, 0, {
          type: "text",
          text: appendText,
          state: "streaming",
        });
      }
      const nextMessage = { ...msg, parts };
      const messages = current.messages.map((m, i) => (i === msgIdx ? nextMessage : m));
      state.projects[projectId] = { ...current, messages };
    },

    /**
     * Streaming done — mark each text part of the target message as
     * `state: "done"` so the UI can drop the caret / enable actions.
     * Also clears `sending` / `streaming` flags; finalizeTurnOnIdle still
     * runs on the agent_state transition to handle post-turn side effects.
     */
    finalizeMessage: (state, action: PayloadAction<{ projectId: string; messageId: string }>) => {
      const { projectId, messageId } = action.payload;
      const current = state.projects[projectId];
      if (!current) return;
      const msgIdx = current.messages.findIndex((m) => m.id === messageId);
      if (msgIdx < 0) return;
      const msg = current.messages[msgIdx];
      const parts = Array.isArray(msg.parts)
        ? msg.parts.map((p) => {
            if (!p || typeof p !== "object") return p;
            const part = p as { type?: unknown; state?: unknown };
            if (part.type === "text" && part.state === "streaming") {
              return { ...(p as object), state: "done" } as typeof p;
            }
            return p;
          })
        : msg.parts;
      const nextMessage = { ...msg, parts };
      const messages = current.messages.map((m, i) => (i === msgIdx ? nextMessage : m));
      state.projects[projectId] = { ...current, messages };
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
        conversationId: string;
      }>
    ) => {
      const { projectId, messages, conversationId } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      // Guard against clobbering an in-flight conversation with a late/stale
      // empty-history response. Only rewrite messages when we actually got
      // history back, OR when the local conversation is still at the empty
      // welcome state.
      const incomingEmpty = messages.length === 0;
      const localHasContent = current.messages.length > 1;
      const welcomeMsg = createWelcomeMessage();
      const nextMessages =
        incomingEmpty && localHasContent
          ? current.messages
          : messages.length > 0
            ? [welcomeMsg, ...messages]
            : [welcomeMsg];
      state.projects[projectId] = {
        ...current,
        messages: nextMessages,
        historyLoaded: true,
        conversationId,
      };
    },

    markHistoryLoaded: (state, action: PayloadAction<{ projectId: string }>) => {
      const { projectId } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, historyLoaded: true };
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

    setActiveWorkflow: (
      state,
      action: PayloadAction<{
        projectId: string;
        runId: string;
        workflowName: WorkflowName;
        status: "queued" | "running" | "suspended";
      }>
    ) => {
      const { projectId, runId, workflowName, status } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        activeWorkflow: { runId, workflowName, status },
      };
    },

    clearActiveWorkflow: (state, action: PayloadAction<{ projectId: string; runId: string }>) => {
      const { projectId, runId } = action.payload;
      const current = state.projects[projectId];
      if (!current?.activeWorkflow) return;
      // Only clear if this is still the active run — guards against a stale
      // completion event clobbering a newly-started workflow.
      if (current.activeWorkflow.runId !== runId) return;
      state.projects[projectId] = { ...current, activeWorkflow: null };
    },
  },
});

export const {
  ensureProject,
  setPanelOpen,
  setPanelExpanded,
  setAgentType,
  setVideoPromptStyle,
  setDraft,
  pushAttachment,
  updateAttachment,
  removeAttachment,
  commitUserMessage,
  commitToolResult,
  appendStreamChunk,
  appendMessageChunk,
  finalizeMessage,
  finalizeAssistantMessage,
  streamError,
  setHistory,
  markHistoryLoaded,
  resetProjectConversation,
  setActiveWorkflow,
  clearActiveWorkflow,
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
