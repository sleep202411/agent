// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CrewSaveActions } from "./crew-save-actions";
import { CanvasMediaToolbarActions } from "./media-actions-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/lib/collab/project-crew-assets-api", () => ({
  getProjectCrewAssetContext: async () => ({ crew: { id: "crew" }, canSaveFromCanvas: true }),
}));
const media = { nodeId: "node", mediaAssetId: "media", kind: "image" as const, url: "/asset.png" };
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.clearAllMocks();
});
async function mount(kind: "image" | "video" | "audio" = "image") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CrewSaveActions projectId="project" documentId="document" userId="owner" canEdit>
          <CanvasMediaToolbarActions media={{ ...media, kind }} />
        </CrewSaveActions>
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
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
