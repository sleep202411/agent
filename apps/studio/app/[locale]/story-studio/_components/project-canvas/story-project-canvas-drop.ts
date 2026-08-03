import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import type { StoryCanvasNodeData } from "./story-project-canvas-model";
import {
  addChoiceOption,
  connectSceneContinuation,
  connectChoiceTarget,
  createClipNode,
  setEntryNode,
} from "./story-project-canvas-mutations";

type BlankDropSource = Pick<StoryCanvasNodeData, "kind" | "nodeId" | "sourceNodeId" | "exitKind">;

export type BlankDropConnectionPlan =
  | { kind: "entry" }
  | { kind: "scene-continuation"; sourceNodeId: string }
  | { kind: "new-choice"; sourceNodeId: string }
  | { kind: "existing-choice"; sourceNodeId: string; choiceId: string };

export interface ConnectedSceneDropResult {
  content: InteractiveStoryDraftContent;
  createdNodeId: string;
}

export interface ConnectedSceneDropOptions {
  newChoiceLabel?: string;
}

/**
 * Resolves only blank-canvas drops with one unambiguous compatible node kind.
 * Scene completion drops are resolved here only after the contextual
 * creator has chosen a new scene. Choice creation is handled separately.
 */
export function resolveBlankDropConnectionPlan(
  source: BlankDropSource,
  sourceHandle: string | null
): BlankDropConnectionPlan | null {
  if (!sourceHandle) return null;

  if (source.kind === "decision") {
    if (!source.sourceNodeId) return null;
    if (sourceHandle.startsWith("choice-new:")) {
      return { kind: "new-choice", sourceNodeId: source.sourceNodeId };
    }
    const choiceMatch = sourceHandle.match(/^choice:(.+)$/u);
    return choiceMatch
      ? {
          kind: "existing-choice",
          sourceNodeId: source.sourceNodeId,
          choiceId: choiceMatch[1]!,
        }
      : null;
  }

  if (source.kind === "clip") {
    return source.exitKind === "auto" && sourceHandle === "completion"
      ? { kind: "scene-continuation", sourceNodeId: source.nodeId }
      : null;
  }

  return null;
}

/** Creates a playable scene and connects it to the source in one immutable draft mutation. */
export function createConnectedSceneForBlankDrop(
  content: InteractiveStoryDraftContent,
  source: BlankDropSource,
  sourceHandle: string | null,
  locale: string,
  options: ConnectedSceneDropOptions = {}
): ConnectedSceneDropResult | null {
  const plan = resolveBlankDropConnectionPlan(source, sourceHandle);
  if (!plan) return null;

  const created = createClipNode(content);
  const createdNodeId = created.created.nodeId;
  let next = created.content;

  if (plan.kind === "entry") {
    next = setEntryNode(next, createdNodeId);
  } else if (plan.kind === "scene-continuation") {
    next = connectSceneContinuation(next, plan.sourceNodeId, createdNodeId);
  } else if (plan.kind === "new-choice") {
    next = addChoiceOption(next, plan.sourceNodeId, createdNodeId, locale, {
      label: options.newChoiceLabel,
    }).content;
  } else if (plan.kind === "existing-choice") {
    next = connectChoiceTarget(next, plan.sourceNodeId, plan.choiceId, createdNodeId);
  }

  return { content: next, createdNodeId };
}
