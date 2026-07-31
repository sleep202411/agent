import type { StudioAgentCanvasPreviewPart } from "@/lib/studio-agent";

import {
  characterCanvasNodeId,
  syntheticEndingNodeId,
  type StoryCanvasNode,
  type StoryCanvasNodeData,
} from "./story-project-canvas-model";

const COLUMN_GAP = 420;
const ROW_GAP = 220;

export interface StoryCanvasAgentPreviewAuthority {
  chapterId: string;
  draftRevision: number;
  contentHash: string;
  layoutRevision: number;
}

export interface StoryCanvasAgentPreviewProjection {
  nodes: StoryCanvasNode[];
  applied: boolean;
}

/**
 * Projects a validated Agent proposal over the canonical graph without ever
 * mutating the graph, layout, or undo history.
 *
 * The authority tuple is deliberately exact. A preview based on an older
 * draft/layout is not "close enough": rendering it after the creator or
 * another actor has changed the story would visually promise a write that the
 * server's CAS gate must reject.
 */
export function projectStoryCanvasAgentPreview({
  preview,
  authority,
  nodes,
  locale,
}: {
  preview: StudioAgentCanvasPreviewPart | null;
  authority: StoryCanvasAgentPreviewAuthority;
  nodes: readonly StoryCanvasNode[];
  locale: string;
}): StoryCanvasAgentPreviewProjection {
  if (!preview || !matchesAuthority(preview, authority)) {
    return { nodes: [...nodes], applied: false };
  }

  const projected = [...nodes];
  const canonicalIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const previewNodeIds = new Set<string>();
  let nextStoryColumn = 0;
  let nextStoryRow = 0;
  let nextCharacterRow = 0;
  let applied = false;

  const maximumX = nodes.reduce((maximum, node) => Math.max(maximum, node.position.x), 0);
  const minimumX = nodes.reduce((minimum, node) => Math.min(minimum, node.position.x), 0);
  const minimumY = nodes.reduce((minimum, node) => Math.min(minimum, node.position.y), 0);

  const markCanonical = (nodeId: string, kind: "replace" | "remove") => {
    const index = canonicalIndex.get(nodeId);
    if (index === undefined) return;
    const current = projected[index]!;
    projected[index] = withPreviewMarker(current, preview.previewId, kind);
    applied = true;
  };

  const appendGhost = (id: string, data: StoryCanvasNodeData, lane: "story" | "character") => {
    if (canonicalIndex.has(id) || previewNodeIds.has(id)) {
      markCanonical(id, "replace");
      return;
    }
    previewNodeIds.add(id);
    const position =
      lane === "character"
        ? {
            x: minimumX - COLUMN_GAP,
            y: minimumY + nextCharacterRow++ * ROW_GAP,
          }
        : {
            x: maximumX + COLUMN_GAP * (1 + nextStoryColumn++),
            y: minimumY + nextStoryRow++ * ROW_GAP,
          };
    projected.push({
      id,
      type: "storyCanvas",
      position,
      selectable: false,
      draggable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      data: {
        ...data,
        agentPreview: { previewId: preview.previewId, kind: "create" },
      },
    });
    applied = true;
  };

  for (const operation of preview.operations) {
    switch (operation.kind) {
      case "story_graph.put_node": {
        const intent = stringProperty(operation.payload, "intent");
        const node = recordProperty(operation.payload, "node");
        const nodeId = node ? stringProperty(node, "nodeId") : null;
        if (!nodeId || !node) break;
        if (intent === "replace" || canonicalIndex.has(nodeId)) {
          markCanonical(nodeId, "replace");
          break;
        }
        const data = graphNodePreviewData(node, locale);
        if (data) appendGhost(nodeId, data, "story");
        break;
      }
      case "story_graph.remove_node": {
        const nodeId = stringProperty(operation.payload, "nodeId");
        if (nodeId) markCanonical(nodeId, "remove");
        break;
      }
      case "story_graph.set_entry_node": {
        const nodeId = stringProperty(operation.payload, "nodeId");
        if (nodeId) markCanonical(nodeId, "replace");
        break;
      }
      case "story_graph.reorder_nodes": {
        for (const nodeId of stringArrayProperty(operation.payload, "nodeIds")) {
          markCanonical(nodeId, "replace");
        }
        break;
      }
      case "story_bible.put_character": {
        const intent = stringProperty(operation.payload, "intent");
        const character = recordProperty(operation.payload, "character");
        const characterId = character ? stringProperty(character, "id") : null;
        if (!characterId || !character) break;
        const canvasNodeId = characterCanvasNodeId(characterId);
        if (intent === "replace" || canonicalIndex.has(canvasNodeId)) {
          markCanonical(canvasNodeId, "replace");
          break;
        }
        appendGhost(
          canvasNodeId,
          {
            kind: "character",
            title: localizedProperty(character, "name", locale, characterId),
            eyebrow: "",
            nodeId: canvasNodeId,
            characterId,
            summary: stringProperty(character, "summary") ?? "",
          },
          "character"
        );
        break;
      }
      case "story_bible.remove_character": {
        const characterId = stringProperty(operation.payload, "characterId");
        if (characterId) markCanonical(characterCanvasNodeId(characterId), "remove");
        break;
      }
      case "story_bible.put_ending": {
        const intent = stringProperty(operation.payload, "intent");
        const ending = recordProperty(operation.payload, "ending");
        const endingId = ending ? stringProperty(ending, "id") : null;
        if (!endingId || !ending) break;
        const canvasNodeId = syntheticEndingNodeId(endingId);
        if (intent === "replace" || canonicalIndex.has(canvasNodeId)) {
          markCanonical(canvasNodeId, "replace");
          break;
        }
        appendGhost(
          canvasNodeId,
          {
            kind: "ending",
            title: localizedProperty(ending, "title", locale, endingId),
            eyebrow: "",
            nodeId: canvasNodeId,
            endingId,
            summary: localizedProperty(ending, "summary", locale, ""),
          },
          "story"
        );
        break;
      }
      case "story_bible.remove_ending": {
        const endingId = stringProperty(operation.payload, "endingId");
        if (endingId) markCanonical(syntheticEndingNodeId(endingId), "remove");
        break;
      }
      case "story_bible.update_overview":
      case "production.replace_notes":
        // These operations have no graph-card projection. The streamed
        // assistant activity still reports them; inventing a canvas node would
        // misrepresent the canonical product model.
        break;
    }
  }

  return { nodes: projected, applied };
}

