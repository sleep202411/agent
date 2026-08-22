// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryProductionSteps } from "./story-production-steps";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isPending: false,
    data: {
      script: { status: "current" },
      plotTree: { status: "stale" },
      assets: { status: "missing" },
      storyboard: { status: "current" },
    },
  }),
}));

vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ activeWorkspace: { id: "workspace-1" } }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

describe("StoryProductionSteps", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useStoryProjectUiStore.setState({ activeChapterId: "chapter-1" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps every readiness state navigable within the active chapter", async () => {
    await act(async () => {
      root.render(<StoryProductionSteps projectId="project-1" active="assets" />);
    });

    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/story-studio/projects/project-1/script?chapter=chapter-1",
      "/story-studio/projects/project-1/canvas?chapter=chapter-1",
      "/story-studio/projects/project-1/storyboard?chapter=chapter-1",
    ]);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("assets");
    expect(container.textContent).not.toMatch(/\b[1-4]\b/);
  });
});
