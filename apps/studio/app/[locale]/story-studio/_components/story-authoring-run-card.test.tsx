// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StoryAuthoringComposer,
  StoryAuthoringProposalApproval,
  StoryAuthoringProposalTranscript,
} from "./story-authoring-run-card";
import { useStoryAuthoringRun, useStoryAuthoringRunById } from "./use-story-authoring-run";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

vi.mock("./use-story-authoring-run", () => ({
  useStoryAuthoringRun: vi.fn(),
  useStoryAuthoringRunById: vi.fn(),
}));

vi.mock("./story-authoring-proposal-dialog", () => ({
  StoryAuthoringProposalContent: ({
    proposal,
    currentAssets,
  }: {
    proposal: {
      summary?: string;
      assetPlan?: { assetSpecs?: Array<{ name?: string }> };
    };
    currentAssets?: Array<{ stableKey?: string }>;
  }) => (
    <div
      data-testid="proposal-content"
      data-current-assets={currentAssets?.map((asset) => asset.stableKey).join(",")}
    >
      {proposal.summary}
      {proposal.assetPlan?.assetSpecs?.map((asset) => asset.name).join(", ")}
    </div>
  ),
}));

vi.mock("./story-plot-proposal-card", () => ({
  StoryPlotProposalCard: ({ proposal }: { proposal: { title: string } }) => (
    <div data-testid="plot-proposal-card">{proposal.title}</div>
  ),
}));

function mutation() {
  return { isPending: false, mutate: vi.fn() };
}

