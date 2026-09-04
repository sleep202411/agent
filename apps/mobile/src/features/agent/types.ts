export type AgentCardKind = "world_spec" | "world_cover" | "script" | "character" | "stage";

export type AgentPipelineCard = {
  id: string;
  kind: AgentCardKind;
  title: string;
  actionLabel?: string;
  imageUrl?: string;
  detail?: string;
};

export type StoryProposalArtifactStatus =
  | "proposed"
  | "active"
  | "applying"
  | "applied"
  | "rejected"
  | "failed"
  | "cancelled";

/** Durable Script/Plot/Assets/Storyboard proposal part on an Assistant turn (H5). */
export type StoryStageProposalArtifact = {
  kind: "story_stage_proposal";
  id: string;
  storyAgentRunId: string;
  status: StoryProposalArtifactStatus;
};

/** Sequential asset/clip generation stream in the transcript (H5 compactMobile). */
export type StoryGenerationBatchArtifact = {
  kind: "story_generation_batch";
  id: string;
  generationBatchId: string;
  storyProjectId: string;
  storyChapterId: string;
};

export type StoryTranscriptArtifact = StoryStageProposalArtifact | StoryGenerationBatchArtifact;

export function isStoryStageProposalArtifact(
  artifact: StoryTranscriptArtifact
): artifact is StoryStageProposalArtifact {
  return artifact.kind === "story_stage_proposal";
}

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  cards?: AgentPipelineCard[];
  artifacts?: StoryTranscriptArtifact[];
  attachmentNames?: string[];
  createdAt: string;
};
