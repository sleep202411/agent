import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import type { StoryCanvasNodeData } from "./story-project-canvas-model";
import {
  canConnectStoryChoice,
  canConnectStoryCompletion,
  choiceIdFromHandle,
} from "./story-project-canvas-connections";
import {
  connectSceneContinuation,
  connectChoiceTarget,
  createClipNode,
} from "./story-project-canvas-mutations";

export type BlankDropConnectionPlan =
  | { kind: "scene-continuation"; sourceNodeId: string }
  | { kind: "existing-choice"; sourceNodeId: string; choiceId: string };

export interface ConnectedSceneDropResult {
  content: InteractiveStoryDraftContent;
  createdNodeId: string;
}

/** Resolve a free output before creating a scene; an occupied output must stay intact. */
export function resolveBlankDropConnectionPlan(
  source: StoryCanvasNodeData,
  sourceHandle: string | null
): BlankDropConnectionPlan | null {
  if (source.kind === "decision") {
    const choiceId = choiceIdFromHandle(sourceHandle);
    return choiceId &&
      source.sourceNodeId === source.nodeId &&
      canConnectStoryChoice(source, sourceHandle)
      ? { kind: "existing-choice", sourceNodeId: source.nodeId, choiceId }
      : null;
  }
  return sourceHandle === "completion" && canConnectStoryCompletion(source)
    ? { kind: "scene-continuation", sourceNodeId: source.nodeId }
    : null;
}

/** Creates a scene and connects it to the source in one immutable draft mutation. */
export function createConnectedSceneForBlankDrop(
  content: InteractiveStoryDraftContent,
  source: StoryCanvasNodeData,
  sourceHandle: string | null
): ConnectedSceneDropResult | null {
  const plan = resolveBlankDropConnectionPlan(source, sourceHandle);
  if (!plan) return null;
  const created = createClipNode(content);
  const createdNodeId = created.created.nodeId;
  const next =
    plan.kind === "scene-continuation"
      ? connectSceneContinuation(created.content, plan.sourceNodeId, createdNodeId)
      : connectChoiceTarget(created.content, plan.sourceNodeId, plan.choiceId, createdNodeId);
  return { content: next, createdNodeId };
}
