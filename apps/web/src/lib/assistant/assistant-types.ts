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
  // UI 交互工具
  show_options: "选项确认",
  confirm_action: "操作确认",
  // 提案工具
  propose_characters: "角色提案",
  propose_scenes: "场景提案",
  propose_props: "道具提案",
  propose_storyboard_patch: "分镜草稿提案",
  // 读取工具
  get_project_snapshot: "读取项目概况",
  get_world_assets: "读取世界观资产",
  search_world_assets: "搜索资产",
  aggregate_world_assets_for_analysis: "汇总分析资产",
  get_storyboard_snapshot: "读取分镜概况",
  query_storyboard_rows: "查询分镜数据",
  aggregate_storyboard_rows_for_analysis: "汇总分析分镜",
  // 执行工具
  update_project_settings: "更新项目设置",
  create_episode: "创建剧集",
  update_episode: "更新剧集",
  delete_episode: "删除剧集",
  create_character: "创建角色",
  batch_create_characters: "批量创建角色",
  update_character: "更新角色",
  delete_character: "删除角色",
  create_scene: "创建场景",
  batch_create_scenes: "批量创建场景",
  update_scene: "更新场景",
  delete_scene: "删除场景",
  create_prop: "创建道具",
  batch_create_props: "批量创建道具",
  update_prop: "更新道具",
  delete_prop: "删除道具",
  fill_cell: "填写分镜单元格",
  save_storyboard_draft: "保存分镜草稿",
  batch_create_episodes: "批量创建剧集",
  save_episode_script: "保存剧本",
  propose_script: "剧本提案",
  configure_params: "参数配置",
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
