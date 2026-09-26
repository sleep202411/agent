// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { StoryNodeInspector } from "./story-node-inspector";
import { buildStoryCanvasModel } from "./story-project-canvas-model";

vi.mock("./story-node-storyboard-panel", () => ({
  StoryNodeStoryboardPanel: () => null,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));

describe("StoryNodeInspector film authoring", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the interaction editor for the inspected clip", async () => {
    const content = linearDraft();
    const model = buildStoryCanvasModel(content, "en-US", { clip: "Clip" });
    const onEditInteractions =
      vi.fn<ComponentProps<typeof StoryNodeInspector>["onEditInteractions"]>();

    await act(async () => {
      root.render(
        <StoryNodeInspector
          {...inspectorProps(content)}
          onEditInteractions={onEditInteractions}
          selectedNode={requiredNode(model.nodes, "second")}
        />
      );
    });

    const editInteractions = requiredElement(
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("interactionEditor.entryTitle")
      ) ?? null,
      "edit interactions button"
    );
    await click(editInteractions);
    expect(onEditInteractions).toHaveBeenCalledWith("second");
  });
});

function linearDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: {
      entryNodeId: "opening",
      nodes: [clip("opening", "OPENING", "second"), clip("second", "SECOND", null)],
    },
    productionNotes: [],
  };
}

function clip(nodeId: string, clipKey: string, nextNodeId: string | null) {
  return {
    kind: "clip" as const,
    nodeId,
    clipKey,
    interactions: [],
    exit: {
      kind: "auto" as const,
      routes: [{ target: nextNodeId ? { kind: "node" as const, nodeId: nextNodeId } : null }],
    },
  };
}

function inspectorProps(
  content: InteractiveStoryDraftContent
): Omit<ComponentProps<typeof StoryNodeInspector>, "selectedNode"> {
  return {
    projectId: "project-1",
    content,
    canEdit: true,
    onCloseNode: vi.fn(),
    onDeleteSelected: vi.fn(),
    onUpdateClipMeta: vi.fn(),
    onEditInteractions: vi.fn(),
    locale: "en-US",
    onSetOnEnterEffects: vi.fn(),
    onSetAutoRoutes: vi.fn(),
    onCreateEndingForRoute: vi.fn(),
    onUpdateEnding: vi.fn(),
    onDeleteEnding: vi.fn(),
  };
}

function requiredNode(nodes: ReturnType<typeof buildStoryCanvasModel>["nodes"], id: string) {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node;
}

function requiredElement<T extends Element>(element: T | null, label: string): T {
  if (!element) throw new Error(`Missing ${label}`);
  return element;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}
