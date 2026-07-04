import type { Edge, Node } from "@xyflow/react";

export type NarrativeNodeKind =
  | "storyRoot"
  | "plot"
  | "ending"
  | "role"
  | "clue"
  | "item"
  | "video";

export type StoryRootDocumentSection = {
  heading: string;
  paragraphs: readonly string[];
};

export type StoryRootOverviewCard = {
  label: string;
  value: string;
};

export type StoryRootStats = {
  roleCount: number;
  plotCount: number;
  clueCount: number;
  endingCount: number;
};

export type CharacterPortraitKey = "female" | "male" | "neutral";

export type NarrativeNodeData = {
  kind: NarrativeNodeKind;
  label: string;
  eyebrow: string;
  summary: string;
  meta?: string;
  status?: "ready" | "working" | "review";
  chips?: string[];
  image?: "avatar" | "item" | "video";
  storyRootMode?: "document";
  storyRootSections?: StoryRootDocumentSection[];
  storyRootOverviewCards?: StoryRootOverviewCard[];
  storyRootStats?: StoryRootStats;
  /** Stage letter (A/B/C…) of a GENERATED plot node — presentational order. */
  plotStage?: string;
  /** The analysis `entryGoal` of a GENERATED plot node (real data). */
  plotGoal?: string;
  characterMode?: "protagonist" | "relation";
  characterPortrait?: CharacterPortraitKey;
  endingType?: "truth" | "intervention" | "failure" | "hidden";
  endingTrigger?: string;
  endingReview?: string;
  clueType?: string;
  clueSource?: string;
  clueUse?: string;
  clueRule?: string;
  onViewStoryRoot?: () => void;
  onViewCharacter?: () => void;
  onEditNode?: () => void;
};

export type NarrativeNode = Node<NarrativeNodeData, "narrative">;
export type NarrativeEdge = Edge & {
  pathOptions?: {
    curvature?: number;
  };
};

export type StoryCanvasSnapshot = Record<string, unknown> & {
  title?: string;
  summary?: string;
  canvas?: {
    nodes?: unknown;
    edges?: unknown;
  };
};
