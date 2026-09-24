// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryBuildDiagnostic } from "@/lib/story-projects-api";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoryNodeErrorBadge } from "./story-node-error-badge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    key === "nodeIssues" ? `${values?.count} issue(s)` : key,
}));

function diagnostic(code: string, message: string, entityId: string | null): StoryBuildDiagnostic {
  return { severity: "error", code, message, entityType: "clip", entityId };
}

describe("StoryNodeErrorBadge", () => {
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

  it("renders nothing without issues", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <StoryNodeErrorBadge issues={[]} />
        </TooltipProvider>
      );
    });
    expect(container.innerHTML).toBe("");
  });

  it("shows the count and keeps the reason on the trigger", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <StoryNodeErrorBadge
            issues={[
              diagnostic(
                "STORY_BUILD_WORLD_NOT_READY",
                "Scene clip:S01 world is building.",
                "clip:S01"
              ),
              diagnostic(
                "STORY_BUILD_TIMELINE_DUPLICATE",
                "Scene clip:S01 timeline repeats.",
                "clip:S01"
              ),
            ]}
          />
        </TooltipProvider>
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>("button");
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("2");
    expect(trigger?.getAttribute("aria-label")).toBe("2 issue(s)");
    expect(trigger?.className).toContain("nodrag");
    expect(trigger?.className).toContain("nopan");
  });

  it("stops pointer events from reaching the canvas drag layer", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <StoryNodeErrorBadge issues={[diagnostic("STORY_BUILD_X", "Blocker.", "clip:S01")]} />
        </TooltipProvider>
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>("button");
    if (!trigger) throw new Error("badge trigger missing");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    const spy = vi.spyOn(click, "stopPropagation");
    trigger.dispatchEvent(click);
    expect(spy).toHaveBeenCalled();
  });
});
