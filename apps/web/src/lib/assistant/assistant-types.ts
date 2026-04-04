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
  AssistantStoryboardProposal as SharedAssistantStoryboardProposal,
  AssistantStoryboardDecision as SharedAssistantStoryboardDecision,
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

export function getAssistantToolDisplayName(toolName: string) {
  switch (toolName) {
    case "show_options":
      return "选项确认";
    case "confirm_action":
      return "操作确认";
    case "propose_characters":
      return "角色提案";
    case "propose_scenes":
      return "场景提案";
    case "propose_props":
      return "道具提案";
    case "propose_storyboard_patch":
      return "分镜草稿提案";
    default:
      return toolName;
  }
}

export function getAssistantMessageText(message: AssistantMessage) {
  return message.parts
    .filter((part): part is AssistantTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}
