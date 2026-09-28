import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { toast } from "sonner";
import { backendApi } from "@/src/lib/api";
import { selectCurrentInstance, type ProjectDetail } from "@/src/store/slices/projectSlice";
import {
  uploadChatAttachment,
  computeFileHash,
  CHAT_ATTACHMENT_MAX_SIZE,
} from "@/src/lib/uploads/workspace-upload";
import {
  submitMessageToAgent,
  fetchConversationHistory,
  clearConversation as clearConversationApi,
  AgentBusyError,
  type ConfirmProjectParamsPayload,
} from "@/src/lib/assistant/assistant-client";
import { cancelWorkflow, type WorkflowName } from "@/src/lib/workflow/workflow-client";
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
import type { AgentState, ForcedPersonaKey } from "@repo/shared";
import {
  getAssistantToolName,
  isAssistantInteractiveToolName,
  isAssistantToolPart,
  readMostRecentProjectParam,
} from "@/src/lib/assistant/assistant-types";
import type { RootState, AppDispatch } from "@/src/store/index";
import {
  setDetail as setProjectDetail,
  touchProjectList,
  touchWorld,
  touchEpisodes,
  touchCharacters,
  touchScenes,
  touchProps,
  touchStoryboard,
} from "./projectSlice";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = CHAT_ATTACHMENT_MAX_SIZE;

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
    /**
     * Server-authoritative agent state. Hydrated from
     * /chat/list-messages on mount/reconnect, then kept in sync via
     * the `agent_state_changed` WS event. The composer's "can submit?"
     * decision and the soft hint above the input both read this — see
     * canSubmit() helper in @repo/shared. Defaults to idle so a
     * fresh-loaded project doesn't appear blocked while we wait for
     * the first network round-trip.
     */
    agentState: { kind: "idle" } as AgentState,
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
    /**
     * Pinned designer for the next outgoing message. Set when the user
     * clicks one of the persona pills in the composer; cleared
     * automatically after `sendUserMessage` so each turn expresses one
     * intent. Drives:
     *   - the inline tone-coloured chip in the textarea (Tiptap atom)
     *   - the tone-coloured ring on the composer card
     *   - the active state on the pill row
     *   - `metadata.forcedPersona` on the user message that flies over
     *     the wire / ends up in chat history
     */
    forcedPersona: null as ForcedPersonaKey | null,
  };
}

export type AssistantConversationState = ReturnType<typeof createEmptyConversation>;

const EMPTY_CONVERSATION = createEmptyConversation();

/**
 * Defense-in-depth: collapse any duplicate message-id entries in a
 * conversation's messages array down to one (the first occurrence).
 *
 * Each individual reducer already finds-and-replaces by id, so the
 * common path produces unique ids. This guard exists to absorb upstream
 * race conditions we don't fully control:
 *   - The backend's `wf_<runId>_<workflowName>_<status>` message publish
 *     does a get-then-add-or-update which is non-atomic; two near-
 *     simultaneous emitters (e.g. cancelWorkflow's immediate publish
 *     and the worker's finalizeCancelled) can both observe "no
 *     existing" and each emit a `message_added` event for the same id.
 *   - Server-side history responses have, on rare occasions, returned
 *     the same id twice when the underlying Redis read straddled a
 *     write.
 *
 * Without this, React's reconciler logs "Encountered two children with
 * the same key" warnings and falls back to position-based diffing,
 * which can cause unstable re-mounts. The helper is O(N) and runs only
 * on the same conversation arrays we're already producing — no extra
 * traversal beyond the existing reducer cost.
 */
function dedupMessagesById<T extends { id: string }>(messages: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

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
    ref: attachment.ref,
    previewUrl: attachment.previewUrl,
    excerpt: attachment.excerpt,
  };
}

