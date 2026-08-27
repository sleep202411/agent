// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryProjectMobileNav } from "./story-project-mobile-nav";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => "canvas",
  useSearchParams: () => new URLSearchParams("chapter=url-chapter"),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("StoryProjectMobileNav", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useStoryProjectUiStore.setState({
      activeChapterId: "chapter / 1",
      mobileView: "work",
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useStoryProjectUiStore.setState({ activeChapterId: null, mobileView: "chat" });
    container.remove();
  });

  it("preserves the selected chapter across every mobile production-step link", async () => {
    await act(async () => root.render(<StoryProjectMobileNav projectId="project-1" />));

    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>("a")].map((link) =>
      link.getAttribute("href")
    );
    expect(hrefs).toEqual([
      "/story-studio/projects/project-1/script?chapter=chapter%20%2F%201",
      "/story-studio/projects/project-1/canvas?chapter=chapter%20%2F%201",
      "/story-studio/projects/project-1/assets?chapter=chapter%20%2F%201",
      "/story-studio/projects/project-1/storyboard?chapter=chapter%20%2F%201",
    ]);
  });

  it("falls back to the route chapter before workbench state hydrates", async () => {
    useStoryProjectUiStore.setState({ activeChapterId: null });
    await act(async () => root.render(<StoryProjectMobileNav projectId="project-1" />));

    expect(container.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe(
      "/story-studio/projects/project-1/script?chapter=url-chapter"
    );
  });
});
