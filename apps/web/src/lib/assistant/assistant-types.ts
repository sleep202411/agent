import type {
  AssistantAttachment as SharedAssistantAttachment,
  AssistantChatErrorResponse as SharedAssistantChatErrorResponse,
  AssistantConfirmActionInput as SharedAssistantConfirmActionInput,
  AssistantConfirmActionResult as SharedAssistantConfirmActionResult,
  AssistantEntityType as SharedAssistantEntityType,
  AssistantInteractiveToolName as SharedAssistantInteractiveToolName,
  AssistantMutationResult as SharedAssistantMutationResult,
  AssistantOptionItem as SharedAssistantOptionItem,
  AssistantPropProposalInput as SharedAssistantPropProposalInput,
  AssistantProposalToolName as SharedAssistantProposalToolName,
  AssistantPropProposal as SharedAssistantPropProposal,
  AssistantProposalDecision as SharedAssistantProposalDecision,
  AssistantRoleProposal as SharedAssistantRoleProposal,
  AssistantRoleProposalInput as SharedAssistantRoleProposalInput,
  AssistantSceneProposal as SharedAssistantSceneProposal,
  AssistantSceneProposalInput as SharedAssistantSceneProposalInput,
  AssistantShowOptionsInput as SharedAssistantShowOptionsInput,
  AssistantShowOptionsResult as SharedAssistantShowOptionsResult,
  AssistantConfigureParamsInput as SharedAssistantConfigureParamsInput,
  AssistantConfigureParamsResult as SharedAssistantConfigureParamsResult,
  AssistantRequireProjectParamsInput as SharedAssistantRequireProjectParamsInput,
  AssistantRequireProjectParamsResult as SharedAssistantRequireProjectParamsResult,
  AssistantStoryboardProposal as SharedAssistantStoryboardProposal,
  AssistantStoryboardDecision as SharedAssistantStoryboardDecision,
  AssistantScriptProposalInput as SharedAssistantScriptProposalInput,
  AssistantScriptProposalDecision as SharedAssistantScriptProposalDecision,
  AssistantUiToolName as SharedAssistantUiToolName,
  AssistantWorkspaceSelection as SharedAssistantWorkspaceSelection,
  AssistantWorkspaceContext as SharedAssistantWorkspaceContext,
} from "@/src/types/assistant-contracts";
import { assistantInteractiveToolNames } from "@/src/types/assistant-contracts";
import type { ForcedPersonaKey } from "@repo/shared";

export type AssistantRole = "system" | "user" | "assistant";

export type AssistantAttachment = SharedAssistantAttachment & {
  previewUrl?: string;
  hash?: string;
  file?: File;
};

export interface AssistantMessageMetadata {
  attachments?: AssistantAttachment[];
  /**
   * Marks a synthesized "soft" error message — currently only used by
   * the `streamError` reducer when the synchronous POST to
   * `submit-message-to-agent` fails but the agent run usually still
   * completes via WS. MessageBubble renders this as a small dash +
   * "我开了点小差" line instead of a loud "Request failed: HTTP 500"
   * text bubble between two valid assistant turns.
   */
  kind?: "stream_error";
  rawError?: string;
  /**
   * Set on user messages when the user pinned a designer via the
   * composer's persona pills. Round-trips through Redis storage
   * (server keeps the field on the stored copy) so the bubble can
   * render the same tone-coloured prefix in chat history. The Nest
   * proxy reads this on submit and injects a `<FORCED_PERSONA />`
   * marker into the LLM-facing message; the prompt rule wires it
   * through to the matching `ask_*` consult.
   */
  forcedPersona?: ForcedPersonaKey;
}

export interface AssistantTextPart {
  type: "text";
  text: string;
  state?: "streaming" | "done";
}

export interface AssistantReasoningPart {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
}

export interface AssistantFilePart {
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
}

export interface AssistantSourceUrlPart {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
}

export interface AssistantSourceDocumentPart {
  type: "source-document";
  sourceId: string;
  mediaType: string;
  title: string;
  filename?: string;
}

