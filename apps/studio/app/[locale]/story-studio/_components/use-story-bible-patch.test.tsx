// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoryBiblePatch } from "./use-story-bible-patch";
import type { StoryWorkbench } from "@/lib/story-projects-api";
const h = vi.hoisted(() => ({
  chapter: "chapter-a",
  user: "user",
  put: vi.fn(),
  refetch: vi.fn(),
  data: null as unknown,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({ useAuth: () => ({ user: { id: h.user } }) }));
vi.mock("../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (s: { foundationWriter: null }) => unknown) =>
    select({ foundationWriter: null }),
}));
vi.mock("../_lib/use-story-chapter-workbench", () => ({
  storyChapterWorkbenchQueryKey: (project: string, chapter: string, user: string) => [
    "story-studio",
    "chapter-workbench",
    project,
    chapter,
    user,
  ],
  useStoryChapterWorkbench: () => ({ chapterId: h.chapter, data: h.data, refetch: h.refetch }),
}));
vi.mock("@/lib/story-projects-api", async (original) => ({
  ...(await original<object>()),
  putStoryDraft: h.put,
}));
let root: Root, node: HTMLDivElement, client: QueryClient;
let result: ReturnType<typeof useStoryBiblePatch>;
function Harness() {
  const current = useStoryBiblePatch("project");
  useLayoutEffect(() => {
    result = current;
  });
  return null;
}
function workbench(logline: string): StoryWorkbench {
  return {
    project: { capabilities: ["story.edit"] },
    draft: { revision: 1, content: { storyBible: { logline, synopsis: "" } } },
  } as StoryWorkbench;
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    )
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.chapter = "chapter-a";
  h.user = "user";
  h.data = workbench("Original A");
  h.put.mockReset().mockResolvedValue({ revision: 2 });
  h.refetch.mockReset().mockResolvedValue({});
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  client = new QueryClient();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("does not write a previous chapter's pending premise into the newly selected chapter", async () => {
  await render();
  await act(async () => result.patchBible({ logline: "Edited A" }));
  h.chapter = "chapter-b";
  h.data = workbench("Original B");
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(
    h.put.mock.calls.some(
      ([, chapter, input]) =>
        chapter === "chapter-b" && input.content.storyBible.logline === "Edited A"
    )
  ).toBe(false);
  expect(result.content?.storyBible.logline).toBe("Original B");
  expect(h.put).toHaveBeenCalledWith(
    "project",
    "chapter-a",
    expect.objectContaining({
      content: expect.objectContaining({
        storyBible: expect.objectContaining({ logline: "Edited A" }),
      }),
    })
  );
});

it("keeps a new chapter edit when the previous chapter save completes late", async () => {
  let resolve!: (value: { revision: number }) => void;
  h.put.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await act(async () => result.patchBible({ logline: "Edited A" }));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  h.chapter = "chapter-b";
  h.data = workbench("Original B");
  await render();
  await act(async () => result.patchBible({ logline: "Edited B" }));
  await act(async () => resolve({ revision: 2 }));
  expect(result.content?.storyBible.logline).toBe("Edited B");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(h.put).toHaveBeenLastCalledWith(
    "project",
    "chapter-b",
    expect.objectContaining({
      expectedRevision: 1,
      content: expect.objectContaining({
        storyBible: expect.objectContaining({ logline: "Edited B" }),
      }),
    })
  );
});

it("does not flush the previous user's pending draft under a replacement account", async () => {
  await render();
  await act(async () => result.patchBible({ logline: "Private draft" }));
  h.user = "replacement";
  h.data = workbench("Replacement premise");
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(h.put).not.toHaveBeenCalled();
  expect(result.content?.storyBible.logline).toBe("Replacement premise");
});

it("retries the original chapter against its refreshed revision after switching chapters", async () => {
  let reject!: (reason: Error) => void;
  h.put.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  const refreshed = workbench("Remote A");
  refreshed.draft.revision = 4;
  h.refetch.mockResolvedValue({ data: refreshed, isError: false });
  await render();
  await act(async () => result.patchBible({ logline: "Edited A" }));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  h.chapter = "chapter-b";
  h.data = workbench("Original B");
  await render();
  await act(async () => reject(new Error("Revision conflict")));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(h.put).toHaveBeenLastCalledWith(
    "project",
    "chapter-a",
    expect.objectContaining({
      expectedRevision: 4,
      content: expect.objectContaining({
        storyBible: expect.objectContaining({ logline: "Edited A" }),
      }),
    })
  );
  expect(result.content?.storyBible.logline).toBe("Original B");
});
