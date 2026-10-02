// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryProjectPlaytest } from "./story-project-playtest";

const state = vi.hoisted(() => ({
  getPreview: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "zh-CN",
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/experience-runtime/experience-runtime-player", () => ({
  ExperienceRuntimePlayer: () => <div data-testid="player" />,
}));
vi.mock("@/lib/story-projects-api", () => ({
  getStoryWorkingPreview: state.getPreview,
  getStoryBuild: vi.fn(),
  storyApiErrorMessage: (error: unknown) => String(error),
}));

const host = document.createElement("div");
document.body.append(host);
let root: Root;
let client: QueryClient;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver; the page measures its header with one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderPlaytest = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <StoryProjectPlaytest
          projectId="project-1"
          source={{ kind: "draft", chapterId: "chapter-1", sceneId: "clip:scene-1" }}
        />
      </QueryClientProvider>
    );
  });
};

it("keeps the same hooks when the playtest arrives after the loading render", async () => {
  let resolvePreview!: (value: unknown) => void;
  state.getPreview.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePreview = resolve;
      })
  );

  await renderPlaytest();
  expect(host.querySelector('[data-testid="player"]')).toBeNull();

  await act(async () => {
    resolvePreview({
      draftRevision: 1,
      runtime: {},
      diagnostics: [],
      coverUrl: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(host.textContent ?? "").not.toContain("Rendered more hooks");
  expect(host.querySelector('[data-testid="player"]')).not.toBeNull();
});

it("keeps the player's frame controls clear of its header, down to the refresh button", async () => {
  // The refresh button ends 52px down the page; everything else is the page.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const bottom = this.getAttribute("aria-label") === "refresh" ? 52 : 900;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1440,
      bottom,
      width: 1440,
      height: bottom,
      toJSON: () => ({}),
    } as DOMRect;
  });
  state.getPreview.mockResolvedValue({
    draftRevision: 1,
    runtime: {},
    diagnostics: [],
    coverUrl: null,
  });

  await renderPlaytest();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const main = host.querySelector("main");
  expect(main?.style.getPropertyValue("--experience-chrome-inset-top")).toBe("52px");
});
