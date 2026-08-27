// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryScreenplayProposalCard } from "./story-screenplay-proposal-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `screenplayCard.${key}`,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    viewportProps,
  }: {
    children: React.ReactNode;
    viewportProps?: React.HTMLAttributes<HTMLDivElement>;
  }) => <div {...viewportProps}>{children}</div>,
}));

const proposal = {
  schemaVersion: "story-screenplay-proposal-v1",
  title: "Night Gate",
  summary: "A courier must choose whether to open the city gate before dawn.",
  screenplay: {
    schemaVersion: "story-screenplay-v1",
    storyLanguage: "en-US",
    title: "Night Gate",
    logline: "One gate decides the fate of a city.",
    synopsis: "A courier races through the rain.",
    characters: [
      { id: "character.courier", name: { "en-US": "Courier" }, summary: "The last rider." },
      { id: "character.guard", name: { "en-US": "Guard" }, summary: "Keeper of the gate." },
    ],
    entrySceneId: "scene.gate",
    scenes: [
      {
        nodeId: "scene.gate",
        name: "The gate",
        heading: "EXT. CITY GATE - NIGHT",
        beat: "The courier arrives.",
        action: "The complete screenplay action appears only inside the review dialog.",
        dialogue: [],
        exit: {
          kind: "choice",
          prompt: { "en-US": "Open the gate?" },
          choices: [
            { choiceId: "open", label: { "en-US": "Open" }, nextNodeId: "scene.dawn" },
            { choiceId: "wait", label: { "en-US": "Wait" }, nextNodeId: "scene.dawn" },
          ],
        },
      },
      {
        nodeId: "scene.dawn",
        name: "Dawn",
        heading: "EXT. CITY WALL - DAWN",
        beat: "The city learns the result.",
        action: "Sunlight reaches the wall.",
        dialogue: [],
        exit: { kind: "auto", nextNodeId: null },
      },
    ],
  },
  document: {
    schemaVersion: "story-screenplay-document-v1",
    blocks: [
      { kind: "heading", level: 1, text: "Night Gate" },
      {
        kind: "paragraph",
        text: "The complete screenplay action appears only inside the review dialog.",
      },
    ],
  },
} as never;

describe("StoryScreenplayProposalCard", () => {
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

  it("keeps the transcript compact and opens the exact complete Script in a dialog", async () => {
    await act(async () => {
      root.render(<StoryScreenplayProposalCard proposal={proposal} status="proposed" />);
    });

    const card = container.querySelector('[data-testid="story-screenplay-proposal-card"]');
    expect(card?.textContent).toContain("Night Gate");
    expect(card?.textContent).toContain("A courier must choose");
    expect(card?.textContent).toContain("screenplayCard.status.proposed");
    expect(card?.textContent).toContain("2screenplayCard.metrics.scenes");
    expect(card?.textContent).toContain("2screenplayCard.metrics.characters");
    expect(card?.textContent).toContain("2screenplayCard.metrics.choices");
    expect(card?.querySelector("[class*='line-clamp-3']")).not.toBeNull();
    expect(container.textContent).not.toContain("complete screenplay action");

    const review = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("screenplayCard.review")
    );
    await act(async () => review?.click());

    const dialog = container.querySelector('[data-testid="story-screenplay-review-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("complete screenplay action");
    expect(dialog?.textContent).toContain("screenplayCard.dialogDescription");
  });
});
