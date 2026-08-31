// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryProjectRail } from "./story-project-rail";

const navigation = vi.hoisted(() => ({
  segment: "script",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => navigation.segment,
  useSearchParams: () => new URLSearchParams("chapter=chapter-1"),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/story-studio/projects/project-1/script",
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));

describe("StoryProjectRail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    navigation.segment = "script";
    navigation.push.mockReset();
    navigation.replace.mockReset();
    useStoryProjectUiStore.setState({
      sidePanel: null,
      shareOpen: false,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps every destination actionable and places Overview first", async () => {
    await renderRail();

    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("nav a, nav button")
    );
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "sidebar.world",
      "sidebar.catalog",
      "chapters.action",
      "label",
      "share",
    ]);
    expect(items.every((item) => !(item instanceof HTMLButtonElement) || !item.disabled)).toBe(
      true
    );
    expect(items.every((item) => item.getAttribute("aria-disabled") !== "true")).toBe(true);
  });

  it("opens every surface in place — no rail click ever switches the step page", async () => {
    await renderRail();
    const byText = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === label
      );

    await act(async () => byText("sidebar.world")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBe("world");

    await act(async () => byText("chapters.action")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBe("chapters");

    await act(async () => byText("share")?.click());
    expect(useStoryProjectUiStore.getState().shareOpen).toBe(true);
    expect(useStoryProjectUiStore.getState().sidePanel).toBeNull();

    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("toggles an open surface closed on second click", async () => {
    navigation.segment = "canvas";
    await renderRail();
    const byText = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === label
      );

    await act(async () => byText("sidebar.world")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBe("world");
    await act(async () => byText("sidebar.world")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBeNull();

    await act(async () => byText("sidebar.catalog")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBe("catalog");
    await act(async () => byText("sidebar.catalog")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBeNull();

    await act(async () => byText("chapters.action")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBe("chapters");
    await act(async () => byText("chapters.action")?.click());
    expect(useStoryProjectUiStore.getState().sidePanel).toBeNull();

    await act(async () => byText("share")?.click());
    expect(useStoryProjectUiStore.getState().shareOpen).toBe(true);
    await act(async () => byText("share")?.click());
    expect(useStoryProjectUiStore.getState().shareOpen).toBe(false);
  });

  async function renderRail() {
    await act(async () => {
      root.render(<StoryProjectRail projectId="project-1" />);
    });
  }
});
