import type { WorkspaceContext } from "../workspace";

export type AssistantToolContext = {
  headers: Headers;
  workspace: WorkspaceContext;
  requireWorldId: () => string;
  requireEpisodeId: () => string;
};