function buildUserMessage(
  text: string,
  attachments: AssistantAttachment[],
  forcedPersona: ForcedPersonaKey | null
): AssistantMessage {
  // Attachments travel exclusively through `metadata.attachments` —
  // each carries the server text-cache `ref` that the Nest
  // preprocessor resolves to full text. No `file` parts: the server
  // strips them unconditionally (Mastra can't fetch our storage), so
  // emitting them would only be dead weight in the persisted history.
  const metadataAttachments = attachments.map(sanitizeMessageAttachment);
  const parts: AssistantMessagePart[] = [];

  if (text) {
    parts.push({ type: "text", text, state: "done" });
  }

  const metadata: AssistantMessage["metadata"] = {};
  if (metadataAttachments.length) metadata.attachments = metadataAttachments;
  if (forcedPersona) metadata.forcedPersona = forcedPersona;

  return {
    id: crypto.randomUUID(),
    role: "user",
    metadata: Object.keys(metadata).length ? metadata : undefined,
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
    // Direct-to-Nest upload: extracts text in-process and caches it
    // in Redis under attachment:{ref}. The returned `ref` is the only
    // handle the chat message needs — the server preprocessor resolves
    // it to the full document text, so the LLM sees the whole file
    // without OSS ever participating.
    const uploaded = await uploadChatAttachment(attachment.file, {
      maxSize: MAX_ATTACHMENT_SIZE,
    });

    dispatch(
      updateAttachment({
        projectId,
        attachmentId,
        updates: {
          ref: uploaded.ref,
          status: "uploaded",
          error: undefined,
          excerpt: uploaded.excerpt,
        },
      })
    );
  } catch (error) {
    dispatch(
      updateAttachment({
        projectId,
        attachmentId,
        updates: {
          status: "error",
          error: error instanceof Error ? error.message : "Upload failed",
        },
      })
    );
    toast.error(error instanceof Error ? error.message : "Upload failed");
  }
}

// ─── Async: refresh project detail ──────────────────────

const projectDetailRefreshes = new WeakMap<AppDispatch, Map<string, object>>();

export async function refreshProjectDetail(
  dispatch: AppDispatch,
  projectId: string,
  options: { isCurrent: () => boolean; signal?: AbortSignal }
) {
  if (!options.isCurrent() || options.signal?.aborted) return;
  let requests = projectDetailRefreshes.get(dispatch);
  if (!requests) {
    requests = new Map();
    projectDetailRefreshes.set(dispatch, requests);
  }
  const request = {};
  requests.set(projectId, request);
  const current = () =>
    requests.get(projectId) === request && !options.signal?.aborted && options.isCurrent();
  try {
    const detail = await backendApi.post<ProjectDetail>(`/api/user/project/detail/${projectId}`, {
      signal: options.signal,
    });
    if (current()) dispatch(setProjectDetail(detail));
  } catch (error) {
    if (current()) console.error("[assistantSlice] 刷新项目详情失败:", error);
  } finally {
    if (requests.get(projectId) === request) requests.delete(projectId);
  }
}

async function applyWorkspaceMutationEffects(
  dispatch: AppDispatch,
  projectId: string,
  message: AssistantMessage | null,
  getState: () => RootState
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
        await refreshProjectDetail(dispatch, projectId, {
          isCurrent: () => getState().project.currentProjectId === projectId,
        });
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
  await applyWorkspaceMutationEffects(dispatch, projectId, lastAssistant, getState);
});

