"use client";

import { createContext, useContext } from "react";
import type { StoryBuildDiagnostic } from "@/lib/story-projects-api";
import { storyDecisionCanvasNodeId } from "./story-project-canvas-model";

/**
 * Blocking-issue projection for the canvas. A diagnostic is pinned to a node
 * when its entityId is the node's stable id — or, for a choice-level issue,
 * the derived decision card that edits those choices. Everything else
 * (missing entry, project-level failures, targets that do not exist) stays
 * project-scoped.
 */
export interface StoryCanvasValidation {
  issuesByNodeId: ReadonlyMap<string, StoryBuildDiagnostic[]>;
  projectIssues: readonly StoryBuildDiagnostic[];
}

const EMPTY_ISSUES: readonly StoryBuildDiagnostic[] = [];

export function groupStoryCanvasIssues(
  diagnostics: readonly StoryBuildDiagnostic[],
  canvasNodeIds: ReadonlySet<string>
): StoryCanvasValidation {
  const issuesByNodeId = new Map<string, StoryBuildDiagnostic[]>();
  const projectIssues: StoryBuildDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "error") continue;
    const ownerId = storyDiagnosticOwnerNodeId(diagnostic, canvasNodeIds);
    if (!ownerId) {
      projectIssues.push(diagnostic);
      continue;
    }
    const bucket = issuesByNodeId.get(ownerId);
    if (bucket) bucket.push(diagnostic);
    else issuesByNodeId.set(ownerId, [diagnostic]);
  }
  return { issuesByNodeId, projectIssues };
}

function storyDiagnosticOwnerNodeId(
  diagnostic: StoryBuildDiagnostic,
  canvasNodeIds: ReadonlySet<string>
): string | null {
  const entityId = diagnostic.entityId;
  if (!entityId) return null;
  // A choice-level blocker is edited on the derived decision card that hangs
  // off the scene, so prefer that card when the projection has one.
  if (diagnostic.entityType === "choice") {
    const decisionCardId = storyDecisionCanvasNodeId(entityId);
    if (canvasNodeIds.has(decisionCardId)) return decisionCardId;
  }
  return canvasNodeIds.has(entityId) ? entityId : null;
}

export const StoryCanvasValidationContext = createContext<
  ((nodeId: string) => readonly StoryBuildDiagnostic[]) | null
>(null);

export const NO_STORY_NODE_ISSUES: readonly StoryBuildDiagnostic[] = [];

export function useStoryNodeIssues(nodeId: string): readonly StoryBuildDiagnostic[] {
  const issuesForNode = useContext(StoryCanvasValidationContext);
  return issuesForNode?.(nodeId) ?? EMPTY_ISSUES;
}
