// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryPlotProposalCard } from "./story-plot-proposal-card";
import { buildStoryPlotPreviewModel } from "./story-plot-proposal-model";

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => `plotCard.${key}`,
}));

vi.mock("@xyflow/react", () => ({
  Controls: () => <div data-testid="plot-controls" />,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/canvas/canvas-backdrop", () => ({
  CanvasBackdrop: () => <div data-testid="canvas-backdrop" />,
}));

vi.mock("@/components/canvas/canvas-react-flow", () => ({
  CanvasReactFlow: ({
    nodes,
    edges,
    children,
  }: {
    nodes: Array<{ id: string; data: { title: string } }>;
    edges: Array<{ id: string }>;
    children: React.ReactNode;
  }) => (
    <div data-testid="plot-canvas" data-node-count={nodes.length} data-edge-count={edges.length}>
      {nodes.map((node) => (
        <span key={node.id}>{node.data.title}</span>
      ))}
      {children}
    </div>
  ),
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

const proposal = {
  schemaVersion: "story-plot-proposal-v1",
  title: "Night Gate topology",
  summary: "A courier's choice splits the route before both paths reach dawn.",
  screenplay: {
    schemaVersion: "interactive-screenplay-v1",
    storyLanguage: "zh-CN",
    title: "Night Gate",
    logline: "One gate decides the fate of a city.",
    synopsis: "A courier races through the rain.",
    characters: [{ id: "character.courier", name: { "zh-CN": "信使" }, summary: "最后一名骑手。" }],
    entrySceneId: "scene.gate",
    scenes: [
      {
        nodeId: "scene.gate",
        clipKey: "clip.gate",
        name: "城门",
        heading: "EXT. CITY GATE - NIGHT",
        beat: "The courier arrives.",
        action: "The courier reaches the sealed gate.",
        dialogue: [],
        exit: {
          kind: "choice",
          decisionId: "decision.gate",
          prompt: { "zh-CN": "打开城门吗？" },
          choices: [
            { choiceId: "open", label: { "zh-CN": "打开" }, nextNodeId: "scene.dawn" },
            { choiceId: "wait", label: { "zh-CN": "等待" }, nextNodeId: "scene.dawn" },
          ],
        },
      },
      {
        nodeId: "scene.dawn",
        clipKey: "clip.dawn",
        name: "黎明",
        heading: "EXT. CITY WALL - DAWN",
        beat: "The city learns the result.",
        action: "Sunlight reaches the wall.",
        dialogue: [],
        exit: { kind: "auto", nextNodeId: null },
      },
    ],
  },
} as never;

describe("StoryPlotProposalCard", () => {
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

  it("keeps the transcript compact and opens the exact topology in a canvas dialog", async () => {
    await act(async () => {
      root.render(<StoryPlotProposalCard proposal={proposal} status="proposed" />);
    });

    const card = container.querySelector('[data-testid="story-plot-proposal-card"]');
    expect(card?.textContent).toContain("Night Gate topology");
    expect(card?.textContent).toContain("A courier's choice");
    expect(card?.textContent).toContain("plotCard.status.proposed");
    expect(card?.textContent).toContain("3plotCard.metrics.nodes");
    expect(card?.textContent).toContain("2plotCard.metrics.branches");
    expect(card?.textContent).toContain("1plotCard.metrics.endings");
    expect(card?.textContent).toContain("plotCard.entry城门");
    expect(container.querySelector('[data-testid="story-plot-review-dialog"]')).toBeNull();

    const review = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("plotCard.review")
    );
    await act(async () => review?.click());

    const dialog = container.querySelector('[data-testid="story-plot-review-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("plotCard.dialogDescription");
    const canvas = dialog?.querySelector('[data-testid="plot-canvas"]');
    expect(canvas?.getAttribute("data-node-count")).toBe("3");
    expect(canvas?.getAttribute("data-edge-count")).toBe("3");
    expect(canvas?.textContent).toContain("城门");
    expect(canvas?.textContent).toContain("黎明");
  });

  it("derives metrics, entry, and edges from the canonical Plot proposal", () => {
    const model = buildStoryPlotPreviewModel(proposal, "zh-CN", "场景", "玩家选择");

    expect(model.metrics).toEqual({ nodes: 3, branches: 2, endings: 1 });
    expect(model.entryTitle).toBe("城门");
    expect(model.nodes.find((node) => node.id === "scene.gate")?.data.isEntry).toBe(true);
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.stringContaining("__decision__:"),
          target: "scene.dawn",
          sourceHandle: "choice:open",
          data: expect.objectContaining({ choiceId: "open" }),
        }),
        expect.objectContaining({
          source: expect.stringContaining("__decision__:"),
          target: "scene.dawn",
          sourceHandle: "choice:wait",
          data: expect.objectContaining({ choiceId: "wait" }),
        }),
      ])
    );
  });
});