function buildWorkspaceContext(state: RootState, projectId: string): AssistantWorkspaceSelection {
  const inst = state.project.instances[projectId] ?? selectCurrentInstance(state);
  const videoPromptStyle = state.assistant.projects[projectId]?.videoPromptStyle ?? "default";
  const detail = inst.detail;
  // dialogLanguage / shotsPerEpisode / targetEpisodeCount — Java has no
  // column for any of them. Read the user's most recent ProjectParamsForm
  // submission directly from chat history (embedded in the
  // tool-require_project_params output). Single source-of-truth, no
  // Redux/localStorage mirroring.
  const messages = state.assistant.projects[projectId]?.messages ?? [];
  const dialogLanguage = readMostRecentProjectParam(messages, "dialogLanguage");
  const shotsPerEpisode = readMostRecentProjectParam(messages, "shotsPerEpisode");
  const targetEpisodeCount = readMostRecentProjectParam(messages, "targetEpisodeCount");
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
    const attachmentId = crypto.randomUUID();

    // No client-side text extraction: the upload endpoint parses the
    // file server-side and returns the authoritative excerpt, which
    // `uploadAttachmentFile` writes onto the attachment on success.
    dispatch(
      pushAttachment({
        projectId,
        attachment: {
          id: attachmentId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          previewUrl,
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
    toast.error("Failed to clear conversation. Please retry.");
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
      toast.warning("Please wait for attachment uploads to finish before sending.");
      return;
    }

    // An attachment is sendable once the server acknowledged ingestion
    // and handed back its text-cache ref. Gating on anything else (the
    // old `attachment.url` check) silently drops the file from the
    // outgoing message — the agent then never sees it.
    const uploadedAttachments = current.attachments.filter(
      (attachment) => attachment.status === "uploaded" && attachment.ref
    );
    const typedText =
      current.draftInput.trim() ||
      (uploadedAttachments.length > 0 ? "Please continue the analysis using the attachments." : "");
    if (!typedText && uploadedAttachments.length === 0) return;

    const userMessage = buildUserMessage(typedText, uploadedAttachments, current.forcedPersona);

    // Stamp the persona pin onto the message *before* clearing it so
    // the optimistic UI render and the wire payload both see it. The
    // pin is a per-turn flag; we always reset after read.
    dispatch(commitUserMessage({ projectId, userMessage }));
    dispatch(setForcedPersona({ projectId, forcedPersona: null }));

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
      // 409 AGENT_BUSY → server says someone else is already running.
      // Don't dump a "Request failed" error bubble; instead echo the
      // server's authoritative state into Redux and show a soft toast.
      // The composer will gate the input naturally because agentState
      // is now `running`.
      if (error instanceof AgentBusyError && error.current) {
        dispatch(setAgentState({ projectId, agentState: error.current }));
        toast(error.message);
        return;
      }
      const errMsg = error instanceof Error ? error.message : "AI request failed";
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

/**
 * User filled the configure_params form. Atomically does three things
 * in one round-trip to the agent:
 *   1. Closes the HITL tool call (commitToolResult with `confirmed: true`)
 *      so the supervisor's tool-call advances visually.
 *   2. Commits a user message with the values — canonical English
 *      `Params set: {...JSON...}` so the supervisor prompt keyword-match
 *      works regardless of user locale.
 *   3. Submits the updated message list to the agent — ONCE. Earlier
 *      split dispatch (separate onToolResult + submitConfigureParams)
 *      caused duplicate submits → two workflow runs.
 */
export const submitConfigureParams = createAsyncThunk<
  void,
  { projectId: string; toolCallId: string; values: Record<string, unknown> },
  { state: RootState; dispatch: AppDispatch }
>(
  "assistant/submitConfigureParams",
  async ({ projectId, toolCallId, values }, { dispatch, getState }) => {
    abortProjectStream(projectId);
    dispatch(ensureProject(projectId));

    const current = getState().assistant.projects[projectId] ?? createEmptyConversation();
    const messagesWithToolClosed = current.messages.map((message) =>
      message.parts.some((part) => isAssistantToolPart(part) && part.toolCallId === toolCallId)
        ? cloneMessageWithToolResult(message, {
            toolCallId,
            toolName: "configure_params",
            output: { confirmed: true },
          })
        : message
    );
    dispatch(
      commitToolResult({
        projectId,
        messages: messagesWithToolClosed,
        toolCallId,
      })
    );

    const userMessage: AssistantMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      parts: [
        {
          type: "text",
          text: `Params set: ${JSON.stringify(values)}`,
          state: "done",
        },
      ],
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
      const errMsg = err instanceof Error ? err.message : "Failed to submit params";
      dispatch(streamError({ projectId, error: errMsg }));
      toast.error(errMsg);
    }
  }
);

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
    parts: [{ type: "text", text: `Apply proposal: ${label}`, state: "done" }],
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
    const errMsg = err instanceof Error ? err.message : "Failed to apply proposal";
    dispatch(streamError({ projectId, error: errMsg }));
    toast.error(errMsg);
  }
});

