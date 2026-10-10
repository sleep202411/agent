import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorySequenceSubtitlesDialog } from "./story-sequence-subtitles-dialog";
import { storyProductionKeys, type StoryStoryboardSequence } from "@/lib/story-production-api";

const state = vi.hoisted(() => ({
  account: "alice",
  patch: vi.fn(),
  saved: vi.fn(),
  panelPatch: null as null | ((input: { removeSubtitleLanguage: "en-US" }) => Promise<void>),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: state.account },
    isCurrentAccount: (id: string) => id === state.account,
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: state.saved } }));
vi.mock("@/lib/story-production-api", async (original) => ({
  ...(await original<typeof import("@/lib/story-production-api")>()),
  patchStoryStoryboardSequence: state.patch,
}));
vi.mock("@/lib/story-projects-api", () => ({
  storyApiErrorMessage: (error: Error) => error.message,
}));
vi.mock("./story-sequence-subtitles", () => ({
  StorySequenceSubtitles: ({ onPatch }: { onPatch: NonNullable<typeof state.panelPatch> }) => {
    state.panelPatch = onPatch;
    return <div />;
  },
}));
vi.mock("@/components/ui/dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrap,
    DialogContent: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
    DialogDescription: Wrap,
    DialogFooter: Wrap,
  };
});
const node = { id: "node-one", version: 1 } as StoryStoryboardSequence;
let container: HTMLDivElement, root: Root, client: QueryClient;
const key = storyProductionKeys.storyboard("project", "chapter");
beforeEach(() => {
  state.account = "alice";
  state.patch.mockReset();
  state.saved.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, [
    { ...node, version: 4 },
    { id: "other-node", version: 5 },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
async function render(editable = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StorySequenceSubtitlesDialog
          projectId="project"
          chapterId="chapter"
          sequence={node}
          title="Node one"
          open
          onOpenChange={() => undefined}
          editable={editable}
        />
      </QueryClientProvider>
    )
  );
}
function delayed<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("saves against the current node version and preserves other nodes", async () => {
  state.patch.mockResolvedValue({ ...node, version: 5 });
  await render();
  await act(async () => state.panelPatch!({ removeSubtitleLanguage: "en-US" }));
  expect(state.patch).toHaveBeenCalledWith("project", "chapter", node.id, expect.any(String), {
    expectedVersion: 4,
    removeSubtitleLanguage: "en-US",
  });
  expect(client.getQueryData(key)).toEqual([
    { ...node, version: 5 },
    { id: "other-node", version: 5 },
  ]);
  expect(state.saved).toHaveBeenCalledTimes(1);
});

it("rejects an abandoned account's file read before sending a mutation", async () => {
  await render();
  const admitted = state.panelPatch!;
  state.account = "bob";
  await render();
  await expect(admitted({ removeSubtitleLanguage: "en-US" })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(state.patch).not.toHaveBeenCalled();
});

it("does not write a delayed response into another account's cache or show success", async () => {
  const pending = delayed<StoryStoryboardSequence>();
  state.patch.mockReturnValue(pending.promise);
  await render();
  let completion!: Promise<unknown>;
  await act(async () => {
    completion = state.panelPatch!({ removeSubtitleLanguage: "en-US" }).catch((error) => error);
  });
  state.account = "bob";
  await render();
  await act(async () => {
    pending.resolve({ ...node, version: 5 });
    await completion;
  });
  expect(client.getQueryData<StoryStoryboardSequence[]>(key)?.[0]?.version).toBe(4);
  expect(state.saved).not.toHaveBeenCalled();
});

it("prevents duplicate requests and rejects writes in read-only views", async () => {
  const pending = delayed<StoryStoryboardSequence>();
  state.patch.mockReturnValue(pending.promise);
  await render();
  let completion!: Promise<void>;
  await act(async () => {
    completion = state.panelPatch!({ removeSubtitleLanguage: "en-US" });
  });
  await expect(state.panelPatch!({ removeSubtitleLanguage: "en-US" })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(state.patch).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve({ ...node, version: 5 });
    await completion;
  });
  await render(false);
  await expect(state.panelPatch!({ removeSubtitleLanguage: "en-US" })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(state.patch).toHaveBeenCalledTimes(1);
});
