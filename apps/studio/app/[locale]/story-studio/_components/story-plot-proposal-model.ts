import type { Edge, Node } from "@xyflow/react";
import type { StoryPlotProposal } from "@repo/shared/story-agent";
import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import { storyAutoExit, storyNodeTarget } from "@repo/shared/story-stats";
import {
  buildStoryCanvasModel,
  type StoryCanvasNodeData,
} from "./project-canvas/story-project-canvas-model";
import { storyAuthoringProposalReview } from "./story-authoring-proposal";

export type StoryPlotPreviewNodeData = StoryCanvasNodeData & {
  isEntry: boolean;
  unresolved: boolean;
};

export type StoryPlotPreviewNode = Node<StoryPlotPreviewNodeData, "storyPlotPreview">;
export type StoryPlotPreviewEdge = Edge;

export interface StoryPlotPreviewModel {
  nodes: StoryPlotPreviewNode[];
  edges: StoryPlotPreviewEdge[];
  metrics: {
    nodes: number;
    branches: number;
    endings: number;
  };
  entryTitle: string;
}

/**
 * Projects one immutable Plot proposal through the same canonical canvas model
 * used by the editable Story canvas. The proposal remains the single topology
 * source; this function changes only presentation (compact card type, spacing,
 * and edge color) for a read-only review surface.
 */
export function buildStoryPlotPreviewModel(
  proposal: StoryPlotProposal,
  locale: string,
  sceneLabel: string,
  decisionLabel = "Player decision"
): StoryPlotPreviewModel {
  const review = storyAuthoringProposalReview(proposal);
  const content: InteractiveStoryDraftContent = {
    storyBible: {
      logline: review.logline ?? proposal.screenplay.logline,
      synopsis: review.synopsis ?? proposal.screenplay.synopsis,
      characters: review.characters.map((character) => ({
        ...character,
        images: [],
        voice: null,
      })),
    },
    graph: {
      entryNodeId: proposal.screenplay.entrySceneId,
      nodes: review.scenes.map(
        (scene): StoryGraphNode => ({
          kind: "clip",
          nodeId: scene.nodeId,
          clipKey: scene.clipKey,
          ...(scene.name ? { name: scene.name } : {}),
          ...(scene.description ? { description: scene.description } : {}),
          interactions: [],
          exit:
            scene.exit.kind === "auto"
              ? storyAutoExit(scene.exit.nextNodeId)
              : {
                  kind: "choice",
                  decisionId: scene.exit.decisionId,
                  prompt: scene.exit.prompt,
                  choices: scene.exit.choices.map((choice) => ({
                    choiceId: choice.choiceId,
                    label: choice.label,
                    target: storyNodeTarget(choice.nextNodeId),
                  })),
                },
        })
      ),
    },
    productionNotes: review.productionNotes,
  };
  const canvas = buildStoryCanvasModel(content, locale, {
    clip: sceneLabel,
    decision: decisionLabel,
  });
  const nodes = canvas.nodes.map<StoryPlotPreviewNode>((node) => ({
    id: node.id,
    type: "storyPlotPreview",
    position: {
      // The editable cards reserve room for media and editors. Proposal cards
      // are intentionally shorter, so compress only their screen layout while
      // preserving the canonical layer and branch ordering.
      x: Math.round(node.position.x * 0.78),
      y: Math.round(node.position.y * 0.52),
    },
    draggable: false,
    selectable: false,
    focusable: true,
    data: {
      ...node.data,
      isEntry: node.id === proposal.screenplay.entrySceneId,
      unresolved: proposal.screenplay.unresolvedNodeIds?.includes(node.id) ?? false,
    },
  }));
  const edges = canvas.edges.map<StoryPlotPreviewEdge>((edge) => {
    const isBranch = edge.data.kind === "choice";
    return {
      ...edge,
      type: "smoothstep",
      selectable: false,
      focusable: false,
      label: undefined,
      style: {
        stroke: isBranch ? "rgba(77,141,255,0.72)" : "rgba(255,255,255,0.28)",
        strokeWidth: isBranch ? 1.8 : 1.5,
      },
    };
  });
  const entryTitle =
    nodes.find((node) => node.data.isEntry)?.data.title ?? proposal.screenplay.entrySceneId;

  return {
    nodes,
    edges,
    metrics: {
      nodes: canvas.nodes.length,
      branches: review.metrics.branches,
      endings: review.metrics.endings,
    },
    entryTitle,
  };
}