// ─── Workflow button thunks (DEPRECATED stubs) ─────────
//
// Both `startWorkflowFromButton` and `confirmWorkflowFromButton` used to
// drive the legacy workflow engine through supervisor button paths
// (forceEnterWorkflow + confirmWorkflow body fields on
// /assistant/submit-message-to-agent). The workflow engine was retired
// 2026-05-05 and the supervisor lost its `invoke_workflow` /
// `resume_workflow` tools; the corresponding Nest body-field handling
// has now also been removed. Keeping the thunks as inert stubs so any
// historical workflow tool-card buttons that still reference them
// surface a single toast instead of a TS error / silent failure. The
// buttons themselves should be removed in a follow-up that also
// deletes workflow-message-cards.tsx and the related rendering layer.

export const startWorkflowFromButton = createAsyncThunk<
  void,
  {
    projectId: string;
    userLabel: string;
    workflowName: WorkflowName;
    inputData?: Record<string, unknown>;
  },
  { state: RootState; dispatch: AppDispatch }
>("assistant/startWorkflowFromButton", async () => {
  toast.error("Workflow dispatch path was removed; this button is no longer wired up.");
});

export const confirmWorkflowFromButton = createAsyncThunk<
  void,
  {
    projectId: string;
    runId: string;
    userLabel: string;
    approved: boolean;
    feedback?: string;
    replaceExisting?: boolean;
  },
  { state: RootState; dispatch: AppDispatch }
