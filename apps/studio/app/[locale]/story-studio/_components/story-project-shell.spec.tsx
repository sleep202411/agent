// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryProjectShell } from "./story-project-shell";

const navigation = vi.hoisted(() => ({ segment: "storyboard" as string | null }));

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => navigation.segment,
}));

vi.mock("./story-project-agent-panel", () => ({
  StoryProjectAgentPanel: () => <aside data-testid="agent" />,
}));
vi.mock("./story-project-header", () => ({
  StoryProjectHeader: () => <header data-testid="header" />,
}));
vi.mock("./story-project-mobile-nav", () => ({
  StoryProjectMobileNav: () => <nav data-testid="mobile-nav" />,
}));
vi.mock("./story-project-rail", () => ({
  StoryProjectRail: () => <nav data-testid="rail" />,
}));
vi.mock("./story-project-share-dialog", () => ({
  StoryProjectShareDialog: () => <div data-testid="share" />,
}));
vi.mock("./story-project-side-panel", () => ({
  StoryProjectSidePanel: () => <aside data-testid="side-panel" />,
}));
vi.mock("./story-project-work-view", () => ({
  StoryProjectWorkView: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="work-view">{children}</div>
  ),
}));

describe("StoryProjectShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    navigation.segment = "storyboard";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("gives the editor the full viewport without project chrome", async () => {
    navigation.segment = "edit";
    await act(async () =>
      root.render(<StoryProjectShell projectId="project-1">Editor</StoryProjectShell>)
    );

    expect(container.querySelector('[data-slot="story-project-editor-shell"]')).not.toBeNull();
    expect(container.textContent).toBe("Editor");
    expect(container.querySelector('[data-testid="header"]')).toBeNull();
    expect(container.querySelector('[data-testid="rail"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent"]')).toBeNull();
  });

  it("keeps the shared chrome for production stages", async () => {
    await act(async () =>
      root.render(<StoryProjectShell projectId="project-1">Storyboard</StoryProjectShell>)
    );

    expect(container.querySelector('[data-testid="header"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rail"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="work-view"]')?.textContent).toBe("Storyboard");
  });
});
