// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryAuthoringComposer, StoryAuthoringProposalApproval } from "./story-authoring-run-card";
import { useStoryAuthoringRun, useStoryAuthoringRunById } from "./use-story-authoring-run";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./use-story-authoring-run", () => ({
  useStoryAuthoringRun: vi.fn(),
  useStoryAuthoringRunById: vi.fn(),
}));

vi.mock("./story-authoring-proposal-dialog", () => ({
  StoryAuthoringProposalDialog: ({
    open,
    onApply,
    onDiscard,
  }: {
    open: boolean;
    onApply: () => void;
    onDiscard: () => void;
  }) =>
    open ? (
      <div data-testid="proposal-dialog">
        <button type="button" onClick={onApply}>
          dialog-apply
        </button>
        <button type="button" onClick={onDiscard}>
          dialog-discard
        </button>
      </div>
    ) : null,
}));

function mutation() {
  return { isPending: false, mutate: vi.fn() };
}

describe("Story authoring Agent gates", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
          schemaVersion: "story-patch-v1",
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

  it("reviews and submits a Story proposal through the Agent approval callback", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useStoryAuthoringRunById).mockReturnValue({
      run: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "proposed",
        agentOsManaged: true,
        proposal: {
          schemaVersion: "story-patch-v1",
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

    await act(async () => button("apply").click());
    expect(onResolve).toHaveBeenCalledWith("approve", "apply");

    await act(async () => button("viewAll").click());
    expect(container.querySelector('[data-testid="proposal-dialog"]')).not.toBeNull();
    await act(async () => button("dialog-discard").click());
    expect(onResolve).toHaveBeenCalledWith("reject", "discard");
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
          onResolve={vi.fn().mockResolvedValue(undefined)}
        />
      );
    });

    expect(useStoryAuthoringRunById).toHaveBeenCalledWith("project-1", approvalRunId);
    expect(button("viewAll")).toBeTruthy();
    expect(button("apply")).toBeTruthy();
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