>("assistant/confirmWorkflowFromButton", async () => {
  toast.error("Workflow HITL confirm path was removed; this button is no longer wired up.");
});

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

    // Embed the user's chosen params in the tool output so chat history is
    // the single source-of-truth for params Java doesn't persist
    // (targetEpisodeCount, shotsPerEpisode). Workflow dispatch reads them
    // back via readMostRecentProjectParam — no Redux/localStorage mirror.
    const messagesWithToolResult = current.messages.map((message) =>
      message.parts.some((part) => isAssistantToolPart(part) && part.toolCallId === toolCallId)
        ? cloneMessageWithToolResult(message, {
            toolCallId,
            toolName: "require_project_params",
            output: {
              confirmed: true,
              autoConfirmed: false,
              ...(params.targetEpisodeCount != null
                ? { targetEpisodeCount: params.targetEpisodeCount }
                : {}),
              ...(params.shotsPerEpisode != null
                ? { shotsPerEpisode: params.shotsPerEpisode }
                : {}),
              ...(params.dialogLanguage ? { dialogLanguage: params.dialogLanguage } : {}),
            },
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

    // Mirror only the Java-persisted params into Redux detail — Java owns
    // aspectRatioType / chapterLength / stylePainting. The client-only
    // params (targetEpisodeCount, shotsPerEpisode, dialogLanguage) live
    // solely in chat history above.
    const projectDetail = selectCurrentInstance(getState()).detail;
    dispatch(
      setProjectDetail({
        ...(projectDetail ?? {}),
        aspectRatioType: params.aspectRatioType,
        chapterLength: params.chapterLength,
        stylePainting: params.stylePainting,
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
      const errMsg = err instanceof Error ? err.message : "Failed to save project settings";
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
    const errMsg = error instanceof Error ? error.message : "AI request failed";
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
      const messages = dedupMessagesById(
        index >= 0
          ? current.messages.map((item, i) => (i === index ? message : item))
          : [...current.messages, message]
      );
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
      const messages = dedupMessagesById(
        message && !current.messages.some((item) => item.id === message.id)
          ? [...current.messages, message]
          : current.messages
      );
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

    /**
     * Re-arm the "AI is replying" indicator when the WS reports the
     * supervisor is back at work mid-turn. Mastra's multi-step
     * supervisor flips `agent_state` between `working` ↔ `idle` between
     * every LLM call within a single user turn (LLM call → tool exec →
     * LLM call → tool exec → …). The transient `idle` already drives
     * `finalizeAssistantMessage`, which clears `sending`; without this
     * reducer the indicator goes dark for the second-and-later LLM
     * calls of the turn even though the agent is actively working.
     *
     * Confirmed 2026-05-02 against the "upload script + ask to break
     * it down" flow: narrative text → analyze_brief → configure_params
     * → invoke_workflow takes 3 distinct LLM calls; only the first one
     * showed loading in chat.
     */
    markAgentWorking: (state, action: PayloadAction<{ projectId: string }>) => {
      const { projectId } = action.payload;
      const current = state.projects[projectId];
      if (!current) return;
      // Don't reactivate the indicator while a pending interactive tool
      // is awaiting user input — the tool card is the actionable
      // surface, a "AI is replying" banner stacked above it is just
      // visual noise. Once the user submits the tool result,
      // `commitToolResult` re-sets `sending=true` for the next LLM
      // turn.
      if (current.pendingToolUi.length > 0) return;
      if (current.sending && current.streaming) return;
      state.projects[projectId] = { ...current, sending: true, streaming: true };
    },

    /**
     * Server-pushed agent state update. Triggered by:
     *   - /chat/list-messages on (re)mount → hydrate `agentStateRich`
     *   - WS `agent_state_changed` event → realtime updates
     *   - 409 AGENT_BUSY response from submit → echo `current` here
     * The composer reads this to gate the input + show a soft hint.
     */
    setAgentState: (
      state,
      action: PayloadAction<{ projectId: string; agentState: AgentState }>
    ) => {
      const { projectId, agentState } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = {
        ...current,
        agentState,
        // Mirror onto the legacy flags so any UI still reading them
        // doesn't get out-of-sync. Once those call-sites are migrated
        // to read `agentState.kind` directly, we can drop these.
        sending: agentState.kind === "running",
        streaming: agentState.kind === "running",
        ...(agentState.kind === "failed" && agentState.lastError
          ? { error: agentState.lastError }
          : {}),
      };
    },

    /**
     * Pin / unpin the designer for the next user message. Source of
     * truth for: pill row active state, in-textarea Tiptap chip,
     * outer ring tone, and the `metadata.forcedPersona` stamped onto
     * the outgoing user message. `sendUserMessage` resets to null
     * after each turn — see thunk for rationale.
     */
    setForcedPersona: (
      state,
      action: PayloadAction<{ projectId: string; forcedPersona: ForcedPersonaKey | null }>
    ) => {
      const { projectId, forcedPersona } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      state.projects[projectId] = { ...current, forcedPersona };
    },

    streamError: (state, action: PayloadAction<{ projectId: string; error: string }>) => {
      const { projectId, error } = action.payload;
      const current = state.projects[projectId] ?? createEmptyConversation();
      // Synthesize a "stream_error" assistant message — MessageBubble
      // detects the metadata kind and renders the soft dash + copy
      // details treatment instead of a raw "Request failed: HTTP 500"
      // text bubble. The agent run usually completes via WS even when
      // this synchronous POST fails (Mastra streams over a separate
      // channel), so the user shouldn't see a loud red error block
      // sandwiched between two valid assistant turns.
      state.projects[projectId] = {
        ...current,
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [{ type: "text", text: "", state: "done" }],
            metadata: { kind: "stream_error", rawError: error },
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
      const nextMessages = dedupMessagesById(
        incomingEmpty && localHasContent
          ? current.messages
          : messages.length > 0
            ? [welcomeMsg, ...messages]
            : [welcomeMsg]
      );
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
  markAgentWorking,
  setAgentState,
  setForcedPersona,
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

/**
 * Resolve the list of runs whose most recent lifecycle state in chat history
 * is still `workflow_queued`. The queue depth in the composer pill, the
 * "cancel all queued" stop button, and any future queue UI all read off
 * this single derivation. Per-run queued cards are intentionally NOT
 * rendered in chat (they're transient state, not history) — keeping all the
 * queue truth in one selector means there's nothing to keep in sync between
 * Redux state, DOM, and the WS feed.
 *
 * Algorithm: walk messages in arrival order, remember the latest workflow_*
 * tool-part type seen for each runId. A runId is "still queued" iff its
 * latest part is `tool-workflow_queued` — once a `_progress` / `_completed`
 * / `_failed` / `_suspended` lands later for the same runId, the run has
 * left the waiting list.
 *
 * O(N) over total parts; messages array is the same one already iterated by
 * the renderer, so no extra read cost in practice. Memoize at the consumer
 * if you need stable reference equality across re-renders.
 */
/**
 * Pure derivation: given a messages list, return the runs whose most recent
 * lifecycle state is still `workflow_queued`. Stateless + side-effect-free
 * so callers can `useMemo([messages])` and get reference stability across
 * renders. (A `useAppSelector` returning a freshly-allocated array per call
 * trips React-Redux's identity warning + re-renders the pill on every
 * dispatch — see the 1006 WS-flap incident from 2026-05-01.)
 */
export function deriveQueuedRuns(
  messages: AssistantMessage[]
): Array<{ runId: string; workflowName: WorkflowName }> {
  // Resolve each runId's "winning" lifecycle phase by PRIORITY, not by
  // array order. Terminal (failed/completed) beats active
  // (progress/suspended) beats queued, regardless of which message ID
  // happened to land first in the chat-msgs list.
  //
  // Why priority over arrival order: chat-publisher writes via
  // `addOrUpdateChatMessage` which rpushes only on first SET NX success.
  // Under racing parallel cancels (e.g. cancelAllQueuedRuns fans out N
  // calls), one cancel's `broadcastQueuePositions` can publish a queued
  // msg for a sibling runId AFTER that sibling's own cancelWorkflow has
  // already published its cancelled msg — leaving the chat list with
  // [cancelled, ..., queued] order for the same runId. Confirmed
  // 2026-05-01 from a live debug session: 6 cancelled runIds all had
  // lifecycle ["failed","queued"] but the runs were genuinely terminated
  // server-side. Array-order derivation pinned the pill at "排隊中 · 6"
  // forever.
  const RANK: Record<string, number> = {
    "tool-workflow_failed": 3,
    "tool-workflow_completed": 3,
    "tool-workflow_suspended": 2,
    "tool-workflow_progress": 2,
    "tool-workflow_queued": 1,
  };
  const winnerByRunId = new Map<string, { type: string; workflowName: string; rank: number }>();
  for (const msg of messages) {
    if (!Array.isArray(msg.parts)) continue;
    for (const part of msg.parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as {
        type?: string;
        output?: { runId?: string; workflowName?: string };
      };
      if (typeof p.type !== "string" || !p.type.startsWith("tool-workflow_")) continue;
      const rank = RANK[p.type] ?? 0;
      if (rank === 0) continue;
      const runId = p.output?.runId;
      const workflowName = p.output?.workflowName;
      if (!runId || !workflowName) continue;
      const existing = winnerByRunId.get(runId);
      if (!existing || rank > existing.rank) {
        winnerByRunId.set(runId, { type: p.type, workflowName, rank });
      }
    }
  }
  const out: Array<{ runId: string; workflowName: WorkflowName }> = [];
  for (const [runId, info] of winnerByRunId) {
    if (info.type === "tool-workflow_queued") {
      out.push({ runId, workflowName: info.workflowName as WorkflowName });
    }
  }
  return out;
}

/** Convenience selector — for non-component callers that don't have a
 *  messages reference handy. Components should prefer
 *  `useMemo(() => deriveQueuedRuns(messages), [messages])` so the resulting
 *  array's identity is stable across renders. */
export function selectQueuedRuns(
  state: { assistant: AssistantStoreState },
  projectId: string | null | undefined
): Array<{ runId: string; workflowName: WorkflowName }> {
  if (!projectId) return [];
  const messages = state.assistant.projects[projectId]?.messages ?? [];
  return deriveQueuedRuns(messages);
}

/**
 * Cancel every run whose latest lifecycle state is queued. Used by the
 * composer pill's stop button when there's no active running run — most
 * users who pressed stop in that state want "stop everything I queued",
 * not "remove just the head". Best-effort per-run: one failed cancel
 * doesn't block the rest. Server-side cleans up BullMQ waiting list +
 * re-broadcasts queue positions per cancel call.
 */
export const cancelAllQueuedRuns = createAsyncThunk<
  void,
  { projectId: string },
  { state: RootState; dispatch: AppDispatch }
>("assistant/cancelAllQueuedRuns", async ({ projectId }, { getState }) => {
  const queued = selectQueuedRuns(getState(), projectId);
  if (queued.length === 0) return;
  await Promise.allSettled(
    queued.map(({ runId }) =>
      cancelWorkflow(runId, projectId).catch((err) => {
        console.warn(
          `[cancelAllQueuedRuns] cancel ${runId} failed:`,
          err instanceof Error ? err.message : err
        );
      })
    )
  );
});
