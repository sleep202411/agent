// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryClipGraphNode } from "@/lib/story-projects-api";
import { StoryInteractionEditor } from "./story-interaction-editor";
import type { StoryInteractionDraft } from "./story-interaction-types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./story-hotspot-stage", () => ({
  StoryHotspotStage: ({
    width,
    height,
    drafts,
    selectedId,
    mode,
    onSelect,
    onPreview,
  }: {
    width: number;
    height: number;
    drafts: StoryInteractionDraft[];
    selectedId: string | null;
    mode: "edit" | "preview";
    onSelect: (id: string) => void;
    onPreview: (draft: StoryInteractionDraft) => void;
  }) => (
    <div data-hotspot-canvas="">
      {drafts.map((draft) => (
        <div
          key={draft.id}
          data-hotspot-id={draft.id}
          className={draft.id === selectedId ? "border-brand-blue" : ""}
          style={{
            width: `${draft.rect.width * width}px`,
            height: `${draft.rect.height * height}px`,
            transform: `translate(${draft.rect.x * width}px,${draft.rect.y * height}px)`,
          }}
        >
          <button
            type="button"
            aria-label={draft.label}
            onClick={() => (mode === "preview" ? onPreview(draft) : onSelect(draft.id))}
          />
        </div>
      ))}
    </div>
  ),
}));

const NODES: StoryClipGraphNode[] = [
  clip("opening", "OPENING", "second"),
  clip("second", "SECOND", null),
];

describe("StoryInteractionEditor", () => {
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

  it("creates an editable spatial and temporal hotspot", async () => {
    await renderEditor(root);

    await click(requiredElement(document.body.querySelector('button[aria-label="addHotspot"]')));

    requiredElement(
      document.body.querySelector<HTMLButtonElement>('button[aria-label="newHotspot"]')
    );
    expect(
      requiredElement(document.body.querySelector<HTMLInputElement>('[data-position-field="x"]'))
        .value
    ).toBe("35.0");
    expect(
      requiredElement(document.body.querySelector<HTMLInputElement>('[data-position-field="y"]'))
        .value
    ).toBe("31.0");
    expect(document.body.textContent).toContain("0:00.0–0:02.0");

    const action = requiredElement(
      document.body.querySelector<HTMLSelectElement>('select[aria-label="successOutcome"]')
    );
    expect(action.value).toBe("continue");
  });

  it("portals the modal workspace outside the canvas container", async () => {
    await renderEditor(root);

    const dialog = requiredElement(
      document.body.querySelector<HTMLElement>('[data-story-interaction-editor=""]')
    );
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("top-3");
  });

  it("measures the portaled stage before positioning a controlled hotspot", async () => {
    const nativeGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute("data-interaction-stage")) {
          return {
            x: 0,
            y: 0,
            top: 0,
            right: 800,
            bottom: 450,
            left: 0,
            width: 800,
            height: 450,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return nativeGetBoundingClientRect.call(this);
      });

    try {
      await renderEditor(root, [draft()]);

      const hotspot = requiredElement(
        document.body.querySelector<HTMLElement>('[data-hotspot-id="hotspot-1"]')
      );
      expect(hotspot.style.width).toBe("240px");
      expect(hotspot.style.height).toBe("112.5px");
      expect(hotspot.style.transform).toContain("translate(160px,112.5px)");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("keeps preview honest when an interaction has no destination", async () => {
    await renderEditor(root, [
      draft({ outcomes: { success: { kind: "goto", targetNodeId: "" } } }),
    ]);

    await click(buttonWithText(document.body, "preview"));
    expect(
      requiredElement(
        document.body.querySelector<HTMLButtonElement>('button[aria-label="addHotspot"]')
      ).disabled
    ).toBe(true);
    await click(requiredElement(document.body.querySelector('button[aria-label="Hotspot"]')));

    expect(document.body.textContent).toContain("previewMissingTarget");
    expect(document.body.textContent).not.toContain("previewAction");
  });

  it("deletes the selected hotspot with the editor keyboard shortcut", async () => {
    await renderEditor(root, [draft()]);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('button[aria-label="Hotspot"]')).toBeNull();
    expect(document.body.textContent).toContain("emptyTitle");
  });

  it("keeps the clicked hotspot selected instead of treating it as a canvas click", async () => {
    await renderEditor(root, [
      draft(),
      draft({
        id: "hotspot-2",
        label: "Second hotspot",
        rect: { x: 0.6, y: 0.2, width: 0.2, height: 0.2 },
      }),
    ]);
    const secondHotspot = requiredElement(
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Second hotspot"]')
    );

    await click(secondHotspot);

    expect(secondHotspot.parentElement?.className).toContain("border-brand-blue");
  });

  it("returns focus to the control that opened the editor", async () => {
    function ClosableEditor() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Launch editor
          </button>
          {open ? <ControlledEditor initialDrafts={[]} onClose={() => setOpen(false)} /> : null}
        </>
      );
    }

    await act(async () => root.render(<ClosableEditor />));
    const launch = buttonWithText(container, "Launch editor");
    launch.focus();
    await click(launch);
    expect(document.activeElement).not.toBe(launch);

    await click(buttonWithText(document.body, "done"));
    expect(document.activeElement).toBe(launch);
  });
});

async function renderEditor(root: Root, initialDrafts: StoryInteractionDraft[] = []) {
  await act(async () => {
    root.render(<ControlledEditor initialDrafts={initialDrafts} onClose={vi.fn()} />);
  });
}

function ControlledEditor({
  initialDrafts,
  onClose,
}: {
  initialDrafts: StoryInteractionDraft[];
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState(initialDrafts);
  return (
    <StoryInteractionEditor
      node={NODES[0]}
      nodes={NODES}
      frameProfile="landscape_16_9"
      drafts={drafts}
      onDraftsChange={setDrafts}
      onClose={onClose}
    />
  );
}

function draft(overrides: Partial<StoryInteractionDraft> = {}): StoryInteractionDraft {
  return {
    id: "hotspot-1",
    label: "Hotspot",
    rect: { x: 0.2, y: 0.25, width: 0.3, height: 0.25 },
    startSeconds: 0,
    endSeconds: 2,
    branchAtSeconds: null,
    trigger: { kind: "tap" },
    outcomes: { success: { kind: "goto", targetNodeId: "second" } },
    ...overrides,
  };
}

function clip(nodeId: string, clipKey: string, nextNodeId: string | null): StoryClipGraphNode {
  return {
    kind: "clip",
    nodeId,
    clipKey,
    interactions: [],
    exit: {
      kind: "auto",
      routes: [{ target: nextNodeId ? { kind: "node" as const, nodeId: nextNodeId } : null }],
    },
  };
}

function requiredElement<T extends Element>(element: T | null): T {
  if (!element) throw new Error("Missing required element.");
  return element;
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  return requiredElement(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === text
    ) ?? null
  );
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}
