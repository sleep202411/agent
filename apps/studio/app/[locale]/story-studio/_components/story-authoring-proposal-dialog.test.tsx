// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StoryAuthoringProposalContent,
  StoryAuthoringProposalDialog,
} from "./story-authoring-proposal-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: (
    props: React.HTMLAttributes<HTMLDivElement> & {
      showCloseButton?: boolean;
      onEscapeKeyDown?: () => void;
      onPointerDownOutside?: () => void;
    }
  ) => {
    const { children, showCloseButton, onEscapeKeyDown, onPointerDownOutside, ...htmlProps } =
      props;
    void showCloseButton;
    void onEscapeKeyDown;
    void onPointerDownOutside;
    return <div {...htmlProps}>{children}</div>;
  },
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
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
  }) => (
    <div data-testid="proposal-review-viewport" {...viewportProps}>
      {children}
    </div>
  ),
}));

describe("StoryAuthoringProposalDialog exact production review", () => {
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

  it("shows every Asset Spec field that will be saved", async () => {
    await render({
      schemaVersion: "story-asset-proposal-v1",
      title: "Asset plan",
      summary: "One reusable hero.",
      assetPlan: {
        assetSpecs: [
          {
            stableKey: "hero.asset",
            kind: "character",
            name: "Hero",
            description: "Weathered expedition leader.",
            imagePrompt: "hero reference image prompt",
            videoPrompt: "hero motion prompt",
            negativePrompt: "avoid glossy skin",
            sourceCharacterId: "character.hero",
            sourceNodeIds: ["scene.departure", "scene.storm"],
          },
        ],
      },
    });

    expect(container.textContent).toContain("@hero.asset");
    expect(container.textContent).toContain("Weathered expedition leader.");
    expect(container.textContent).toContain("hero reference image prompt");
    expect(container.textContent).toContain("hero motion prompt");
    expect(container.textContent).toContain("avoid glossy skin");
    expect(container.textContent).toContain("@character.hero");
    expect(container.textContent).toContain("@scene.departure");
    expect(container.textContent).toContain("@scene.storm");
    const assetReview = container.querySelector('[data-testid="asset-proposal-review"]');
    expect(assetReview?.querySelector('[class*="ring-"]')).toBeNull();
    expect(assetReview?.querySelector('[class*="border-white"]')).not.toBeNull();
    const reviewViewport = container.querySelector<HTMLElement>(
      '[data-testid="proposal-review-viewport"]'
    );
    expect(reviewViewport?.tabIndex).toBe(0);
    expect(reviewViewport?.getAttribute("aria-label")).toBe("proposal.reviewRegion");
    reviewViewport?.focus();
    expect(document.activeElement).toBe(reviewViewport);
  });

  it("shows exact Storyboard clip timing, prompts, ids, and decision cues", async () => {
    await render({
      schemaVersion: "story-storyboard-proposal-v1",
      title: "Storyboard plan",
      summary: "Opening sequence.",
      assetPlan: { assetSpecs: [] },
      storyboardPlan: {
        storyboardSequences: [
          {
            plotNodeId: "scene.departure",
            title: "Departure",
            description: "The expedition leaves camp.",
            durationMs: 5000,
            clips: [
              {
                stableKey: "shot.departure.wide",
                kind: "video",
                title: "Wide departure",
                description: "A wide tracking shot.",
                startMs: 1000,
                durationMs: 2500,
                videoPrompt: "track beside @hero.asset",
                negativePrompt: "avoid camera shake",
              },
            ],
            cues: [
              {
                stableKey: "cue.departure.choice",
                kind: "decision",
                atMs: 4200,
                decisionId: "decision.route",
              },
            ],
          },
        ],
      },
    });

    expect(container.textContent).toContain("@scene.departure");
    expect(container.textContent).toContain("proposal.sequenceMeta:1,5");
    expect(container.textContent).toContain("@shot.departure.wide");
    expect(container.textContent).toContain("A wide tracking shot.");
    expect(container.textContent).toContain("1000");
    expect(container.textContent).toContain("3500");
    expect(container.textContent).toContain("2500");
    expect(container.textContent).toContain("track beside @hero.asset");
    expect(container.textContent).toContain("avoid camera shake");
    expect(container.textContent).toContain("@cue.departure.choice");
    expect(container.textContent).toContain("4200");
    expect(container.textContent).toContain("@decision.route");
  });

  it("keeps the embedded Storyboard compact and opens the complete shot tables in a dialog", async () => {
    const proposal = {
      schemaVersion: "story-storyboard-proposal-v1",
      title: "Storyboard plan",
      summary: "Six production sequences.",
      assetPlan: { assetSpecs: [] },
      storyboardPlan: {
        storyboardSequences: Array.from({ length: 6 }, (_, index) => ({
          plotNodeId: `scene.${index + 1}`,
          title: `Sequence ${index + 1}`,
          description: `Sequence ${index + 1} description.`,
          durationMs: 5000,
          clips: [
            {
              stableKey: `shot.scene-${index + 1}`,
              kind: "video",
              title: `Shot ${index + 1}`,
              description: `Shot ${index + 1} description.`,
              startMs: 0,
              durationMs: 5000,
              videoPrompt: `Prompt for shot ${index + 1}.`,
            },
          ],
          cues: [],
        })),
      },
    };

    await act(async () => {
      root.render(<StoryAuthoringProposalContent proposal={proposal as never} embedded />);
    });

    const summaryTable = container.querySelector(
      '[data-testid="storyboard-sequence-summary-table"]'
    );
    expect(summaryTable?.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(container.textContent).toContain("Sequence 4");
    expect(container.textContent).not.toContain("Sequence 5");
    expect(container.textContent).not.toContain("Prompt for shot 6.");

    const viewAll = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("proposal.storyboardTable.viewAll")
    );
    expect(viewAll?.textContent).toContain("proposal.storyboardTable.more:2");

    await act(async () => viewAll?.click());

    const dialog = container.querySelector('[data-testid="storyboard-details-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(dialog?.textContent).toContain("Sequence 6");
    expect(dialog?.textContent).toContain("@shot.scene-6");
    expect(dialog?.textContent).toContain("Prompt for shot 6.");
  });

  it("keeps embedded Asset Specs in one portrait-card row and opens overflow in a dialog", async () => {
    const proposal = {
      schemaVersion: "story-asset-proposal-v1",
      title: "Location plan",
      summary: "Five reusable locations.",
      assetPlan: {
        assetSpecs: Array.from({ length: 5 }, (_, index) => ({
          stableKey: `location.${index + 1}`,
          kind: "location",
          name: `Location ${index + 1}`,
          description: `Reusable location ${index + 1}.`,
          imagePrompt: `Location ${index + 1} reference prompt.`,
          sourceNodeIds: [`scene.${index + 1}`],
        })),
      },
    };

    await act(async () => {
      root.render(
        <StoryAuthoringProposalContent
          proposal={proposal as never}
          embedded
          currentAssets={[
            {
              stableKey: "location.1",
              selectedMediaVersion: {
                thumbnailUrl: "https://media.example/location-1.jpg",
                previewUrl: "https://media.example/location-1-preview.jpg",
              },
            } as never,
          ]}
        />
      );
    });

    const row = container.querySelector<HTMLElement>('[data-asset-row="location"]');
    expect(row?.querySelectorAll("article")).toHaveLength(2);
    expect(row?.querySelector("article")?.className).toContain("aspect-[3/4]");
    expect(row?.querySelector("img")?.getAttribute("src")).toBe(
      "https://media.example/location-1.jpg"
    );
    expect(row?.querySelector("img")?.getAttribute("alt")).toBe("Location 1");
    const more = row?.querySelector<HTMLButtonElement>("button");
    expect(more?.textContent).toContain("+3");
    expect(more?.title).toBe("proposal.viewMoreAssets");

    await act(async () => more?.click());
    expect(row?.querySelectorAll("article")).toHaveLength(2);
    const dialog = container.querySelector('[data-testid="asset-kind-dialog"]');
    expect(dialog?.querySelectorAll("article")).toHaveLength(5);
    expect(dialog?.textContent).toContain(
      "proposal.assetKindDialogTitle:proposal.assetKinds.location,5"
    );
  });

  async function render(proposal: unknown) {
    await act(async () => {
      root.render(
        <StoryAuthoringProposalDialog
          open
          proposal={proposal as never}
          applying={false}
          discarding={false}
          onOpenChange={vi.fn()}
          onApply={vi.fn()}
          onDiscard={vi.fn()}
        />
      );
    });
  }
});
