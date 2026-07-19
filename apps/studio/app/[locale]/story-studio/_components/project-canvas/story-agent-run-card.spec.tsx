// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  isStoryPatchBrief,
  type StoryAgentRunDto,
  type StoryPatchProposal,
} from "@repo/shared/story-agent";
import type { DynamicToolUIPart } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StoryAgentRunCard,
  StoryAgentRunSummaryCard,
  storyAgentRunFromToolPart,
} from "./story-agent-run-card";
import { StoryAgentRunActionGuardError, type StoryAgentRunController } from "./use-story-agent-run";
import { STORY_AGENT_TEST_RUN_ID, storyAgentRunFixture } from "./story-agent-run.test-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("StoryAgentRunCard", () => {
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

  it("rejects malformed tool output instead of rendering untrusted proposal fields", async () => {
    const malformed = storyAgentRunFixture("proposed");
    const part = toolPart({
      status: "accepted",
      run: { ...malformed, proposal: { title: "Unvalidated" } },
    });

    await render(
      <StoryAgentRunCard part={part} controller={controllerFixture()} canManageAgentRuns />
    );

    expect(container.textContent).toContain("invalid");
    expect(container.textContent).toContain("invalidDetail");
    expect(container.textContent).not.toContain("Unvalidated");
    expect(storyAgentRunFromToolPart(part)).toBeNull();
  });

  it("rejects the retired top-level run tool-output shape", async () => {
    const part = toolPart({ run: storyAgentRunFixture("proposed") });

    await render(
      <StoryAgentRunCard part={part} controller={controllerFixture()} canManageAgentRuns />
    );

    expect(container.textContent).toContain("invalid");
    expect(storyAgentRunFromToolPart(part)).toBeNull();
  });

  it("renders a rejected tool result as a dismissible notice, not an error", async () => {
    const part = toolPart({
      status: "rejected",
      code: "STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED",
      message: "Raw server copy",
    });

    await render(
      <StoryAgentRunCard part={part} controller={controllerFixture()} canManageAgentRuns />
    );

    expect(container.textContent).toContain(
      "rejections.STORY_AGENT_PROJECT_PROPOSAL_LIMIT_REACHED"
    );
    expect(container.textContent).not.toContain("Raw server copy");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(storyAgentRunFromToolPart(part)).toBeNull();

    await click(container.querySelector<HTMLButtonElement>('button[aria-label="dismissRejected"]'));
    expect(container.textContent).not.toContain("rejections");
  });

  it("falls back to the server rejection message for unmapped codes", async () => {
    await render(
      <StoryAgentRunCard
        part={toolPart({
          status: "rejected",
          code: "STORY_AGENT_SOMETHING_NEW",
          message: "A new rejection reason.",
        })}
        controller={controllerFixture()}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("rejected");
    expect(container.textContent).toContain("A new rejection reason.");
  });

  it("keeps a different historical tool run read-only and never promotes it to canonical state", async () => {
    const canonical = storyAgentRunFixture("proposed");
    const historical = storyAgentRunFixture("proposed", {
      id: "00000000-0000-4000-8000-000000000020",
      proposal: {
        ...canonical.proposal,
        title: "Earlier proposal",
      },
    });
    const controller = controllerFixture(canonical);

    await render(
      <StoryAgentRunCard
        part={toolPart({ status: "accepted", run: historical })}
        controller={controller}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("Earlier proposal");
    expect(container.textContent).toContain("historicalReadOnly");
    expect(button("apply")).toBeNull();
    expect(button("discard")).toBeNull();
    expect(controller.run).toBe(canonical);
    expect(controller.confirm).not.toHaveBeenCalled();
  });

  it("tracks the controller head when an accepted authoring run has advanced to proposed", async () => {
    const authoring = storyAgentRunFixture("authoring");
    const proposed = storyAgentRunFixture("proposed");
    const controller = controllerFixture(proposed);

    await render(
      <StoryAgentRunCard
        part={toolPart({ status: "accepted", run: authoring })}
        controller={controller}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("Clarify the story logline.");
    expect(button("apply")).not.toBeNull();
  });

  it("upgrades a frozen accept-time snapshot to the undoable head so Undo stays reachable", async () => {
    const frozenAuthoring = storyAgentRunFixture("authoring");
    const applied = storyAgentRunFixture("succeeded");
    const newerHead = storyAgentRunFixture("authoring_failed", {
      id: "00000000-0000-4000-8000-000000000041",
    });
    const controller = controllerFixture(newerHead, { undoableRun: applied });

    await render(
      <StoryAgentRunCard
        part={toolPart({ status: "accepted", run: frozenAuthoring })}
        controller={controller}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("applied");
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(button("undo")).not.toBeNull();
    await click(button("undo"));
    expect(controller.undo).toHaveBeenCalledWith(applied.id);
  });

  it("renders a frozen authoring snapshot as static history when no head recognizes it", async () => {
    const frozenAuthoring = storyAgentRunFixture("authoring");
    const newerHead = storyAgentRunFixture("proposed", {
      id: "00000000-0000-4000-8000-000000000042",
    });
    const controller = controllerFixture(newerHead, { undoableRun: null });

    await render(
      <StoryAgentRunCard
        part={toolPart({ status: "accepted", run: frozenAuthoring })}
        controller={controller}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("drafting");
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(container.textContent).not.toContain("authoring");
    expect(button("undo")).toBeNull();
  });

  it("renders actions only for the current canonical proposal with manage permission", async () => {
    const run = storyAgentRunFixture("proposed");
    const controller = controllerFixture(run);

    await render(<StoryAgentRunSummaryCard run={run} controller={controller} canManageAgentRuns />);

    expect(container.textContent).toContain("Build the opening choice");
    expect(container.textContent).toContain("Add a meaningful first decision to the story.");
    expect(container.textContent).toContain("Clarify the story logline.");
    expect(button("discard")).not.toBeNull();
    expect(button("apply")).not.toBeNull();

    await click(button("discard"));
    await click(button("apply"));

    expect(controller.cancel).toHaveBeenCalledWith(STORY_AGENT_TEST_RUN_ID);
    expect(controller.confirm).toHaveBeenCalledWith(STORY_AGENT_TEST_RUN_ID);
    expect(controller.clearActionError).toHaveBeenCalledTimes(2);
  });

  it("replaces proposal actions with explicit review-only copy for non-editors", async () => {
    const run = storyAgentRunFixture("proposed");
    await render(
      <StoryAgentRunSummaryCard
        run={run}
        controller={controllerFixture(run)}
        canManageAgentRuns={false}
      />
    );

    expect(container.textContent).toContain("reviewOnly");
    expect(button("apply")).toBeNull();
    expect(button("discard")).toBeNull();
  });

  it("renders a calm drafting state for an authoring run with no actions or operations", async () => {
    const run = storyAgentRunFixture("authoring");
    await render(
      <StoryAgentRunSummaryCard run={run} controller={controllerFixture(run)} canManageAgentRuns />
    );

    expect(container.textContent).toContain("drafting");
    expect(container.textContent).toContain("Build the opening choice");
    expect(container.textContent).toContain("Add a meaningful first decision to the story.");
    expect(container.textContent).toContain("authoring");
    expect(container.querySelector("ol")).toBeNull();
    expect(button("apply")).toBeNull();
    expect(button("discard")).toBeNull();
    expect(button("retryAuthoring")).toBeNull();
  });

  it("maps a known drafting failure code and re-arms authoring through the controller", async () => {
    const run = storyAgentRunFixture("authoring_failed", {
      error: { code: "STORY_AGENT_PROPOSAL_NO_CHANGES", detail: "Raw worker detail" },
    });
    const controller = controllerFixture(run);
    await render(<StoryAgentRunSummaryCard run={run} controller={controller} canManageAgentRuns />);

    expect(container.textContent).toContain("authoringErrors.STORY_AGENT_PROPOSAL_NO_CHANGES");
    expect(container.textContent).not.toContain("Raw worker detail");

    await click(button("retryAuthoring"));
    expect(controller.retryAuthoring).toHaveBeenCalledWith(run.id);
    await click(button("discard"));
    expect(controller.cancel).toHaveBeenCalledWith(run.id);
  });

  it("falls back to the generic localized drafting failure for unknown codes", async () => {
    const run = storyAgentRunFixture("authoring_failed", {
      error: { code: "STORY_AGENT_UNKNOWN_FAILURE", detail: "Raw worker detail" },
    });
    await render(
      <StoryAgentRunSummaryCard run={run} controller={controllerFixture(run)} canManageAgentRuns />
    );

    expect(container.textContent).toContain("authoringErrors.generic");
  });

  it("keeps drafting failures read-only for members without manage permission", async () => {
    const run = storyAgentRunFixture("authoring_failed");
    await render(
      <StoryAgentRunSummaryCard
        run={run}
        controller={controllerFixture(run)}
        canManageAgentRuns={false}
      />
    );

    expect(container.textContent).toContain("authoringErrors.STORY_AGENT_AUTHORING_FAILED");
    expect(button("retryAuthoring")).toBeNull();
    expect(button("discard")).toBeNull();
  });

  it("removes stale proposal actions as soon as the applying latch is raised", async () => {
    const run = storyAgentRunFixture("proposed");
    await render(
      <StoryAgentRunSummaryCard
        run={run}
        controller={controllerFixture(run, {
          applying: true,
          applyingRunId: run.id,
        })}
        canManageAgentRuns
      />
    );

    expect(container.textContent).toContain("applying");
    expect(button("apply")).toBeNull();
    expect(button("discard")).toBeNull();
  });

  it("keeps an unverified proposal non-actionable and offers canonical refresh on error", async () => {
    const run = storyAgentRunFixture("proposed");
    const controller = controllerFixture(run, { authorityState: "error" });
    await render(<StoryAgentRunSummaryCard run={run} controller={controller} canManageAgentRuns />);

    expect(container.textContent).toContain("currentUnavailable");
    expect(button("apply")).toBeNull();
    await click(button("retry"));
    expect(controller.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a current applying run as owned work with no mutation actions", async () => {
    const run = storyAgentRunFixture("applying");
    await render(
      <StoryAgentRunSummaryCard run={run} controller={controllerFixture(run)} canManageAgentRuns />
    );

    expect(container.textContent).toContain("applying");
    expect(button("apply")).toBeNull();
    expect(button("discard")).toBeNull();
    expect(button("undo")).toBeNull();
  });

  it("offers grouped Undo only for a current succeeded apply run with permission", async () => {
    const succeeded = storyAgentRunFixture("succeeded");
    const controller = controllerFixture(succeeded);
    await render(
      <StoryAgentRunSummaryCard run={succeeded} controller={controller} canManageAgentRuns />
    );

    expect(container.textContent).toContain("applied");
    await click(button("undo"));
    expect(controller.undo).toHaveBeenCalledWith(STORY_AGENT_TEST_RUN_ID);

    const undone = storyAgentRunFixture("succeeded", { kind: "undo" });
    await render(
      <StoryAgentRunSummaryCard
        run={undone}
        controller={controllerFixture(undone)}
        canManageAgentRuns
      />
    );
    expect(container.textContent).toContain("undone");
    expect(button("undo")).toBeNull();
  });

  it.each(["cancelled", "failed", "stale"] as const)(
    "keeps a prior data-head apply undoable after a later %s lifecycle run",
    async (status) => {
      const applied = storyAgentRunFixture("succeeded");
      const laterLifecycleRun = storyAgentRunFixture(status, {
        id: "00000000-0000-4000-8000-000000000036",
      });
      const controller = controllerFixture(laterLifecycleRun, { undoableRun: applied });

      await render(
        <StoryAgentRunSummaryCard run={applied} controller={controller} canManageAgentRuns />
      );

      expect(button("undo")?.disabled).toBe(false);
      await click(button("undo"));
      expect(controller.undo).toHaveBeenCalledWith(applied.id);
    }
  );

  it.each(["proposed", "applying"] as const)(
    "shows but disables the prior Undo while a newer run is %s",
    async (status) => {
      const applied = storyAgentRunFixture("succeeded");
      const active = storyAgentRunFixture(status, {
        id: "00000000-0000-4000-8000-000000000037",
      });
      const controller = controllerFixture(active, {
        undoableRun: applied,
        applying: status === "applying",
        applyingRunId: status === "applying" ? active.id : null,
      });

      await render(
        <StoryAgentRunSummaryCard run={applied} controller={controller} canManageAgentRuns />
      );

      expect(button("undo")).not.toBeNull();
      expect(button("undo")?.disabled).toBe(true);
    }
  );

  it("removes Undo after the undoable data head is cleared by a later write", async () => {
    const applied = storyAgentRunFixture("succeeded");
    const laterUndo = storyAgentRunFixture("succeeded", {
      id: "00000000-0000-4000-8000-000000000038",
      kind: "undo",
      undoOfRunId: applied.id,
    });
    await render(
      <StoryAgentRunSummaryCard
        run={applied}
        controller={controllerFixture(laterUndo, { undoableRun: null })}
        canManageAgentRuns
      />
    );

    expect(button("undo")).toBeNull();
    expect(container.textContent).toContain("historical");
  });

  it("moves Undo authority to the newer successful apply instead of the previous run", async () => {
    const previousApply = storyAgentRunFixture("succeeded");
    const newerApply = storyAgentRunFixture("succeeded", {
      id: "00000000-0000-4000-8000-000000000039",
      updatedAt: "2026-07-18T13:04:00.000Z",
    });
    const controller = controllerFixture(newerApply, { undoableRun: newerApply });

    await render(
      <StoryAgentRunSummaryCard run={previousApply} controller={controller} canManageAgentRuns />
    );
    expect(button("undo")).toBeNull();

    await render(
      <StoryAgentRunSummaryCard run={newerApply} controller={controller} canManageAgentRuns />
    );
    expect(button("undo")?.disabled).toBe(false);
  });

  it("never enables Undo from an unverified cached undoable response", async () => {
    const applied = storyAgentRunFixture("succeeded");
    await render(
      <StoryAgentRunSummaryCard
        run={applied}
        controller={controllerFixture(null, {
          undoableRun: applied,
          undoableAuthorityState: "checking",
          hasUndoableAuthoritySnapshot: false,
        })}
        canManageAgentRuns
      />
    );

    expect(button("undo")).toBeNull();
    expect(container.textContent).toContain("checkingCurrent");
  });

  it("collapses a large proposal to six operations and expands into an internal scroller", async () => {
    const baseProposal = fullProposal(storyAgentRunFixture("proposed"));
    const operations = Array.from({ length: 10 }, (_, index) => ({
      ...structuredClone(baseProposal.operations[0]),
      operationId: `00000000-0000-4000-8000-${String(index + 30).padStart(12, "0")}`,
      summary: `Operation ${index + 1}`,
    }));
    const run = storyAgentRunFixture("proposed", {
      proposal: { ...baseProposal, operations },
    });

    await render(
      <StoryAgentRunSummaryCard run={run} controller={controllerFixture(run)} canManageAgentRuns />
    );
    expect(container.textContent).toContain("Operation 6");
    expect(container.textContent).not.toContain("Operation 7");

    await click(button("showMore"));
    expect(container.textContent).toContain("Operation 10");
    expect(container.querySelector("ol")?.className).toContain("max-h-44");
    expect(button("showLess")).not.toBeNull();
  });

  it("surfaces a rejected preflight without leaking an unhandled promise", async () => {
    const run = storyAgentRunFixture("proposed");
    const controller = controllerFixture(run);
    vi.mocked(controller.confirm).mockRejectedValueOnce(
      new Error("Save the current draft before the Agent can take over.")
    );
    await render(<StoryAgentRunSummaryCard run={run} controller={controller} canManageAgentRuns />);

    await click(button("apply"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Save the current draft before the Agent can take over.");
  });

  it("localizes stable client guard codes while preserving raw service failures", async () => {
    const run = storyAgentRunFixture("proposed");
    const controller = controllerFixture(run);
    vi.mocked(controller.confirm).mockRejectedValueOnce(
      new StoryAgentRunActionGuardError("canonicalHeadChanged", "confirm")
    );
    await render(<StoryAgentRunSummaryCard run={run} controller={controller} canManageAgentRuns />);

    await click(button("apply"));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "actionErrors.canonicalHeadChanged"
    );
  });

  it("removes a local action failure when the run is no longer the canonical head", async () => {
    const run = storyAgentRunFixture("proposed");
    const currentController = controllerFixture(run);
    vi.mocked(currentController.confirm).mockRejectedValueOnce(new Error("Request timed out."));
    await render(
      <StoryAgentRunSummaryCard run={run} controller={currentController} canManageAgentRuns />
    );
    await click(button("apply"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Request timed out.");

    const newerRun = storyAgentRunFixture("proposed", {
      id: "00000000-0000-4000-8000-000000000031",
    });
    await render(
      <StoryAgentRunSummaryCard
        run={run}
        controller={controllerFixture(newerRun)}
        canManageAgentRuns
      />
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("historicalReadOnly");
  });

  async function render(element: React.ReactNode) {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  }

  function button(label: string): HTMLButtonElement | null {
    return (
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.trim() === label
      ) ?? null
    );
  }

  async function click(target: HTMLButtonElement | null) {
    if (!target) throw new Error("Expected action button was not rendered.");
    await act(async () => {
      target.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function controllerFixture(
  run: StoryAgentRunDto | null = null,
  overrides: Partial<StoryAgentRunController> = {}
): StoryAgentRunController {
  const defaultUndoableRun = run?.status === "succeeded" && run.kind === "apply" ? run : null;
  return {
    run,
    undoableRun: defaultUndoableRun,
    projectionTarget: null,
    authorityState: "ready",
    undoableAuthorityState: "ready",
    authoritySnapshotKey: "authority-head",
    hasAuthoritySnapshot: true,
    hasUndoableAuthoritySnapshot: true,
    authorityError: null,
    undoableAuthorityError: null,
    refreshing: false,
    refresh: vi.fn(async () => run),
    applying: run?.status === "applying",
    applyingRunId: run?.status === "applying" ? run.id : null,
    actionPending: false,
    pendingAction: null,
    actionError: null,
    confirm: vi.fn(async () => storyAgentRunFixture("applying")),
    cancel: vi.fn(async () => storyAgentRunFixture("cancelled")),
    retryAuthoring: vi.fn(async () => storyAgentRunFixture("authoring")),
    undo: vi.fn(async () => storyAgentRunFixture("applying", { kind: "undo" })),
    clearActionError: vi.fn(),
    acknowledgeProjectionTarget: vi.fn(),
    ...overrides,
  } as StoryAgentRunController;
}

function fullProposal(run: StoryAgentRunDto): StoryPatchProposal {
  if (isStoryPatchBrief(run.proposal)) {
    throw new Error("Expected a fixture carrying a fully authored proposal.");
  }
  return run.proposal;
}

function toolPart(output: unknown): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: "propose_story_patch",
    toolCallId: "tool-call-1",
    state: "output-available",
    input: {},
    output,
  } as DynamicToolUIPart;
}
