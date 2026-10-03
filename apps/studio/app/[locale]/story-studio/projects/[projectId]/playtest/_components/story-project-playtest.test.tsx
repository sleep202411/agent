// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryProjectPlaytest } from "./story-project-playtest";

const state = vi.hoisted(() => ({
  getPreview: vi.fn(),
  /** A runtime the schema takes, when a test needs one; otherwise the real schema decides. */
  manifest: null as unknown,
}));

vi.mock("@repo/shared/experience-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/shared/experience-runtime")>();
  return {
    ...actual,
    ExperienceRuntimeManifestSchema: {
      safeParse: (value: unknown) =>
        state.manifest
          ? { success: true, data: state.manifest }
          : actual.ExperienceRuntimeManifestSchema.safeParse(value),
    },
  };
});

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
  state.manifest = null;
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

it("keeps the player's frame controls below all of its header's chrome, which alone takes taps", async () => {
  // A story with three state rows: the HUD beside the refresh button ends
  // 124px down the page, the refresh button 52px, the title panel 68px.
  state.manifest = {
    buildId: "build-1",
    metadata: { title: { "zh-CN": "Story" } },
    localization: { defaultLocale: "zh-CN", locales: ["zh-CN"] },
    stateDefinitions: ["courage", "trust", "doubt"].map((key) => ({ key })),
  };
  const chromeBottom = (element: HTMLElement): number => {
    if (element.tagName === "MAIN") return 900;
    if (element.tagName === "ASIDE") return 124;
    if (element.getAttribute("aria-label") === "refresh") return 52;
    if (element.parentElement?.tagName === "HEADER") {
      // A header group is as tall as what it holds, as `items-start` lays it out.
      return element.querySelector('[aria-label="refresh"]')
        ? Math.max(...Array.from(element.children, (child) => chromeBottom(child as HTMLElement)))
        : 68;
    }
    return 0;
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const bottom = chromeBottom(this);
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

  const main = host.querySelector("main")!;
  const header = main.querySelector("header")!;
  const hud = header.querySelector("aside");
  const refresh = header.querySelector<HTMLElement>('[aria-label="refresh"]')!;
  expect(hud).not.toBeNull();
  // The frame's top-right falls under the HUD when the picture is pillarboxed,
  // and the unmute pill reaches under it when it is not: the controls start
  // below every piece of the header.
  const inset = Number.parseFloat(main.style.getPropertyValue("--experience-chrome-inset-top"));
  expect(inset).toBe(124);
  for (const chrome of [hud!, refresh, ...Array.from(header.children)]) {
    expect(inset).toBeGreaterThanOrEqual(chromeBottom(chrome as HTMLElement));
  }
  // The groups' own boxes take no taps — the space under the refresh button,
  // beside a taller HUD, belongs to the film — and the chrome in them does.
  for (const group of Array.from(header.children)) {
    if (group.contains(refresh)) expect(group.className).toContain("pointer-events-none");
  }
  expect(refresh.className).toContain("pointer-events-auto");
  expect(hud!.className).toContain("pointer-events-auto");
});
