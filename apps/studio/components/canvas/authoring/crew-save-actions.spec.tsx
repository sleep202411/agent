// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CrewSaveActions } from "./crew-save-actions";
import {
  CanvasMediaToolbarActions,
  useCanvasMediaActions,
  type CanvasMediaAction,
} from "./media-actions-context";
import { api } from "@/lib/api";
import { getProjectCrewAssetContext } from "@/lib/collab/project-crew-assets-api";
import { toast } from "sonner";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/lib/collab/project-crew-assets-api", () => ({
  getProjectCrewAssetContext: vi.fn(async () => ({
    crew: { id: "crew" },
    canSaveFromCanvas: true,
  })),
}));
const media = { nodeId: "node", mediaAssetId: "media", kind: "image" as const, url: "/asset.png" };
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let actions: readonly CanvasMediaAction[] = [];
function Capture() {
  const current = useCanvasMediaActions(media);
  useLayoutEffect(() => {
    actions = current;
  }, [current]);
  return null;
}
function view(canEdit = true, kind: "image" | "video" | "audio" = "image") {
  return (
    <QueryClientProvider client={client}>
      <CrewSaveActions projectId="project" documentId="document" userId="owner" canEdit={canEdit}>
        <Capture />
        <CanvasMediaToolbarActions media={{ ...media, kind }} />
      </CrewSaveActions>
    </QueryClientProvider>
  );
}
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  notifyManager.setScheduler(defaultScheduler);
  host.remove();
  vi.clearAllMocks();
});
async function mount(kind: "image" | "video" | "audio" = "image") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler(queueMicrotask);
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(view(true, kind));
  });
}
it.each(["image", "video"] as const)(
  "saves %s once and permits retry after failure",
  async (kind) => {
    let reject!: (reason: Error) => void;
    vi.mocked(api.post).mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    await mount(kind);
    const button = host.querySelector("button")!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/documents/document/crew-assets",
      expect.objectContaining({ data: { mediaAssetId: "media" } })
    );
    await act(async () => reject(new Error("Please retry")));
    expect(toast.error).toHaveBeenCalledWith("Please retry");
    vi.mocked(api.post).mockResolvedValueOnce({ folderName: "Harbour" });
    await act(async () => button.click());
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledOnce();
  }
);
it("does not add a save action to audio cards", async () => {
  await mount("audio");
  expect(host.querySelector("button")).toBeNull();
});
it("aborts on unmount and suppresses delayed messages", async () => {
  let resolve!: (result: unknown) => void;
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await mount();
  await act(async () => host.querySelector("button")!.click());
  const signal = vi.mocked(api.post).mock.calls[0][1]?.signal;
  await act(async () => root.render(null));
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve({ folderName: "Old project" }));
  expect(toast.success).not.toHaveBeenCalled();
});

it("rejects retained callbacks and abandons results after editing permission is lost", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await mount();
  const retained = actions[0].onSelect;
  await act(async () => retained());
  const signal = vi.mocked(api.post).mock.calls[0][1]?.signal;
  await act(async () => root.render(view(false)));
  expect(signal?.aborted).toBe(true);
  expect(host.querySelector("button")).toBeNull();
  await act(async () => retained());
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ folderName: "Abandoned" }));
  expect(toast.success).not.toHaveBeenCalled();
});
it("keeps a replacement save pending when an abandoned request finishes", async () => {
  let rejectOld!: (error: Error) => void;
  let resolveNew!: (value: unknown) => void;
  vi.mocked(api.post)
    .mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          rejectOld = fail;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveNew = done;
        })
    );
  await mount();
  await act(async () => actions[0].onSelect());
  await act(async () => root.render(view(false)));
  await act(async () => root.render(view(true)));
  await act(async () => actions[0].onSelect());
  expect(actions[0].pending).toBe(true);
  await act(async () => rejectOld(new Error("Old request")));
  expect(actions[0].pending).toBe(true);
  expect(toast.error).not.toHaveBeenCalled();
  await act(async () => actions[0].onSelect());
  expect(api.post).toHaveBeenCalledTimes(2);
  await act(async () => resolveNew({ folderName: "Current" }));
  expect(actions[0].pending).toBe(false);
  expect(toast.success).toHaveBeenCalledOnce();
});

it("cancels an abandoned context read", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(getProjectCrewAssetContext).mockImplementationOnce((_projectId, captured) => {
    signal = captured;
    return new Promise(() => {});
  });
  await mount();
  expect(signal).toBeDefined();
  expect(signal?.aborted).toBe(false);
  await act(async () => root.render(null));
  expect(signal?.aborted).toBe(true);
});
