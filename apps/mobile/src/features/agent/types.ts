export type AgentCardKind = "world_spec" | "world_cover" | "script" | "character" | "stage";

export type AgentPipelineCard = {
  id: string;
  kind: AgentCardKind;
  title: string;
  actionLabel?: string;
  imageUrl?: string;
  detail?: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  cards?: AgentPipelineCard[];
  createdAt: string;
};
