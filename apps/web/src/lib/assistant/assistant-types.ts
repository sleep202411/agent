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

export type AssistantRole = "system" | "user" | "assistant";

export type AssistantAttachment = SharedAssistantAttachment & {
  previewUrl?: string;
  hash?: string;
  file?: File;
};

export interface AssistantMessageMetadata {
  attachments?: AssistantAttachment[];
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
  // Workflow dispatch / resume — rendered as a small chip by message-bubble
  invoke_workflow: "启动工作流",
  resume_workflow: "继续工作流",
  // UI tools
  show_options: "Options",
  confirm_action: "Confirm",
  configure_params: "Settings",
  // Proposal tools
  propose_characters: "Character Proposal",
  propose_scenes: "Scene Proposal",
  propose_props: "Prop Proposal",
  propose_storyboard_patch: "Storyboard Draft",
  propose_script: "Script Proposal",
  // Read tools
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
  // Execute tools
  update_project_settings: "Update Project",
  create_episode: "Create Episode",
  update_episode: "Update Episode",
  delete_episode: "Delete Episode",
  create_character: "Create Character",
  batch_create_character: "保存角色",
  batch_create_characters: "Create Characters",
  update_character: "Update Character",
  delete_character: "Delete Character",
  generate_character_image: "生成角色图片",
  create_scene: "Create Scene",
  batch_create_scene: "保存场景",
  batch_create_scenes: "Create Scenes",
  update_scene: "Update Scene",
  delete_scene: "Delete Scene",
  generate_scene_image: "生成场景图片",
  create_prop: "Create Prop",
  batch_create_prop: "保存道具",
  batch_create_props: "Create Props",
  update_prop: "Update Prop",
  delete_prop: "Delete Prop",
  generate_prop_image: "生成道具图片",
  fill_cell: "Fill Cell",
  save_storyboard_draft: "Save Storyboard",
  batch_create_episodes: "Create Episodes",
  batch_update_episodes: "Update Episodes",
  reorder_episodes: "Reorder Episodes",
  save_episode_script: "Save Script",
  // Script agent tools
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
