// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { StoryNodeInspector } from "./story-node-inspector";
import { buildStoryCanvasModel } from "./story-project-canvas-model";

vi.mock("next-intl", () => ({
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

  it("confirms before replacing an authored choice with a direct continuation", async () => {
    const content = branchingDraft();
    const model = buildStoryCanvasModel(content, "en-US", [], {
      clip: "Clip",
      decision: "Decision",
    });
    const onSetSceneExit = vi.fn<ComponentProps<typeof StoryNodeInspector>["onSetSceneExit"]>();

    await act(async () => {
      root.render(
        <StoryNodeInspector
          {...inspectorProps(content)}
          onSetSceneExit={onSetSceneExit}
          selectedNode={requiredNode(model.nodes, "opening")}
        />
      );
    });

    await click(exitButton(container, "Auto"));
    expect(onSetSceneExit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("inspector.convertExitTitle");

    const confirm = requiredElement(
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "inspector.confirmConversion"
      ) ?? null,
      "exit conversion confirmation"
    );
    await click(confirm);
    expect(onSetSceneExit).toHaveBeenCalledWith("opening", {
      kind: "auto",
      nextNodeId: null,
    });
  });

  it("promotes a clip to the chapter entry", async () => {
    const content = linearDraft();
    const model = buildStoryCanvasModel(content, "en-US", [], {
      clip: "Clip",
      decision: "Decision",
    });
    const onSetEntryNode = vi.fn<ComponentProps<typeof StoryNodeInspector>["onSetEntryNode"]>();

    await act(async () => {
      root.render(
        <StoryNodeInspector
          {...inspectorProps(content)}
          onSetEntryNode={onSetEntryNode}
          selectedNode={requiredNode(model.nodes, "second")}
        />
      );
    });

    await click(entryButton(container));
    expect(onSetEntryNode).toHaveBeenCalledWith("second");
  });
});

function branchingDraft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: {
      entryNodeId: "opening",
      nodes: [
        {
          kind: "clip",
          nodeId: "opening",
          clipKey: "OPENING",
          exit: {
            kind: "choice",
            decisionId: "decision.route",
            prompt: { "en-US": "Which route?" },
            choices: [
              {
                choiceId: "choice.continue",
                label: { "en-US": "Continue" },
                nextNodeId: "second",
              },
            ],
          },
        },
        clip("second", "SECOND", null),
      ],
    },
    productionNotes: [],
  };
}

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
    exit: { kind: "auto" as const, nextNodeId },
  };
}

function inspectorProps(
  content: InteractiveStoryDraftContent
): Omit<ComponentProps<typeof StoryNodeInspector>, "selectedNode"> {
  return {
    content,
    showFoundation: false,
    canEdit: true,
    coverMedia: {
      cover: null,
      candidateAssets: [],
      candidateAssetsLoading: false,
      candidateAssetsError: null,
      onRetryCandidates: vi.fn(),
      onSelectCandidate: vi.fn(),
      onClearSelection: vi.fn(),
      onUpload: vi.fn(),
    },
    onUpdateFoundation: vi.fn(),
    onCloseNode: vi.fn(),
    onDeleteSelected: vi.fn(),
    onUpdateClipMeta: vi.fn(),
    onSetSceneExit: vi.fn(),
    onSetEntryNode: vi.fn(),
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

function entryButton(container: HTMLElement): HTMLButtonElement {
  return requiredElement(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "inspector.entry"
    ) ?? null,
    "entry button"
  );
}

function exitButton(container: HTMLElement, kind: string): HTMLButtonElement {
  return requiredElement(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === `inspector.exit${kind}`
    ) ?? null,
    `${kind} exit button`
  );
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}