describe("Story authoring Agent gates", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: null,
      isLoading: false,
      refresh: vi.fn(),
    } as never);
    vi.mocked(useQuery).mockReturnValue({ data: [] } as never);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("never renders an Agent-managed proposal through the host composer gate", async () => {
    vi.mocked(useStoryAuthoringRun).mockReturnValue({
      run: {
        id: "run-1",
        status: "proposed",
        agentOsManaged: true,
        proposal: {
          schemaVersion: "story-screenplay-proposal-v1",
          title: "The Last Light",
          summary: "A complete interactive-film proposal.",
        },
      },
      cancel: mutation(),
      retry: mutation(),
    } as never);

    await renderComposer();

    expect(container.querySelector('textarea[aria-label="composer"]')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("keeps Agent-managed failures out of the legacy Retry/Discard path", async () => {
    vi.mocked(useStoryAuthoringRun).mockReturnValue({
      run: {
        id: "run-1",
        status: "authoring_failed",
        agentOsManaged: true,
        error: { code: "FAILED", detail: "Drafting failed." },
      },
      cancel: mutation(),
      retry: mutation(),
    } as never);

    await renderComposer();

    expect(container.querySelector('textarea[aria-label="composer"]')).not.toBeNull();
    expect(container.textContent).not.toContain("retry");
  });

  it("retains Retry/Discard only for an explicit legacy failure", async () => {
    const cancel = mutation();
    const retry = mutation();
    vi.mocked(useStoryAuthoringRun).mockReturnValue({
      run: {
        id: "legacy-run",
        status: "authoring_failed",
        agentOsManaged: false,
        error: { code: "FAILED", detail: "Legacy drafting failed." },
      },
      cancel,
      retry,
    } as never);

    await renderComposer();
    await act(async () => button("retry").click());
    await act(async () => button("discard").click());

    expect(retry.mutate).toHaveBeenCalledWith("legacy-run");
    expect(cancel.mutate).toHaveBeenCalledWith("legacy-run");
  });

  it("keeps the screenplay decision to a focused yes/no question", async () => {
    const onResolve = vi.fn().mockResolvedValue(true);
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: {
        id: "11111111-1111-4111-8111-111111111111",
        chapterId: "chapter-1",
        status: "succeeded",
        agentOsManaged: true,
        proposal: {
          schemaVersion: "story-screenplay-proposal-v1",
          title: "The Last Light",
          summary: "A complete interactive-film proposal.",
        },
      },
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    await act(async () => {
      root.render(
        <StoryAuthoringProposalApproval
          projectId="project-1"
          approval={{
            kind: "tool_approval",
            approvalId: "22222222-2222-4222-8222-222222222222",
            toolId: "story.applyProposal",
            toolCallId: "tool-1",
            arguments: { storyAgentRunId: "11111111-1111-4111-8111-111111111111" },
            title: "Review",
            description: "Review the proposal.",
          }}
          busy={false}
          onResolve={onResolve}
        />
      );
    });

    const region = container.querySelector<HTMLElement>("[data-agent-composer-gate]");
    const title = region?.querySelector<HTMLElement>("p[tabindex='-1']");
    expect(region?.getAttribute("aria-labelledby")).toBe(title?.id);
    expect(region?.querySelector("[role='status'][aria-live='polite']")).not.toBeNull();
    expect(document.activeElement).toBe(title);

    expect(
      [...container.querySelectorAll("button")].some((item) => item.textContent === "apply")
    ).toBe(false);
    expect(container.textContent).toContain("proposalDecision.question.script");
    expect(button("proposalDecision.no")).toBeTruthy();
    await act(async () => button("proposalDecision.yes").click());
    expect(onResolve).toHaveBeenCalledWith("approve", "proposalStage.script.approve");

    await act(async () => button("proposalDecision.no").click());
    expect(onResolve).toHaveBeenCalledWith("reject", "proposalDecision.rejectResponse");
  });

  it.each([
    ["plot", "story-plot-proposal-v1"],
    ["assets", "story-asset-proposal-v1"],
    ["storyboard", "story-storyboard-proposal-v1"],
  ] as const)("asks a yes/no question for the %s approval", async (stage, schemaVersion) => {
    const onResolve = vi.fn().mockResolvedValue(true);
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: {
        id: "11111111-1111-4111-8111-111111111111",
        chapterId: "chapter-1",
        status: "proposed",
        agentOsManaged: true,
        proposal: {
          schemaVersion,
          title: `${stage} proposal`,
          summary: `${stage} is ready for review.`,
        },
      },
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    await act(async () => {
      root.render(
        <StoryAuthoringProposalApproval
          projectId="project-1"
          approval={{
            kind: "tool_approval",
            approvalId: "22222222-2222-4222-8222-222222222222",
            toolId: "story.applyProposal",
            toolCallId: "tool-1",
            arguments: { storyAgentRunId: "11111111-1111-4111-8111-111111111111" },
            title: "Review",
            description: "Review the proposal.",
          }}
          busy={false}
          onResolve={onResolve}
        />
      );
    });

    expect(container.textContent).toContain(`proposalDecision.question.${stage}`);
    expect(button("proposalDecision.no")).toBeTruthy();
    await act(async () => button("proposalDecision.yes").click());
    expect(onResolve).toHaveBeenCalledWith("approve", `proposalStage.${stage}.approve`);
  });

  it("keeps the yes/no question visible when Agent approval fails", async () => {
    const onResolve = vi.fn().mockResolvedValue(false);
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "proposed",
        agentOsManaged: true,
        proposal: {
          schemaVersion: "story-screenplay-proposal-v1",
          title: "The Last Light",
          summary: "A complete interactive-film proposal.",
        },
      },
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    await act(async () => {
      root.render(
        <StoryAuthoringProposalApproval
          projectId="project-1"
          approval={{
            kind: "tool_approval",
            approvalId: "22222222-2222-4222-8222-222222222222",
            toolId: "story.applyProposal",
            toolCallId: "tool-1",
            arguments: { storyAgentRunId: "11111111-1111-4111-8111-111111111111" },
            title: "Review",
            description: "Review the proposal.",
          }}
          busy={false}
          onResolve={onResolve}
        />
      );
    });

    await act(async () => button("proposalDecision.yes").click());

    expect(onResolve).toHaveBeenCalledWith("approve", "proposalStage.script.approve");
    expect(button("proposalDecision.yes")).toBeTruthy();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("approvalFailed");
  });

  it("renders Asset Specs directly in the Assistant transcript", async () => {
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: {
        id: "11111111-1111-4111-8111-111111111111",
        chapterId: "chapter-1",
        status: "proposed",
        agentOsManaged: true,
        proposal: {
          schemaVersion: "story-asset-proposal-v1",
          title: "Asset plan",
          summary: "Reusable characters and locations.",
          assetPlan: {
            assetSpecs: [
              {
                stableKey: "character.courier",
                kind: "character",
                name: "Courier",
                description: "A weathered desert courier.",
                imagePrompt: "Courier reference",
                sourceNodeIds: ["scene.arrival"],
              },
            ],
          },
        },
      },
      isLoading: false,
      refresh: vi.fn(),
    } as never);
    vi.mocked(useQuery).mockReturnValue({
      data: [{ stableKey: "character.courier" }],
    } as never);

    await act(async () => {
      root.render(
        <StoryAuthoringProposalTranscript
          projectId="project-1"
          artifact={{
            id: "11111111-1111-4111-8111-111111111111",
            reference: {
              kind: "story_stage_proposal",
              storyAgentRunId: "11111111-1111-4111-8111-111111111111",
              workspaceId: "workspace-1",
            },
            status: "applied",
            createdAt: "2026-08-25T00:00:00.000Z",
            eventSequence: 4,
          }}
        />
      );
    });

    expect(container.querySelector('[data-testid="story-proposal-transcript"]')).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="story-proposal-transcript"]')
        ?.getAttribute("data-artifact-status")
    ).toBe("applied");
    expect(container.querySelector('[data-testid="proposal-content"]')?.textContent).toContain(
      "Courier"
    );
    expect(
      container
        .querySelector('[data-testid="proposal-content"]')
        ?.getAttribute("data-current-assets")
    ).toBe("character.courier");
    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["story-studio", "asset-specs", "project-1", "chapter-1"],
        enabled: true,
      })
    );
  });

  it("routes Plot proposals to the compact canvas-preview card", async () => {
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: {
        id: "11111111-1111-4111-8111-111111111111",
        chapterId: "chapter-1",
        status: "proposed",
        agentOsManaged: true,
        proposal: {
          schemaVersion: "story-plot-proposal-v1",
          title: "Branching night route",
          summary: "A compact Plot proposal.",
        },
      },
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    await act(async () => {
      root.render(
        <StoryAuthoringProposalTranscript
          projectId="project-1"
          artifact={{
            id: "11111111-1111-4111-8111-111111111111",
            reference: {
              kind: "story_stage_proposal",
              storyAgentRunId: "11111111-1111-4111-8111-111111111111",
              workspaceId: "workspace-1",
            },
            status: "proposed",
            createdAt: "2026-08-25T00:00:00.000Z",
            eventSequence: 4,
          }}
        />
      );
    });

    expect(container.querySelector('[data-testid="plot-proposal-card"]')?.textContent).toBe(
      "Branching night route"
    );
    expect(container.querySelector('[data-testid="proposal-content"]')).toBeNull();
  });

  it("loads the approval's exact Story run after the user switches chapters", async () => {
    const approvalRunId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(useStoryAuthoringRun).mockReturnValue({
      run: {
        id: "33333333-3333-4333-8333-333333333333",
        chapterId: "chapter-2",
        status: "authoring",
      },
      cancel: mutation(),
      retry: mutation(),
    } as never);
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: {
        id: approvalRunId,
        chapterId: "chapter-1",
        status: "proposed",
        agentOsManaged: true,
        proposal: {
          schemaVersion: "story-patch-v1",
          title: "Chapter one proposal",
          summary: "Review remains available from chapter two.",
        },
      },
      isLoading: false,
      refresh: vi.fn(),
    } as never);

    await act(async () => {
      root.render(
        <StoryAuthoringProposalApproval
          projectId="project-1"
          approval={{
            kind: "tool_approval",
            approvalId: "22222222-2222-4222-8222-222222222222",
            toolId: "story.applyProposal",
            toolCallId: "tool-1",
            arguments: { storyAgentRunId: approvalRunId },
            title: "Review",
            description: "Review the proposal.",
          }}
          busy={false}
          onResolve={vi.fn().mockResolvedValue(true)}
        />
      );
    });

    expect(useStoryAuthoringRunById).toHaveBeenCalledWith("project-1", approvalRunId);
    expect(button("proposalDecision.no")).toBeTruthy();
    expect(button("proposalDecision.yes")).toBeTruthy();
  });

  async function renderComposer() {
    await act(async () => {
      root.render(
        <StoryAuthoringComposer
          composer={<textarea aria-label="composer" />}
          projectId="project-1"
          chapterId="chapter-1"
        />
      );
    });
  }

  function button(text: string): HTMLButtonElement {
    const match = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === text
    );
    if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}.`);
    return match;
  }
});