function matchesAuthority(
  preview: StudioAgentCanvasPreviewPart,
  authority: StoryCanvasAgentPreviewAuthority
): boolean {
  return (
    preview.chapterId === authority.chapterId &&
    preview.baseDraftRevision === authority.draftRevision &&
    preview.baseContentHash === authority.contentHash &&
    preview.baseLayoutRevision === authority.layoutRevision
  );
}

function withPreviewMarker(
  node: StoryCanvasNode,
  previewId: string,
  kind: "replace" | "remove"
): StoryCanvasNode {
  if (node.data.agentPreview?.previewId === previewId && node.data.agentPreview.kind === kind) {
    return node;
  }
  return {
    ...node,
    data: {
      ...node.data,
      agentPreview: { previewId, kind },
    },
  };
}

function graphNodePreviewData(
  node: Record<string, unknown>,
  locale: string
): StoryCanvasNodeData | null {
  const nodeId = stringProperty(node, "nodeId");
  const kind = stringProperty(node, "kind");
  if (!nodeId || (kind !== "clip" && kind !== "text")) return null;
  const exit = recordProperty(node, "exit");
  const exitKind = exit ? stringProperty(exit, "kind") : null;

  if (kind === "clip") {
    return {
      kind,
      title: stringProperty(node, "name") ?? stringProperty(node, "clipKey") ?? nodeId,
      eyebrow: "",
      nodeId,
      clipKey: stringProperty(node, "clipKey") ?? undefined,
      exitKind:
        exitKind === "auto" || exitKind === "choice" || exitKind === "ending"
          ? exitKind
          : undefined,
    };
  }

  return {
    kind,
    title: localizedProperty(node, "title", locale, nodeId),
    eyebrow: "",
    nodeId,
    summary: localizedProperty(node, "body", locale, ""),
    exitKind:
      exitKind === "auto" || exitKind === "choice" || exitKind === "ending" ? exitKind : undefined,
  };
}

function recordProperty(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const property = value[key];
  return property !== null && typeof property === "object" && !Array.isArray(property)
    ? (property as Record<string, unknown>)
    : null;
}

function stringProperty(value: Record<string, unknown>, key: string): string | null {
  const property = value[key];
  return typeof property === "string" && property.trim() ? property.trim() : null;
}

function stringArrayProperty(value: Record<string, unknown>, key: string): string[] {
  const property = value[key];
  return Array.isArray(property)
    ? property.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function localizedProperty(
  value: Record<string, unknown>,
  key: string,
  locale: string,
  fallback: string
): string {
  const localized = recordProperty(value, key);
  if (!localized) return fallback;
  const exact = stringProperty(localized, locale);
  if (exact) return exact;
  const language = locale.split("-")[0]?.toLowerCase();
  const languageMatch = Object.entries(localized)
    .sort(([left], [right]) => left.localeCompare(right))
    .find(
      ([candidateLocale, candidate]) =>
        candidateLocale.split("-")[0]?.toLowerCase() === language &&
        typeof candidate === "string" &&
        candidate.trim()
    );
  if (languageMatch && typeof languageMatch[1] === "string") return languageMatch[1].trim();
  for (const preferred of ["en-US", "zh-CN", "zh-HK"]) {
    const candidate = stringProperty(localized, preferred);
    if (candidate) return candidate;
  }
  const first = Object.entries(localized)
    .sort(([left], [right]) => left.localeCompare(right))
    .find(([, candidate]) => typeof candidate === "string" && candidate.trim());
  return typeof first?.[1] === "string" ? first[1].trim() : fallback;
}
