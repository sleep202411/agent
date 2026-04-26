/**
 * IP feature — types for managed episodes and the interactive video graph.
 *
 * No mock data — the editor starts with empty nodes / edges arrays and
 * fills in as the user builds the flow. Episode lists come from the
 * real project hooks.
 */

import type { Node } from "@xyflow/react";

// ─── Episode types ───────────────────────────────────

export type EpisodeType = "linear" | "interactive";

export interface ManagedEpisode {
  id: string;
  number: number;
  title: string;
  type: EpisodeType;
  price: number;
  status: "draft" | "published";
  videoUrl?: string;
  coverUrl?: string;
  duration?: number;
}

// ─── Interactive video node types ────────────────────

export interface VideoNodeData {
  label: string;
  description: string;
  videoUrl: string;
  duration: number;
  isStart?: boolean;
  isEnding?: boolean;
  choices: ChoiceData[];
  [key: string]: unknown;
}

export interface ChoiceData {
  id: string;
  label: string;
  targetNodeId: string;
}

export type VideoNode = Node<VideoNodeData, "video">;
