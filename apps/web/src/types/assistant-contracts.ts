export const assistantAgentTypes = [
  "general",
  "script",
  "storyboard",
  "character",
  "scene",
  "ad",
  "novel",
] as const;

export type AssistantAgentType = (typeof assistantAgentTypes)[number];

export const assistantEntityTypes = [
  "project",
  "world",
  "episode",
  "character",
  "scene",
  "prop",
  "shot_value",
  "storyboard",
] as const;

export type AssistantEntityType = (typeof assistantEntityTypes)[number];

export const assistantMutationActions = [
  "project.updated",
  "world.updated",
  "episode.created",
  "episode.batch_created",
  "episode.updated",
  "episode.deleted",
  "character.created",
  "character.updated",
  "character.deleted",
  "character.batch_created",
  "scene.created",
  "scene.updated",
  "scene.deleted",
  "scene.batch_created",
  "prop.created",
  "prop.updated",
  "prop.deleted",
  "prop.batch_created",
  "storyboard.cell_filled",
  "storyboard.saved",
  "storyboard.pipeline_applied",
] as const;

export type AssistantMutationAction = (typeof assistantMutationActions)[number];

export const assistantUiToolNames = [
  "show_options",
  "confirm_action",
  "configure_params",
  "require_project_params",
] as const;

export type AssistantUiToolName = (typeof assistantUiToolNames)[number];

export const assistantProposalToolNames = [
  "propose_characters",
  "propose_scenes",
  "propose_props",
  "propose_storyboard_patch",
  "propose_script",
] as const;

export type AssistantProposalToolName = (typeof assistantProposalToolNames)[number];

export const assistantInteractiveToolNames = [
  ...assistantUiToolNames,
  ...assistantProposalToolNames,
] as const;

export type AssistantInteractiveToolName = (typeof assistantInteractiveToolNames)[number];

export interface AssistantAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /**
   * Server-side text-cache handle (`att_xxx`) returned by
   * `/aurora/assistant/upload-attachment`. This is what the chat
   * pipeline consumes: `preprocessMessages` / `collectAttachmentRefs`
   * on the Nest side resolve the ref to the cached full text. Every
   * attachment produced by the current upload flow carries one.
   */
  ref?: string;
  /**
   * Legacy OSS storage key. Only present on messages persisted before
   * the direct-ingestion flow; never produced by new uploads.
   */
  path?: string;
  /**
   * Legacy OSS direct link, same vintage as `path`. Kept so old chat
   * history keeps rendering/downloading; never produced by new uploads.
   */
  url?: string;
  excerpt?: string;
  status?: "uploading" | "uploaded" | "error";
  error?: string;
}

export interface AssistantTransportMessageMetadata {
  attachments?: AssistantAttachment[];
}

export interface AssistantTransportMessagePart {
  type: string;
  [key: string]: unknown;
}

export interface AssistantTransportMessage {
  id?: string;
  role: "system" | "user" | "assistant";
  metadata?: AssistantTransportMessageMetadata;
  parts: AssistantTransportMessagePart[];
}

export interface AssistantWorkspaceSelection {
  worldId?: string | null;
  episodeId?: string | null;
  activeTab?: string | null;
  activePanel?: string | null;
  /** Browser UI language (from document.documentElement.lang). */
  locale?: string | null;
  /**
   * Project's chosen dialogue language — distinct from `locale`. User picks
   * it in ProjectParamsForm; downstream workflows (script_phase,
   * storyboard_phase) use this to decide what language to generate dialogue
   * in. Not persisted to Java — read from chat history (most recent
   * `tool-require_project_params` output) via readMostRecentProjectParam.
   */
  dialogLanguage?: string | null;
  /** Project's chosen visual style id (from projectDetail.stylePainting). */
  stylePainting?: string | null;
  /**
   * Target shots per episode for storyboard_phase. Read from chat history
   * (most recent ProjectParamsForm submission embedded in the
   * `tool-require_project_params` tool output) — Java has no column.
   * Flows assistantSlice.buildWorkspaceContext → server → x-storyos-context
   * → StoryosContext.shotsPerEpisode.
   */
  shotsPerEpisode?: number | null;
  /**
   * Target number of episodes the user wants. Same chat-history-as-source-
   * of-truth story as shotsPerEpisode — Java has no column. Used by
   * supervisor to plumb into parse_script / episode_phase / main_flow /
   * script_*_flow inputData.
   */
  targetEpisodeCount?: number | null;
  videoPromptStyle?: "default" | "seedance";
}

