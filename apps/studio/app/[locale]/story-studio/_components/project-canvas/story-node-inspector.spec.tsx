// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { StoryNodeInspector } from "./story-node-inspector";
import {
  buildStoryCanvasModel,
  characterCanvasNodeId,
  syntheticEndingNodeId,
} from "./story-project-canvas-model";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("StoryNodeInspector optional localized fields", () => {
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

  it("renders an omitted text title and creates an omitted ending summary on edit", async () => {
    const content = draftWithoutOptionalCopy();
    const model = buildStoryCanvasModel(content, "en-US");
    const onUpdateEnding = vi.fn<ComponentProps<typeof StoryNodeInspector>["onUpdateEnding"]>();
    const baseProps = inspectorProps(content, onUpdateEnding);

    await act(async () => {
      root.render(
        <StoryNodeInspector {...baseProps} selectedNode={requiredNode(model.nodes, "untitled")} />
      );
    });

    expect(container.querySelector<HTMLInputElement>("#story-text-title")?.value).toBe("");
    expect(container.querySelector<HTMLTextAreaElement>("#story-text-body")?.value).toBe(
      "The story begins."
    );

    await act(async () => {
      root.render(
        <StoryNodeInspector
          {...baseProps}
          selectedNode={requiredNode(model.nodes, syntheticEndingNodeId("finish"))}
        />
      );
    });

    const summary = requiredElement(
      container.querySelector<HTMLTextAreaElement>("textarea"),
      "ending summary"
    );
    expect(summary.value).toBe("");
    await input(summary, "An optional epilogue.");
    expect(onUpdateEnding).toHaveBeenLastCalledWith("finish", {
      summary: { "en-US": "An optional epilogue." },
    });
  });

  it("shows the Story Bible panel as basics only, with no characters section", async () => {
    const content = draftWithoutOptionalCopy();
    const baseProps = inspectorProps(content, vi.fn());

    await act(async () => {
      root.render(<StoryNodeInspector {...baseProps} selectedNode={null} showFoundation />);
    });

    const text = container.textContent ?? "";
    // Story Bible header + the story-basics foundation copy.
    expect(text).toContain("world.title");
    expect(text).toContain("foundation.logline");
    // The characters live on the canvas now: no character tab/section here, and
    // no worldbuilding surfaces either.
    expect(text).not.toContain("world.tabs");
    expect(text).not.toContain("world.characters");
    expect(text).not.toContain("trailer.title");
  });
});

describe("StoryNodeInspector character node", () => {
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

  it("edits the character's relocated name/role/summary fields through the update mutation", async () => {
    const content = draftWithCharacter();
    const model = buildStoryCanvasModel(content, "en-US");
    const onUpdateCharacter =
      vi.fn<ComponentProps<typeof StoryNodeInspector>["onUpdateCharacter"]>();
    const baseProps = { ...inspectorProps(content, vi.fn()), onUpdateCharacter };

    await act(async () => {
      root.render(
        <StoryNodeInspector
          {...baseProps}
          selectedNode={requiredNode(model.nodes, characterCanvasNodeId("hero"))}
        />
      );
    });

    // The character node routes to a dedicated character inspector, not a graph
    // editor.
    expect(container.textContent ?? "").toContain("nodeKinds.character");
    const nameInput = requiredElement(
      container.querySelector<HTMLInputElement>('input[placeholder="namePlaceholder"]'),
      "character name field"
    );
    expect(nameInput.value).toBe("Hero");
    await inputValue(nameInput, "Nova");
    expect(onUpdateCharacter).toHaveBeenLastCalledWith("hero", {
      name: { "en-US": "Nova" },
    });

    const summaryInput = requiredElement(
      container.querySelector<HTMLTextAreaElement>('textarea[placeholder="summaryPlaceholder"]'),
      "character summary field"
    );
    expect(summaryInput.value).toBe("The lead.");
  });

  it("allows deleting a character", async () => {
    const content = draftWithCharacter();
    const model = buildStoryCanvasModel(content, "en-US");
    const onDeleteCharacter =
      vi.fn<ComponentProps<typeof StoryNodeInspector>["onDeleteCharacter"]>();
    const baseProps = { ...inspectorProps(content, vi.fn()), onDeleteCharacter };

    await act(async () => {
      root.render(
        <StoryNodeInspector
          {...baseProps}
          selectedNode={requiredNode(model.nodes, characterCanvasNodeId("hero"))}
        />
      );
    });

    const deleteButton = requiredElement(
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => (button.textContent ?? "").trim() === "world.characters.delete"
      ) ?? null,
      "character delete button"
    );
    expect(deleteButton.disabled).toBe(false);
    expect(container.textContent ?? "").toContain("deleteAvailable");

    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onDeleteCharacter).toHaveBeenCalledWith("hero");
  });
});

