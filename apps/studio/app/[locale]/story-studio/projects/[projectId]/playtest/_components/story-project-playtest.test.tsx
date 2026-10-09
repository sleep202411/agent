import { TooltipProvider } from "@/components/ui/tooltip";
// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryProjectPlaytest } from "./story-project-playtest";

const state = vi.hoisted(() => ({
  getPreview: vi.fn(),
  getProject: vi.fn(),
  saveProject: vi.fn(),
  design: vi.fn(),
  /** A runtime the schema takes, when a test needs one; otherwise the real schema decides. */
  manifest: null as unknown,
  playerMounts: 0,
  playerUnmounts: 0,
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

vi.mock("@/app/[locale]/story-studio/_components/story-project-header-actions", () => ({
  StoryProjectHeaderActions: () => null,
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
vi.mock(
  "@/app/[locale]/story-studio/_components/appearance-design/appearance-player-frame",
  () => ({
    AppearancePlayerFrame: ({
      appearance,
    }: {
      appearance?: {
        presentation?: {
          copy?: { start?: Record<string, string | null> };
          theme?: unknown;
          choices?: unknown;
        };
      };
    }) => {
      const [position, setPosition] = useState(0);
      useEffect(() => {
        state.playerMounts++;
        return () => {
          state.playerUnmounts++;
        };
      }, []);
      return (
        <div
          data-testid="player"
          data-position={position}
          data-appearance={JSON.stringify(appearance)}
          data-start-label={appearance?.presentation?.copy?.start?.["zh-CN"] ?? "Start"}
        >
          <div data-experience-choice-overlay="">
            <button data-experience-choice="" onClick={() => setPosition((value) => value + 1)}>
              Choose next
            </button>
          </div>
        </div>
      );
    },
  })
);
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { post: state.design },
}));

vi.mock("@/lib/story-projects-api", () => ({
  getStoryWorkingPreview: state.getPreview,
  getStoryProject: state.getProject,
  updateStoryProject: state.saveProject,
  getStoryBuild: vi.fn(),
  storyApiErrorMessage: (error: unknown) => String(error),
}));

const SESSION_ID = "019f60f4-b101-70d4-8000-000000000003";
const SESSION_URL = `/aurora/game-agent/projects/project-1/appearance/web/${SESSION_ID}/`;
const sessionResponse = async (
  _url: string,
  config: { data: { action: string; leaseId?: string; request?: { requestId: string } } }
) => {
  if (config.data.action === "poll") return { result: null };
  if (config.data.action === "close") return { closed: true };
  return {
    id: SESSION_ID,
    url: SESSION_URL,
    requestId: config.data.request!.requestId,
    leaseId: config.data.leaseId,
  };
};

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
  localStorage.clear();
  root = createRoot(host);
  state.design.mockImplementation(sessionResponse);
  state.getProject.mockResolvedValue({
    id: "project-1",
    projectVersion: 0,
    appearance: null,
    capabilities: ["story.read", "story.edit", "story.generate"],
  });
  state.playerMounts = 0;
  state.playerUnmounts = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  state.manifest = null;
  client.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const renderPlaytest = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <StoryProjectPlaytest
            projectId="project-1"
            source={{ kind: "draft", chapterId: "chapter-1", sceneId: "clip:scene-1" }}
          />
        </TooltipProvider>
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

it("puts authoring chrome above the player instead of over its frame", async () => {
  state.manifest = {
    buildId: "build-1",
    metadata: { title: { "zh-CN": "Story" } },
    localization: { defaultLocale: "zh-CN" },
    stateDefinitions: ["courage"].map((key) => ({ key })),
    graph: { nodes: [] },
  };
  state.getPreview.mockResolvedValue({ draftRevision: 1, runtime: {}, diagnostics: [] });
  await renderPlaytest();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const header = host.querySelector("header")!;
  expect(header.contains(host.querySelector('[data-testid="player"]'))).toBe(false);
  expect(header.querySelector('[aria-label="title"]')).not.toBeNull();
  expect(header.querySelector("aside")).toBeNull();
  expect(header.querySelector('[aria-label="refresh"]')).not.toBeNull();
  expect(host.querySelector("main")?.style.getPropertyValue("--experience-chrome-inset-top")).toBe(
    ""
  );
});

const appearanceFixture = () => {
  vi.stubEnv("NODE_ENV", "development");
  state.manifest = {
    buildId: "design",
    metadata: { title: { "zh-CN": "Story" } },
    localization: { defaultLocale: "zh-CN", locales: ["zh-CN"] },
    stateDefinitions: [],
    assets: [],
    graph: { nodes: [] },
  };
  state.getPreview.mockResolvedValue({
    draftRevision: 1,
    runtime: {},
    diagnostics: [],
    coverUrl: null,
  });
};

it("embeds official chat and keeps the player mounted when a validated result arrives", async () => {
  appearanceFixture();
  let request: { requestId: string; appearance: object };
  let applied = false;
  state.design.mockImplementation(async (_url, config) => {
    if (config.data.action === "open") {
      request = { ...config.data.request, requestId: "11111111-1111-4111-8111-111111111111" };
      return {
        id: SESSION_ID,
        url: SESSION_URL,
        requestId: request.requestId,
        leaseId: config.data.leaseId,
      };
    }
    if (!applied) return { result: null };
    return {
      result: {
        requestId: request!.requestId,
        appearance: {
          ...request!.appearance,
          presentation: {
            copy: { start: { "zh-CN": "Enter story" } },
            theme: {
              version: 1,
              name: "Palace",
              css: '[data-experience-ui-region="choices"] [data-ui-part="option"] {color:#d6b77a;background-image:asset("frame")}',
              assets: [
                {
                  id: "frame",
                  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M1 1L99 1L99 39L1 39Z" stroke="#d6b77a" fill="none"/></svg>',
                },
              ],
            },
          },
        },
        message: "Updated.",
      },
    };
  });
  await renderPlaytest();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(SESSION_URL);
  expect(host.querySelector("textarea")).toBeNull();
  const choice = () => host.querySelector<HTMLButtonElement>("[data-experience-choice]")!;
  await act(async () => choice().click());
  applied = true;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 850));
  });
  expect(host.querySelector('[data-testid="player"]')?.getAttribute("data-appearance")).toContain(
    "Palace"
  );
  expect(host.querySelector('[data-testid="player"]')?.getAttribute("data-start-label")).toBe(
    "Enter story"
  );
  expect(host.querySelector('[data-testid="player"]')?.getAttribute("data-position")).toBe("1");
  expect(state.playerMounts).toBe(1);
  await act(async () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "chat.undo")!
      .click()
  );
  expect(host.querySelector('[data-theme-package="true"]')).toBeNull();
  expect(host.querySelector('[data-theme-package="true"]')).toBeNull();
  expect(host.querySelector('[data-testid="player"]')?.getAttribute("data-start-label")).toBe(
    "Start"
  );
  expect(state.playerUnmounts).toBe(0);
});

