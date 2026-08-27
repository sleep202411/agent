// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoryStageLoadingState, StoryStageNotice } from "./story-stage-empty-state";

describe("StoryStageNotice", () => {
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

  it("uses a neutral transparent surface with only a compact semantic signal", async () => {
    await act(async () => {
      root.render(<StoryStageNotice title="Needs attention" description="Review this state." />);
    });

    const notice = container.querySelector("section");
    expect(notice?.className).toContain("border-white/[0.08]");
    expect(notice?.className).toContain("bg-transparent");
    expect(notice?.className).not.toContain("bg-amber");
    expect(container.querySelector("svg")?.className.baseVal).toContain("text-brand-yellow");
    expect(container.querySelector("h2")?.className).toContain("text-white/90");
  });

  it("renders loading feedback directly on the canvas without a placeholder surface", async () => {
    await act(async () => {
      root.render(<StoryStageLoadingState label="Loading Asset Specs…" />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("Loading Asset Specs…");
    expect(status?.className).not.toMatch(/(?:^|\s)(?:bg|border|ring|shadow)-/);
  });
});
