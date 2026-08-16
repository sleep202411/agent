// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { StoryChapter } from "@/lib/story-projects-api";
import { StoryChapterDropdown } from "./story-chapter-dropdown";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.count !== undefined ? `${key}:${String(values.count)}` : key,
}));

describe("StoryChapterDropdown", () => {
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

  it("anchors persisted chapters to the active chapter trigger", async () => {
    const onOpenChange = vi.fn();
    await renderDropdown({
      open: false,
      onOpenChange,
      chapters: [chapter("chapter-1", "Chapter 1", 0, 7), chapter("chapter-2", "Chapter 2", 1, 3)],
    });

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="action"]');
    expect(trigger?.textContent).toContain("Chapter 1");
    await act(async () => trigger?.click());
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("supports the project-canvas rail as its trigger", async () => {
    const onOpenChange = vi.fn();
    await renderDropdown({
      open: false,
      onOpenChange,
      trigger: (
        <button type="button" aria-label="Open chapters from project rail">
          Chapters
        </button>
      ),
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open chapters from project rail"]'
    );
    await act(async () => trigger?.click());

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("exposes chapter selection and creation while open", async () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(true);
    const onOpenChange = vi.fn();
    await renderDropdown({
      open: true,
      onOpenChange,
      onSelect,
      onCreate,
      chapters: [chapter("chapter-1", "Chapter 1", 0, 7), chapter("chapter-2", "Chapter 2", 1, 3)],
    });

    expect(document.querySelector('[role="navigation"]')?.getAttribute("aria-label")).toBe("title");
    expect(document.querySelector('[aria-current="page"]')?.textContent).toContain("Chapter 1");
    expect(document.querySelector('[aria-current="page"]')?.textContent).toContain("sceneCount:7");

    const chapterButtons = document.querySelectorAll<HTMLElement>('[role="button"]');
    await act(async () => chapterButtons[1]?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).toHaveBeenCalledWith("chapter-2");

    const add = document.querySelector<HTMLButtonElement>('button[aria-label="add"]');
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
    await renderDropdown({ open: true, canEdit: false });
    expect(document.querySelector('button[aria-label="add"]')).toBeNull();
  });

  it("renders persisted names independently from historical ranks", async () => {
    await renderDropdown({
      open: true,
      activeChapterId: "chapter-3",
      chapters: [chapter("chapter-1", "Opening", 0, 1), chapter("chapter-3", "The Return", 2, 0)],
    });

    expect(document.body.textContent).toContain("Opening");
    expect(document.body.textContent).toContain("The Return");
  });

  async function renderDropdown(
    overrides: Partial<React.ComponentProps<typeof StoryChapterDropdown>> = {}
  ) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <StoryChapterDropdown
            open={false}
            chapters={[chapter("chapter-1", "Chapter 1", 0, 1)]}
            activeChapterId="chapter-1"
            canEdit
            creating={false}
            pendingChapterId={null}
            onOpenChange={() => undefined}
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
