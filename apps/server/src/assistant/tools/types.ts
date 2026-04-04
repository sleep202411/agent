import type { WorkspaceService, WorkspaceContext } from '../workspace.service';

export type HeadersLike = Record<string, string | string[] | undefined>;

export type AssistantToolContext = {
  headers: HeadersLike;
  ws: WorkspaceService;
  context: WorkspaceContext;
  requireWorldId: () => string;
  requireEpisodeId: () => string;
};
