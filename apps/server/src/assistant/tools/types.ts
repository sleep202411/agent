import type { WorkspaceService, WorkspaceContext } from '../workspace.service';

export type HeadersLike = Record<string, string | string[] | undefined>;

export type AttachmentInfo = {
  name: string;
  mimeType: string;
  url?: string;
  excerpt?: string;
};

export type AssistantToolContext = {
  headers: HeadersLike;
  ws: WorkspaceService;
  context: WorkspaceContext;
  requireWorldId: () => string;
  requireEpisodeId: () => string;
  /** Full text from user attachments (plain text files only) */
  getAttachmentText: () => string;
  /** All attachment metadata for server-side file download */
  getAttachments: () => AttachmentInfo[];
};