export type AssistantToolPartState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export interface AssistantToolInvocation<TInput = unknown, TOutput = unknown> {
  type: `tool-${string}`;
  toolCallId: string;
  state: AssistantToolPartState;
  input?: TInput;
  output?: TOutput;
  errorText?: string;
  title?: string;
  providerExecuted?: boolean;
  preliminary?: boolean;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
}

export interface AssistantDataPart<TData = unknown> {
  type: `data-${string}`;
  id?: string;
  data: TData;
}

export interface AssistantStepPart {
  type: "step-start";
}

export type AssistantMessagePart =
  | AssistantTextPart
  | AssistantReasoningPart
  | AssistantFilePart
  | AssistantSourceUrlPart
  | AssistantSourceDocumentPart
  | AssistantToolInvocation
  | AssistantDataPart
  | AssistantStepPart;

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  metadata?: AssistantMessageMetadata;
  parts: AssistantMessagePart[];
}

export type AssistantWorkspaceContext = SharedAssistantWorkspaceContext;

export type AssistantWorkspaceSelection = SharedAssistantWorkspaceSelection;

export type AssistantOptionItem = SharedAssistantOptionItem;

export type AssistantUiToolName = SharedAssistantUiToolName;

export type AssistantProposalToolName = SharedAssistantProposalToolName;

export type AssistantInteractiveToolName = SharedAssistantInteractiveToolName;

export type AssistantShowOptionsInput = SharedAssistantShowOptionsInput;

export type AssistantShowOptionsResult = SharedAssistantShowOptionsResult;

export type AssistantConfirmActionInput = SharedAssistantConfirmActionInput;

export type AssistantConfirmActionResult = SharedAssistantConfirmActionResult;

export type AssistantConfigureParamsInput = SharedAssistantConfigureParamsInput;

export type AssistantConfigureParamsResult = SharedAssistantConfigureParamsResult;

export type AssistantRequireProjectParamsInput = SharedAssistantRequireProjectParamsInput;

export type AssistantRequireProjectParamsResult = SharedAssistantRequireProjectParamsResult;

export type AssistantRoleProposal = SharedAssistantRoleProposal;

export type AssistantRoleProposalInput = SharedAssistantRoleProposalInput;

export type AssistantSceneProposal = SharedAssistantSceneProposal;

export type AssistantSceneProposalInput = SharedAssistantSceneProposalInput;

export type AssistantPropProposal = SharedAssistantPropProposal;

export type AssistantPropProposalInput = SharedAssistantPropProposalInput;

export type AssistantStoryboardProposal = SharedAssistantStoryboardProposal;

export type AssistantProposalDecision<T> = SharedAssistantProposalDecision<T>;

export type AssistantStoryboardDecision =
  SharedAssistantStoryboardDecision<AssistantStoryboardProposal>;

export type AssistantScriptProposalInput = SharedAssistantScriptProposalInput;

export type AssistantScriptProposalDecision = SharedAssistantScriptProposalDecision;

export type AssistantMutationResult = SharedAssistantMutationResult;

export type AssistantEntityType = SharedAssistantEntityType;

export type AssistantChatErrorResponse = SharedAssistantChatErrorResponse;

export interface AssistantToolResult<TOutput = unknown> {
  toolCallId: string;
  toolName: AssistantInteractiveToolName;
  output: TOutput;
}

export interface PendingAssistantToolUi {
  messageId: string;
  toolCallId: string;
  toolName: AssistantInteractiveToolName;
  title?: string;
}

export function isAssistantToolPart(part: AssistantMessagePart): part is AssistantToolInvocation {
  return part.type.startsWith("tool-");
}

export function getAssistantToolName(part: AssistantToolInvocation) {
  return part.type.slice(5) as AssistantInteractiveToolName | string;
}

export function isAssistantInteractiveToolName(
  toolName: string
): toolName is AssistantInteractiveToolName {
  return (assistantInteractiveToolNames as readonly string[]).includes(toolName);
}

