import {
  AgentsPG,
  BackgroundTasksPG,
  BlobsPG,
  ChannelsPG,
  DatasetsPG,
  ExperimentsPG,
  FavoritesPG,
  MCPClientsPG,
  MCPServersPG,
  NotificationsPG,
  ObservabilityPG,
  PromptBlocksPG,
  SchedulesPG,
  ScorerDefinitionsPG,
  ScoresPG,
  SkillsPG,
  ToolProviderConnectionsPG,
  WorkflowsPG,
  WorkspacesPG,
} from "@mastra/pg";

const frameworkDomains = [
  NotificationsPG,
  ObservabilityPG,
  ScoresPG,
  ScorerDefinitionsPG,
  PromptBlocksPG,
  AgentsPG,
  MCPClientsPG,
  MCPServersPG,
  WorkspacesPG,
  SkillsPG,
  BlobsPG,
  ToolProviderConnectionsPG,
  WorkflowsPG,
  DatasetsPG,
  ExperimentsPG,
  BackgroundTasksPG,
  FavoritesPG,
  ChannelsPG,
  SchedulesPG,
] as const;

export function exportMastraFrameworkDdl(schema: string): string {
  return frameworkDomains.flatMap((domain) => domain.getExportDDL(schema)).join("\n");
}
