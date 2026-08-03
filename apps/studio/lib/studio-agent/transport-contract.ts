import type { UIMessage, UITools } from "ai";

import { AGENT_PLATFORM_INVOCATION_PATH } from "./api-client";
import type { StudioAgentActivityKind, StudioAgentError } from "./view-model";

export const STUDIO_AGENT_INVOCATION_PATH = AGENT_PLATFORM_INVOCATION_PATH;
export const STUDIO_AGENT_ACTIVITY_DATA_PART = "data-studio-agent-activity" as const;
export const STUDIO_AGENT_FAILURE_DATA_PART = "data-studio-agent-failure" as const;
export const STUDIO_AGENT_ATTACHMENT_DATA_PART = "data-studio-agent-attachment" as const;
export const STUDIO_AGENT_CANVAS_PREVIEW_DATA_PART = "data-studio-agent-canvas-preview" as const;

export interface StudioAgentAttachment {
  type: "attachment";
  attachmentId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number | null;
  status: "processing" | "ready" | "failed";
}

export interface StudioAgentActivityPart {
  activityId: string;
  kind: StudioAgentActivityKind;
  label: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  detail: string | null;
  progress: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface StudioAgentFailurePart {
  runId: string;
  error: StudioAgentError;
  failedAt: string;
}

/**
 * A non-canonical, reviewable Story graph proposal.
 *
 * The Agent publishes this immediately before executing the corresponding
 * atomic change-set tool. The canvas may render it as a ghost overlay, but it
 * must never persist it or feed it into undo/redo. The overlay disappears as
 * soon as the matching tool call settles; a successful domain result then
 * causes the normal canonical projection refetch.
 */
export interface StudioAgentCanvasPreviewPart {
  schemaVersion: "story-canvas-preview/v1";
  previewId: string;
  runId: string;
  toolCallId: string;
  chapterId: string;
  baseDraftRevision: number;
  baseContentHash: string;
  baseLayoutRevision: number;
  title: string;
  summary: string;
  operations: ReadonlyArray<{
    kind:
      | "story_bible.update_overview"
      | "story_bible.put_character"
      | "story_bible.remove_character"
      | "story_graph.set_entry_node"
      | "story_graph.put_node"
      | "story_graph.remove_node"
      | "story_graph.reorder_nodes"
      | "production.replace_notes";
    payload: Record<string, unknown>;
  }>;
}

interface StudioAgentDataPartMap {
  "studio-agent-activity": StudioAgentActivityPart;
  "studio-agent-failure": StudioAgentFailurePart;
  "studio-agent-attachment": StudioAgentAttachment;
  "studio-agent-canvas-preview": StudioAgentCanvasPreviewPart;
}

export type StudioAgentDataParts = {
  [TName in keyof StudioAgentDataPartMap]: StudioAgentDataPartMap[TName];
};

export interface StudioAgentMessageMetadata {
  conversationId?: string;
  /** Legacy seed metadata; new messages use conversationId. */
  threadId?: string;
  runId?: string;
  createdAt?: string;
  format?: "plain_text" | "markdown";
  clientMessageId?: string;
  delivery?: "steer" | "enqueue" | "stop_and_send";
}

export type StudioAgentUIMessage = UIMessage<
  StudioAgentMessageMetadata,
  StudioAgentDataParts,
  UITools
>;

export type StudioAgentUIPart = StudioAgentUIMessage["parts"][number];

type NarrowDataPart<TName extends keyof StudioAgentDataParts> = Extract<
  StudioAgentUIPart,
  { type: `data-${TName}` }
>;

export function isStudioAgentDataPart<TName extends keyof StudioAgentDataParts>(
  part: StudioAgentUIPart,
  name: TName
): part is NarrowDataPart<TName> {
  return part.type === `data-${name}`;
}

/** UI metadata for rendering the uploaded artifact beside the prompt. */
export function studioAgentAttachmentPart(
  attachment: StudioAgentAttachment
): Extract<StudioAgentUIPart, { type: typeof STUDIO_AGENT_ATTACHMENT_DATA_PART }> {
  return {
    type: STUDIO_AGENT_ATTACHMENT_DATA_PART,
    id: attachment.attachmentId,
    data: attachment,
  };
}

/**
 * Model-visible reference to a product-owned attachment.
 *
 * The URL is a stable non-fetchable identifier. The Agent Platform resolves it
 * just in time through the signed Domain Gateway and substitutes either a
 * short-lived URL or extracted text only for the provider request.
 */
export function studioAgentAttachmentFilePart(
  attachment: StudioAgentAttachment
): Extract<StudioAgentUIPart, { type: "file" }> {
  return {
    type: "file",
    mediaType: attachment.mediaType,
    filename: attachment.fileName,
    url: `fizzdragon-media://${attachment.attachmentId}`,
  };
}
