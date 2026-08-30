// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryProjectHeader } from "./story-project-header";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => "canvas",
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { project: { title: "Test story" } } }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
    "aria-label": ariaLabel,
  }: React.ComponentProps<"a"> & { onNavigate?: unknown }) => (
    <a href={String(href)} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

vi.mock("./story-production-steps", () => ({
  StoryProductionSteps: () => <div data-testid="production-steps" />,
}));

vi.mock("./story-project-header-actions", () => ({
  StoryProjectHeaderActions: () => <div data-testid="header-actions" />,
}));

describe("StoryProjectHeader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useStoryProjectUiStore.setState({ mobileView: "work" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("owns the back action without duplicating the Chapters control", async () => {
    await act(async () => {
      root.render(<StoryProjectHeader projectId="project-1" />);
    });

    const back = container.querySelector<HTMLAnchorElement>('a[aria-label="canvas.back"]');
    expect(back?.getAttribute("href")).toBe("/story-studio");
    expect(container.textContent).toContain("Test story");
    expect(container.textContent).not.toContain("chapters.action");
    expect(container.querySelector('[data-testid="production-steps"]')).not.toBeNull();
  });

  it("keeps the centered production steps clear of the project title on compact desktops", async () => {
    await act(async () => {
      root.render(<StoryProjectHeader projectId="project-1" />);
    });

    const title = container.querySelector("h1");
    expect(title?.className).toContain("hidden");
    expect(title?.className).toContain("max-md:block");
    expect(title?.className).toContain("xl:block");
  });
});
