import type { InteractiveFilmDraftContent } from "@/lib/story-projects-api";
import type { StoryCanvasNodeData } from "./story-project-canvas-model";
import {
  addChoiceOption,
  connectClipContinuation,
  connectAutoRoute,
  connectChoiceTarget,
  createClipNode,
  setEntryNode,
  updateAutoRouteTarget,
} from "./story-project-canvas-mutations";

type BlankDropSource = Pick<StoryCanvasNodeData, "kind" | "nodeId" | "sourceNodeId" | "exitKind">;

export type BlankDropConnectionPlan =
  | { kind: "entry" }
  | { kind: "clip-continuation"; sourceNodeId: string }
  | { kind: "new-auto-route"; sourceNodeId: string }
  | { kind: "existing-auto-route"; sourceNodeId: string; routeIndex: number }
  | { kind: "new-choice"; sourceNodeId: string }
  | { kind: "existing-choice"; sourceNodeId: string; choiceId: string };

export interface ConnectedClipDropResult {
  content: InteractiveFilmDraftContent;
  createdNodeId: string;
}

/**
 * Resolves only blank-canvas drops with one unambiguous compatible node kind.
 * Clip completion drops are resolved here only after the contextual
 * creator has chosen a new clip. Choice creation is handled separately.
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

  if (source.kind === "clip") {
    return source.exitKind === "auto" && sourceHandle === "completion"
      ? { kind: "clip-continuation", sourceNodeId: source.nodeId }
      : null;
  }

  if (source.kind !== "router" || source.exitKind !== "auto") {
    return null;
  }

  const prefix = "route";
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
  } else if (plan.kind === "clip-continuation") {
    next = connectClipContinuation(next, plan.sourceNodeId, createdNodeId);
  } else if (plan.kind === "new-auto-route") {
    next = connectAutoRoute(next, plan.sourceNodeId, createdNodeId);
  } else if (plan.kind === "existing-auto-route") {
    next = updateAutoRouteTarget(next, plan.sourceNodeId, plan.routeIndex, createdNodeId);
  } else if (plan.kind === "new-choice") {
    next = addChoiceOption(next, plan.sourceNodeId, createdNodeId, locale).content;
  } else if (plan.kind === "existing-choice") {
    next = connectChoiceTarget(next, plan.sourceNodeId, plan.choiceId, createdNodeId);
  }

  return { content: next, createdNodeId };
}
