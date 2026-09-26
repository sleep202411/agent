// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoryStoryboard } from "@/lib/story-production-api";
import { useStoryProjectUiStore } from "../../_stores/story-project-ui-store";
import { StoryNodeStoryboardPanel } from "./story-node-storyboard-panel";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => {
    if (key === "summary") return `${values?.count} clips · ${values?.ready} ready`;
    return key;
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: navigation.push }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/story-production-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-production-api")>();
  return { ...actual, getStoryStoryboard: vi.fn() };
});

describe("StoryNodeStoryboardPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    navigation.push.mockReset();
    vi.mocked(getStoryStoryboard).mockReset().mockResolvedValue([]);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
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
    queryClient.clear();
    container.remove();
    useStoryProjectUiStore.setState({ activeChapterId: null, draftBarrier: null });
  });

  it("opens a newborn node's canonical empty timeline through the canvas save barrier", async () => {
    const barrier = vi.fn(async (submit: (revision: number) => Promise<unknown>) => submit(7));
    useStoryProjectUiStore.setState({ draftBarrier: barrier as never });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StoryNodeStoryboardPanel projectId="project-1" nodeId="node-1" />
        </QueryClientProvider>
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const entry = container.querySelector<HTMLButtonElement>("button");
    expect(entry).not.toBeNull();
    expect(entry?.disabled).toBe(false);
    expect(container.textContent).toContain("0 clips · 0 ready");
    expect(container.textContent).toContain("open");
    expect(container.textContent).not.toContain("missing");

    await act(async () => {
      entry?.click();
      await Promise.resolve();
    });

    expect(barrier).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith(
      "/story-studio/projects/project-1/edit?chapter=chapter-1&node=node-1"
    );
  });

  it("keeps upload beside an existing clip and replace on that clip", async () => {
    vi.mocked(getStoryStoryboard).mockResolvedValue([
      {
        id: "sequence-1",
        plotNodeId: "node-1",
        clips: [
          {
            id: "clip-1",
            title: "SCENE_1",
            kind: "video",
            durationMs: 111_000,
            selectedMediaVersion: {
              mediaKind: "video",
              previewUrl: "https://example.test/clip.mp4",
              thumbnailUrl: null,
              mimeType: "video/mp4",
            },
          },
        ],
      } as never,
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StoryNodeStoryboardPanel projectId="project-1" nodeId="node-1" canEdit />
        </QueryClientProvider>
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const labels = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toContain("replaceVideoAction");
    expect(labels).toContain("uploadVideo");
    expect(labels[0]).toContain("open");
    const cover = container.querySelector("video");
    expect(cover?.hasAttribute("controls")).toBe(false);
    expect(container.querySelector('a[href*="/edit"]')).toBeNull();
    expect(container.textContent).not.toContain("111");
  });
});
