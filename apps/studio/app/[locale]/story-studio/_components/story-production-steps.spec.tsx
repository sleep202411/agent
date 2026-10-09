// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryProductionSteps } from "./story-production-steps";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isPending: false,
    data: {
      script: { status: "current" },
      plotTree: { status: "missing" },
      assets: { status: "missing" },
      storyboard: { status: "current" },
      ready: false,
    },
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
  getPathname: ({ locale, href }: { locale: string; href: string }) => `/${locale}${href}`,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("StoryProductionSteps", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    navigation.replace.mockReset();
    vi.spyOn(window, "open").mockReturnValue({
      opener: null,
      closed: false,
      location: { replace: navigation.replace },
      close: vi.fn(),
    } as unknown as Window);
    useStoryProjectUiStore.setState({
      activeChapterId: "chapter-1",
      draftBarrier: null,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
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
    const navigationText = container.querySelector("nav")?.textContent ?? "";
    expect(navigationText.indexOf("tree")).toBeLessThan(navigationText.indexOf("assets"));
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("navigationLabel");
    expect(container.textContent).not.toMatch(/\b[1-4]\b/);
  });

  it("runs the preview through the save barrier instead of linking to it", async () => {
    const barrier = vi.fn(async (run: () => Promise<unknown>) => run());
    useStoryProjectUiStore.setState({
      draftBarrier: barrier as never,
    });
    await act(async () => {
      root.render(<StoryProductionSteps projectId="project-1" active="storyboard" />);
    });

    const preview = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("preview")
    );
    // A link would navigate without flushing the draft the preview compiles from.
    expect(preview).toBeTruthy();
    expect(
      [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))
    ).not.toContain("/story-studio/projects/project-1/playtest?chapter=chapter-1");

    await act(async () => preview?.click());
    expect(barrier).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(navigation.replace).toHaveBeenCalledWith(
      "/en-US/story-studio/projects/project-1/playtest?chapter=chapter-1"
    );
  });

  it.each([
    ["en-US", enUS.storyStudio.canvas.steps.navigationLabel],
    ["zh-CN", zhCN.storyStudio.canvas.steps.navigationLabel],
    ["zh-HK", zhHK.storyStudio.canvas.steps.navigationLabel],
  ])("provides a dedicated production navigation label in %s", (_locale, label) => {
    expect(label).toBeTruthy();
  });
});