export function getAssistantInteractiveToolName(part: AssistantToolInvocation) {
  const toolName = getAssistantToolName(part);
  if (!isAssistantInteractiveToolName(toolName)) {
    throw new Error(`Unexpected non-interactive tool: ${toolName}`);
  }
  return toolName;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // ─── Persona consultations ───────────────────────────────
  ask_scriptwriter: "Consulting Scriptwriter",
  ask_character_designer: "Consulting Character Designer",
  ask_scene_designer: "Consulting Scene Designer",
  ask_prop_designer: "Consulting Prop Designer",
  ask_art_director: "Consulting Art Director",
  ask_storyboard_designer: "Consulting Storyboard Designer",
  ask_episode_planner: "Consulting Episode Planner",

  // ─── Project setup helpers ───────────────────────────────
  analyze_brief: "Analyzing Brief",
  save_project_meta: "Saving Project Info",
  require_project_params: "Project Settings",
  configure_params: "Settings",
  mark_project_params_updated: "Settings Updated",

  // ─── HITL / generative UI ────────────────────────────────
  show_options: "Options",
  confirm_action: "Confirm",

  // ─── State reads / review ────────────────────────────────
  query_context: "Reading Project",
  explain_current_state: "Reading State",
  list_assets: "Listing Assets",
  show_drafts: "Showing Drafts",
  evaluate: "Reviewing Drafts",
  export_scripts: "Exporting Scripts",

  // ─── Project / episode / shot CRUD ───────────────────────
  update_project: "Updating Project",
  update_episode: "Updating Episode",
  delete_episode: "Deleting Episode",
  add_shot: "Adding Shot",
  delete_shot: "Deleting Shot",
  update_storyboard_row: "Updating Storyboard",
  batch_update_storyboard_rows: "Updating Storyboard",

  // ─── Direct batch creates ────────────────────────────────
  batch_create_character: "Saving Characters",
  batch_create_scene: "Saving Scenes",
  batch_create_prop: "Saving Props",

  // ─── Image generation ────────────────────────────────────
  generate_character_image: "Generating Character Image",
  generate_scene_image: "Generating Scene Image",
  generate_prop_image: "Generating Prop Image",
  generate_project_cover: "Generating Cover",

  // ─── Legacy / deprecated (kept so historic chat history
  //     still renders friendly labels — these tools are
  //     no longer registered on the supervisor) ───────────
  invoke_workflow: "Start Workflow",
  resume_workflow: "Resume Workflow",
  cancel_workflow: "Cancel Workflow",
  list_active_workflows: "Active Tasks",
  apply_phase_drafts: "Applying Drafts",
  propose_characters: "Character Proposal",
  propose_scenes: "Scene Proposal",
  propose_props: "Prop Proposal",
  propose_storyboard_patch: "Storyboard Draft",
  propose_script: "Script Proposal",
  get_project_snapshot: "Reading Project",
  get_world_assets: "Reading Assets",
  list_characters: "Listing Characters",
  list_scenes: "Listing Scenes",
  list_props: "Listing Props",
  search_world_assets: "Searching Assets",
  aggregate_world_assets_for_analysis: "Analyzing Assets",
  get_storyboard_snapshot: "Reading Storyboard",
  query_storyboard_rows: "Querying Storyboard",
  aggregate_storyboard_rows_for_analysis: "Analyzing Storyboard",
  update_project_settings: "Update Project",
  create_episode: "Create Episode",
  create_character: "Create Character",
  batch_create_characters: "Create Characters",
  update_character: "Update Character",
  delete_character: "Delete Character",
  create_scene: "Create Scene",
  batch_create_scenes: "Create Scenes",
  update_scene: "Update Scene",
  delete_scene: "Delete Scene",
  create_prop: "Create Prop",
  batch_create_props: "Create Props",
  update_prop: "Update Prop",
  delete_prop: "Delete Prop",
  fill_cell: "Fill Cell",
  save_storyboard_draft: "Save Storyboard",
  batch_create_episodes: "Create Episodes",
  batch_update_episodes: "Update Episodes",
  reorder_episodes: "Reorder Episodes",
  save_episode_script: "Save Script",
  analyze_text: "Analyzing Script",
  map_episodes: "Mapping Episodes",
  create_episodes_and_assets: "Creating Episodes & Assets",
  generate_scripts: "Generating Scripts",
  generate_storyboard: "Generating Storyboard",
};

