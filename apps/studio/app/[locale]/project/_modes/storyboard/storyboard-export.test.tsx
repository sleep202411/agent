import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryboardExport } from "./storyboard-export";
import { api } from "@/lib/api";
const state = vi.hoisted(() => ({ userId: "owner", story: false, sequence: 1 as number | null }));
vi.mock("../../_components/project-context", () => ({
  useOptionalProjectContext: () => ({
    owner: { kind: state.story ? "story_project" : "platform_project" },
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: state.userId },
    isCurrentAccount: (id: string) => id === state.userId,
  }),
}));
vi.mock("../../_components/canvas-connection-context", () => ({
  useOptionalCanvasConnection: () => ({
    documentId: "document",
    provider: { getSavedSequence: () => state.sequence },
  }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
const job = {
  id: "job",
  sequence: 1,
  width: 1280,
  height: 720,
  status: "completed",
  error: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
beforeEach(() => {
  state.userId = "owner";
  state.story = false;
  state.sequence = 1;
  vi.mocked(api.get).mockReset().mockResolvedValue([]);
  vi.mocked(api.post).mockReset().mockResolvedValue(job);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StoryboardExport disabled={false} />
      </QueryClientProvider>
    )
  );
}
async function click(label: string) {
  await act(async () => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === label
    );
    expect(button).toBeTruthy();
    button!.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
it("waits for acknowledged changes before submitting a saved revision", async () => {
  state.sequence = null;
  await render();
  await click("open");
  await click("create");
  expect(document.body.textContent).toContain("waitForSave");
  expect(api.post).not.toHaveBeenCalled();
  state.sequence = 7;
  await click("create");
  expect(api.post).toHaveBeenCalledWith(
    "/aurora/storyboard-exports",
    expect.objectContaining({
      data: expect.objectContaining({
        expectedSequence: 7,
        documentId: "document",
        width: 1280,
        height: 720,
      }),
    })
  );
});
it("reuses the exact request after an interrupted response", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("connection interrupted"))
    .mockResolvedValueOnce(job);
  await render();
  await click("open");
  await click("create");
  expect(document.body.textContent).toContain("connection interrupted");
  const first = vi.mocked(api.post).mock.calls[0]![1]?.data;
  state.sequence = 8;
  await click("retry");
  expect(vi.mocked(api.post).mock.calls[1]![1]?.data).toEqual(first);
});
it("recovers completed exports from history and requests a protected download", async () => {
  vi.mocked(api.get).mockResolvedValue([job]);
  vi.mocked(api.post).mockResolvedValue({
    url: "https://private.invalid/result",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await render();
  await click("open");
  await click("download");
  expect(api.get).toHaveBeenCalledWith(
    "/aurora/storyboard-exports",
    expect.objectContaining({ params: { documentId: "document" }, requestScope: "user" })
  );
  expect(api.post).toHaveBeenCalledWith(
    "/aurora/storyboard-exports/job/download",
    expect.anything()
  );
  expect(anchor).toHaveBeenCalledOnce();
});
it("does not download a prior account result after switching accounts", async () => {
  vi.mocked(api.get).mockResolvedValue([job]);
  let resolve!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await render();
  await click("open");
  await click("download");
  state.userId = "other";
  await render();
  await act(async () =>
    resolve({
      url: "https://private.invalid/result",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    })
  );
  expect(anchor).not.toHaveBeenCalled();
});

it("does not expose merged export for interactive Story projects", async () => {
  state.story = true;
  await render();
  expect(container.querySelector("button")).toBeNull();
  expect(api.get).not.toHaveBeenCalled();
});
