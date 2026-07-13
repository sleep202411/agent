import type { InteractiveFilmDraftContent } from "@/lib/story-projects-api";
import type { StoryCanvasNodeData } from "./story-project-canvas-model";
import {
  addChoiceOption,
  connectAutoRoute,
  connectChoiceTarget,
  createClipNode,
  setEntryNode,
  updateCheckpointTarget,
  updateAutoRouteTarget,
} from "./story-project-canvas-mutations";

type BlankDropSource = Pick<StoryCanvasNodeData, "kind" | "nodeId" | "sourceNodeId" | "exitKind">;

export type BlankDropConnectionPlan =
  | { kind: "entry" }
  | { kind: "new-auto-route"; sourceNodeId: string }
  | { kind: "existing-auto-route"; sourceNodeId: string; routeIndex: number }
  | { kind: "new-choice"; sourceNodeId: string }
  | { kind: "existing-choice"; sourceNodeId: string; choiceId: string }
  | { kind: "checkpoint"; sourceNodeId: string };

export interface ConnectedClipDropResult {
  content: InteractiveFilmDraftContent;
  createdNodeId: string;
}

/**
 * Resolves only blank-canvas drops with one unambiguous compatible node kind.
 * Ending creation is intentionally excluded: an empty automatic clip exit can
 * lead to another clip or an ending, so silently choosing an ending would be
 * destructive authoring behavior.
 */
export function resolveBlankDropConnectionPlan(
  source: BlankDropSource,
  sourceHandle: string | null
): BlankDropConnectionPlan | null {
  if (!sourceHandle) return null;

  if (source.kind === "root") {
    return sourceHandle === "entry" ? { kind: "entry" } : null;
  }

  if (source.kind === "decision") {
    if (!source.sourceNodeId) return null;
    if (sourceHandle === "choice-new") {
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

  if (source.kind === "clip" && source.exitKind === "checkpoint") {
    return sourceHandle === "checkpoint"
      ? { kind: "checkpoint", sourceNodeId: source.nodeId }
      : null;
  }

  if ((source.kind !== "clip" && source.kind !== "router") || source.exitKind !== "auto") {
    return null;
  }

  const prefix = source.kind === "router" ? "route" : "auto";
  if (sourceHandle === `${prefix}-new`) {
    return { kind: "new-auto-route", sourceNodeId: source.nodeId };
  }
  const routeMatch = sourceHandle.match(new RegExp(`^${prefix}:(\\d+)$`, "u"));
  return routeMatch
    ? {
        kind: "existing-auto-route",
        sourceNodeId: source.nodeId,
        routeIndex: Number(routeMatch[1]),
      }
    : null;
}

/** Creates a clip and connects it to the source in one immutable draft mutation. */
export function createConnectedClipForBlankDrop(
  content: InteractiveFilmDraftContent,
  source: BlankDropSource,
  sourceHandle: string | null,
  locale: string
): ConnectedClipDropResult | null {
  const plan = resolveBlankDropConnectionPlan(source, sourceHandle);
  if (!plan) return null;

  const created = createClipNode(content);
  const createdNodeId = created.created.nodeId;
  let next = created.content;

  if (plan.kind === "entry") {
    next = setEntryNode(next, createdNodeId);
  } else if (plan.kind === "new-auto-route") {
    next = connectAutoRoute(next, plan.sourceNodeId, createdNodeId);
  } else if (plan.kind === "existing-auto-route") {
    next = updateAutoRouteTarget(next, plan.sourceNodeId, plan.routeIndex, createdNodeId);
  } else if (plan.kind === "new-choice") {
    next = addChoiceOption(next, plan.sourceNodeId, createdNodeId, locale).content;
  } else if (plan.kind === "existing-choice") {
    next = connectChoiceTarget(next, plan.sourceNodeId, plan.choiceId, createdNodeId);
  } else {
    next = updateCheckpointTarget(next, plan.sourceNodeId, createdNodeId);
  }

  return { content: next, createdNodeId };
}