export function getAssistantToolDisplayName(toolName: string) {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

export function getAssistantMessageText(message: AssistantMessage) {
  return message.parts
    .filter((part): part is AssistantTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

/**
 * Reverse-scan the message stream for the most recent
 * `tool-require_project_params` invocation whose output carries the requested
 * key, and return that value.
 *
 * Why: `targetEpisodeCount`, `shotsPerEpisode`, and `dialogLanguage` aren't
 * persisted by Java — the user's last submitted form value is the only
 * authoritative source. Embedding the values into the tool output (see
 * `confirmProjectParamsFromForm`) makes chat history the single
 * source-of-truth and removes the Redux/localStorage mirror dance that
 * silently dropped values on refetch.
 */
export function readMostRecentProjectParam(
  messages: AssistantMessage[],
  key: "targetEpisodeCount" | "shotsPerEpisode"
): number | undefined;
export function readMostRecentProjectParam(
  messages: AssistantMessage[],
  key: "dialogLanguage"
): string | undefined;
export function readMostRecentProjectParam(
  messages: AssistantMessage[],
  key: "targetEpisodeCount" | "shotsPerEpisode" | "dialogLanguage"
): number | string | undefined {
  // Tool name aliases. Supervisor historically wrote the params to a tool
  // message named `tool-require_project_params`, but the current
  // configure_params tool stores its output under `tool-configure_params`.
  // Reading both lets old + new chat histories resolve cleanly without
  // forcing the agent to rename one back. New aliases land here.
  const PARAM_TOOL_TYPES = new Set(["tool-require_project_params", "tool-configure_params"]);
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (const part of parts) {
      if (
        isAssistantToolPart(part) &&
        PARAM_TOOL_TYPES.has(part.type) &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object"
      ) {
        const v = (part.output as Record<string, unknown>)[key];
        if (key === "dialogLanguage") {
          if (typeof v === "string" && v.length > 0) return v;
        } else {
          if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
        }
      }
    }
  }
  return undefined;
}

/**
 * Reverse-scan the message stream for the supervisor's most recent
 * `invoke_workflow` call against `targetWorkflowName`, and return the
 * `inputData` it passed.
 *
 * Why: `invoke_workflow` is the single ground-truth point where the
 * supervisor decides what fields a phase needs to start (textRef from a
 * docx attachment, feedback from a previous suspended run, …). When the
 * user clicks "重試" / "繼續" on a workflow card, the frontend's
 * `buildInputData` would otherwise have to rebuild that payload from
 * scratch — and any field the supervisor injected (textRef, episodeIds,
 * etc.) would silently drop, leaving the workflow to fail with
 * `Invalid input data: text: Required`. Replaying the prior payload
 * ensures retries / next-step buttons preserve the original intent.
 *
 * Returns `undefined` if no prior invoke_workflow exists for that
 * workflow name (e.g. the user is dispatching it for the first time).
 */
export function findMostRecentInvokeInput(
  messages: AssistantMessage[],
  targetWorkflowName: string
): Record<string, unknown> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (const part of parts) {
      if (part.type !== "tool-invoke_workflow") continue;
      // Both `input` (LLM-supplied) and `output` (with the resolved
      // runId) carry the workflowName; we trust whichever is present.
      const input = (part as { input?: unknown }).input;
      if (!input || typeof input !== "object") continue;
      const obj = input as Record<string, unknown>;
      if (obj.workflowName !== targetWorkflowName) continue;
      const inputData = obj.inputData;
      if (!inputData || typeof inputData !== "object" || Array.isArray(inputData)) continue;
      return inputData as Record<string, unknown>;
    }
  }
  return undefined;
}
