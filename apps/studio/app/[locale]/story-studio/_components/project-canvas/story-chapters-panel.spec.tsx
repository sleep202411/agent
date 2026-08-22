// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { StoryChapter } from "@/lib/story-projects-api";
import { StoryChaptersPanel } from "./story-chapters-panel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.count !== undefined ? `${key}:${String(values.count)}` : key,
}));

describe("StoryChaptersPanel", () => {
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

  it("exposes chapter selection and creation", async () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(true);
    await renderPanel({
      onSelect,
      onCreate,
      chapters: [chapter("chapter-1", "Chapter 1", 0, 7), chapter("chapter-2", "Chapter 2", 1, 3)],
    });

    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("title");
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("Chapter 1");
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("sceneCount:7");

    const chapterButtons = container.querySelectorAll<HTMLElement>('[role="button"]');
    await act(async () => chapterButtons[1]?.click());
    expect(onSelect).toHaveBeenCalledWith("chapter-2");

    const add = container.querySelector<HTMLButtonElement>('button[aria-label="add"]');
    expect(add?.disabled).toBe(false);
    await act(async () => add?.click());
    const nameInput = document.querySelector<HTMLInputElement>("#story-create-chapter-name");
    expect(nameInput).not.toBeNull();
    await act(async () => setInputValue(nameInput as HTMLInputElement, "The Return"));
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "createConfirm"
    );
    await act(async () => confirm?.click());
    expect(onCreate).toHaveBeenCalledWith("The Return");
  });

  it("omits the unavailable creation action for read-only collaborators", async () => {
    await renderPanel({ canEdit: false });
    expect(container.querySelector('button[aria-label="add"]')).toBeNull();
  });

  it("renders persisted names independently from historical ranks", async () => {
    await renderPanel({
      activeChapterId: "chapter-3",
      chapters: [chapter("chapter-1", "Opening", 0, 1), chapter("chapter-3", "The Return", 2, 0)],
    });

    expect(container.textContent).toContain("Opening");
    expect(container.textContent).toContain("The Return");
  });

  async function renderPanel(
    overrides: Partial<React.ComponentProps<typeof StoryChaptersPanel>> = {}
  ) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <StoryChaptersPanel
            chapters={[chapter("chapter-1", "Chapter 1", 0, 1)]}
            activeChapterId="chapter-1"
            canEdit
            creating={false}
            pendingChapterId={null}
            onSelect={() => undefined}
            onCreate={async () => true}
            onRename={async () => true}
            onMove={async () => true}
            onArchive={async () => true}
            {...overrides}
          />
        </TooltipProvider>
      );
    });
  }
});

function chapter(id: string, title: string, rank: number, nodeCount: number): StoryChapter {
  return {
    id,
    projectId: "project-1",
    title,
    rank,
    entryNodeId: null,
    nodeCount,
    createdByUserId: "user-1",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