describe("StoryNodeInspector scene music", () => {
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

  it("attaches a track already used elsewhere in the story and clears the binding", async () => {
    const content = draftWithMusic();
    const model = buildStoryCanvasModel(content, "en-US");
    const onUpdateMusic = vi.fn<ComponentProps<typeof StoryNodeInspector>["onUpdateMusic"]>();
    const baseProps = { ...inspectorProps(content, vi.fn()), onUpdateMusic };

    // A scene with no binding offers the story's existing tracks for reuse.
    await act(async () => {
      root.render(
        <StoryNodeInspector {...baseProps} selectedNode={requiredNode(model.nodes, "second")} />
      );
    });
    expect(container.querySelector('button[aria-label="remove"]')).toBeNull();
    const reuse = requiredElement(
      container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]'),
      "reuse chip"
    );
    await act(async () => {
      reuse.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onUpdateMusic).toHaveBeenLastCalledWith("second", { mediaAssetId: "asset-theme" });

    // The bound scene shows the track and can clear it.
    await act(async () => {
      root.render(
        <StoryNodeInspector {...baseProps} selectedNode={requiredNode(model.nodes, "opening")} />
      );
    });
    expect(container.textContent ?? "").toContain("asset-theme");
    const remove = requiredElement(
      container.querySelector<HTMLButtonElement>('button[aria-label="remove"]'),
      "remove track button"
    );
    await act(async () => {
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onUpdateMusic).toHaveBeenLastCalledWith("opening", null);
  });

  /**
   * The cinematic runtime reads no scene music and the Build compiler drops it,
   * so offering the panel there would let a creator upload a bed, bind it,
   * publish successfully — and hear silence with nothing to explain it.
   */
  it("offers no music panel at all on a cinematic project", async () => {
    const content = draftWithMusic();
    const model = buildStoryCanvasModel(content, "en-US");
    const baseProps = { ...inspectorProps(content, vi.fn()), format: "interactive_film" as const };

    await act(async () => {
      root.render(
        <StoryNodeInspector {...baseProps} selectedNode={requiredNode(model.nodes, "opening")} />
      );
    });

    // Not the bound track, not the reuse chips, not the upload affordance.
    expect(container.textContent ?? "").not.toContain("asset-theme");
    expect(container.querySelector('button[aria-label="remove"]')).toBeNull();
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
    expect(container.querySelector('input[type="file"][accept*="audio"]')).toBeNull();
  });

  it("renders no music binding for a story without music", async () => {
    const content = draftWithoutOptionalCopy();
    const model = buildStoryCanvasModel(content, "en-US");
    const baseProps = inspectorProps(content, vi.fn());

    await act(async () => {
      root.render(
        <StoryNodeInspector {...baseProps} selectedNode={requiredNode(model.nodes, "untitled")} />
      );
    });

    expect(container.querySelector('button[aria-label="remove"]')).toBeNull();
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
    expect(container.textContent ?? "").toContain("empty");
  });
});

function draftWithoutOptionalCopy(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      characters: [],
      endings: [
        {
          id: "finish",
          title: { "en-US": "Finish" },
        },
      ],
    },
    graph: {
      entryNodeId: "untitled",
      nodes: [
        {
          kind: "text",
          nodeId: "untitled",
          body: { "en-US": "The story begins." },
          exit: { kind: "ending", endingId: "finish" },
        },
      ],
    },
    productionNotes: [],
  };
}

function draftWithCharacter(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      characters: [
        {
          id: "hero",
          name: { "en-US": "Hero" },
          summary: "The lead.",
          images: [],
          voice: null,
        },
      ],
      endings: [],
    },
    graph: {
      entryNodeId: "opening",
      nodes: [
        {
          kind: "clip",
          nodeId: "opening",
          clipKey: "OPENING",
          exit: { kind: "auto", nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}

function draftWithMusic(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      characters: [],
      endings: [],
    },
    graph: {
      entryNodeId: "opening",
      nodes: [
        {
          kind: "clip",
          nodeId: "opening",
          clipKey: "OPENING",
          music: { mediaAssetId: "asset-theme" },
          exit: { kind: "auto", nextNodeId: "second" },
        },
        {
          kind: "clip",
          nodeId: "second",
          clipKey: "SECOND",
          exit: { kind: "auto", nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}

function inspectorProps(
  content: InteractiveStoryDraftContent,
  onUpdateEnding: ComponentProps<typeof StoryNodeInspector>["onUpdateEnding"]
): Omit<ComponentProps<typeof StoryNodeInspector>, "selectedNode"> {
  return {
    content,
    format: "text_adventure",
    locale: "en-US",
    showFoundation: false,
    canEdit: true,
    onUpdateFoundation: vi.fn(),
    onUpdateCharacter: vi.fn(),
    onDeleteCharacter: vi.fn(),
    onCloseNode: vi.fn(),
    onUpdateChoiceExit: vi.fn(),
    onAddChoice: vi.fn(),
    onUpdateChoice: vi.fn(),
    onMoveChoice: vi.fn(),
    onRemoveChoice: vi.fn(),
    onUpdateEnding,
    onDeleteSelected: vi.fn(),
    onUpdateClipMeta: vi.fn(),
    onUpdateText: vi.fn(),
    workspaceId: "workspace-1",
    onUpdateMusic: vi.fn(),
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

async function input(element: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("Missing textarea value setter.");
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function inputValue(element: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Missing input value setter.");
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}