export interface AssistantWorkspaceContext extends AssistantWorkspaceSelection {
  projectId: string;
}

export interface AssistantMutationResult {
  success: boolean;
  action: AssistantMutationAction;
  message: string;
  entityId?: string;
  entityType?: AssistantEntityType;
  count?: number;
  entityIds?: string[];
}

export interface AssistantOptionItem {
  id: string;
  label: string;
  description?: string;
}

export interface AssistantShowOptionsInput {
  title: string;
  description?: string;
  options: AssistantOptionItem[];
  multiple?: boolean;
}

export interface AssistantShowOptionsResult {
  selectedIds: string[];
  notes?: string;
}

export interface AssistantConfirmActionInput {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface AssistantConfirmActionResult {
  confirmed: boolean;
  notes?: string;
}

export interface AssistantConfigureParamsField {
  key: string;
  label: string;
  type: "number" | "text" | "select";
  defaultValue: string | number;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  suffix?: string;
}

export interface AssistantConfigureParamsInput {
  title: string;
  description?: string;
  fields: AssistantConfigureParamsField[];
}

export interface AssistantConfigureParamsResult {
  confirmed: boolean;
  values?: Record<string, unknown>;
}

/**
 * Signal tool — supervisor calls this when it detects the user wants to
 * create but the project's 4 core params (aspectRatioType / chapterLength /
 * stylePainting / dialogLanguage) aren't all set. Frontend renders
 * ProjectParamsForm; submit → confirmed:true, supervisor continues.
 */
/** @see `apps/agent/src/mastra/tools/meta/require-params.ts` for the source-of-truth schema. */
export interface SuggestedProjectParams {
  stylePainting?: string;
  chapterLength?: number;
  targetEpisodeCount?: number;
  dialogLanguage?: string;
  aspectRatioType?: string;
  reasoning?: string;
}

export interface AssistantRequireProjectParamsInput {
  /** Optional short explanation the LLM can pass — not rendered, just logged. */
  reason?: string;
  suggestedParams?: SuggestedProjectParams;
}

export interface AssistantRequireProjectParamsResult {
  confirmed: boolean;
}

export type AssistantProposalAction = "accept" | "accept_edited" | "reject";

export interface AssistantRoleProposal {
  name: string;
  role: "main" | "supporting" | "extra";
  description?: string;
  appearance?: string;
  personality?: string;
  prompt?: string;
}

export interface AssistantProposalInput<T> {
  summary: string;
  items: T[];
}

export type AssistantRoleProposalInput = AssistantProposalInput<AssistantRoleProposal>;

export interface AssistantSceneProposal {
  name: string;
  description?: string;
  prompt?: string;
}

export type AssistantSceneProposalInput = AssistantProposalInput<AssistantSceneProposal>;

export interface AssistantPropProposal {
  name: string;
  description?: string;
  prompt?: string;
}

export type AssistantPropProposalInput = AssistantProposalInput<AssistantPropProposal>;

export interface AssistantStoryboardProposal {
  summary: string;
  headers: string[];
  rows: string[][];
}

export interface AssistantScriptProposalInput {
  episodeId: string;
  episodeTitle: string;
  summary: string;
  content: string;
}

export interface AssistantScriptProposalDecision {
  action: AssistantProposalAction;
  content?: string;
  notes?: string;
}

export interface AssistantProposalDecision<T> {
  action: AssistantProposalAction;
  items?: T[];
  notes?: string;
}

export interface AssistantStoryboardDecision<TDraft> {
  action: AssistantProposalAction;
  draft?: TDraft;
  notes?: string;
}

export interface AssistantChatRequest<TMessage = AssistantTransportMessage> {
  projectId: string;
  messages: TMessage[];
  workspaceContext?: Partial<AssistantWorkspaceSelection>;
  agentType?: AssistantAgentType;
}

export interface AssistantChatValidationIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

export interface AssistantChatErrorResponse {
  message: string;
  issues?: AssistantChatValidationIssue[];
}