it("surfaces chat startup errors and reconnects without resetting the preview", async () => {
  appearanceFixture();
  state.design
    .mockRejectedValueOnce(new Error("Harness unavailable."))
    .mockImplementation(sessionResponse);
  await renderPlaytest();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(host.textContent).toContain("Harness unavailable.");
  await act(async () => {
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.textContent === "chat.reconnect")!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(host.querySelector("iframe")).not.toBeNull();
  expect(state.playerMounts).toBe(1);
});

it("collapses and restores chat without recreating the iframe or the running player", async () => {
  appearanceFixture();
  state.design.mockImplementation(sessionResponse);
  await renderPlaytest();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const frame = host.querySelector("iframe");
  expect(host.querySelector('[role="separator"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="hideChat"]')!.click());
  expect(host.querySelector("main")?.hasAttribute("data-chat-hidden")).toBe(true);
  expect(frame).not.toBeNull();
  expect(host.querySelector("iframe")).toBe(frame);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="showChat"]')!.click());
  expect(frame).not.toBeNull();
  expect(host.querySelector("iframe")).toBe(frame);
  expect(state.playerMounts).toBe(1);
  expect(state.playerUnmounts).toBe(0);
});

it("saves the local draft with its original project version and keeps it after a conflict", async () => {
  appearanceFixture();
  state.design.mockImplementation(sessionResponse);
  const appearance = {
    version: 1,
    presentation: { copy: { start: { "zh-CN": "Enter" } } },
  };
  localStorage.setItem(
    "fizzdragon.appearance-ux.v1:project-1",
    JSON.stringify({
      version: 3,
      applied: appearance,
      prompt: "",
      undo: [],
      baseProjectVersion: 2,
    })
  );
  state.getProject.mockResolvedValue({
    id: "project-1",
    projectVersion: 3,
    appearance: null,
    capabilities: ["story.edit", "story.generate"],
  });
  state.saveProject.mockRejectedValueOnce(new Error("The project changed. Refresh before saving."));
  await renderPlaytest();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "saveProject")!
      .click()
  );
  expect(state.saveProject).toHaveBeenCalledWith("project-1", {
    expectedProjectVersion: 2,
    appearance,
  });
  expect(host.textContent).toContain("The project changed.");
  expect(
    JSON.parse(localStorage.getItem("fizzdragon.appearance-ux.v1:project-1")!).applied
  ).toEqual(appearance);
  expect(state.playerMounts).toBe(1);
  state.getProject.mockResolvedValue({
    id: "project-1",
    projectVersion: 4,
    appearance: null,
    capabilities: ["story.edit", "story.generate"],
  });
  await act(async () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "reloadProject")!
      .click()
  );
  expect(host.textContent).not.toContain("The project changed.");
  expect(host.querySelector('[data-testid="player"]')?.getAttribute("data-appearance")).toBe(
    JSON.stringify(appearance)
  );
  state.saveProject.mockResolvedValue({
    id: "project-1",
    projectVersion: 5,
    appearance,
    capabilities: ["story.edit", "story.generate"],
  });
  await act(async () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "saveProject")!
      .click()
  );
  expect(state.saveProject).toHaveBeenLastCalledWith("project-1", {
    expectedProjectVersion: 4,
    appearance,
  });
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    expect(host.textContent).toContain("savedProject");
  });
  expect(
    JSON.parse(localStorage.getItem("fizzdragon.appearance-ux.v1:project-1")!).baseProjectVersion
  ).toBe(5);
  expect(state.playerMounts).toBe(1);
  expect(state.playerUnmounts).toBe(0);
});
