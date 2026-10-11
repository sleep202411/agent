import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BlockedAssetBatch } from "./story-asset-batch-generation";
import { storyProductionKeys, type StoryGenerationBatch } from "@/lib/story-production-api";
const api = vi.hoisted(() => ({ resume: vi.fn(), cancel: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/story-production-api", async (original) => ({
  ...(await original<typeof import("@/lib/story-production-api")>()),
  resumeStoryGenerationBatch: api.resume,
  cancelStoryGenerationBatch: api.cancel,
}));
let host: HTMLDivElement, root: Root, client: QueryClient;
const batch = {
  id: "paused",
  status: "blocked",
  canCancel: true,
  counts: { completed: 2 },
  itemCount: 3,
} as StoryGenerationBatch;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
  api.resume.mockReset();
  api.cancel.mockReset();
  client.setQueryData(storyProductionKeys.batches("p", "c"), [batch]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(canCancel = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <BlockedAssetBatch batch={{ ...batch, canCancel }} projectId="p" chapterId="c" />
      </QueryClientProvider>
    )
  );
}
async function click(label: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
it("resumes the existing batch and updates its cached state", async () => {
  api.resume.mockResolvedValue({ ...batch, status: "queued" });
  await render();
  await click("recoveryResume");
  expect(api.resume).toHaveBeenCalledWith("p", "c", "paused");
  expect(
    client.getQueryData<StoryGenerationBatch[]>(storyProductionKeys.batches("p", "c"))?.[0].status
  ).toBe("queued");
});
it("keeps a failed resume recoverable and shows the error", async () => {
  api.resume.mockRejectedValue(new Error("Insufficient points"));
  await render();
  await click("recoveryResume");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Insufficient points");
  expect([...host.querySelectorAll("button")].every((b) => !b.disabled)).toBe(true);
});
it("allows the creator to cancel the paused batch", async () => {
  api.cancel.mockResolvedValue({ ...batch, status: "cancelled" });
  await render();
  await click("cancel");
  expect(api.cancel).toHaveBeenCalledWith("p", "c", "paused");
});
it("does not offer mutations for another creator's batch", async () => {
  await render(false);
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.textContent).toContain("recoveryOwner");
  expect(api.resume).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
});
