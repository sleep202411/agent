import { expect, it, vi } from "vitest";
import { listFizzAiJobs, submitFizzAiJob } from "./generation-api";
import { api } from "@/src/lib/api";
vi.mock("@/src/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ jobs: [] }),
    post: vi.fn().mockResolvedValue({ request_id: "job" }),
  },
}));
it("binds recovery lookup and replay to the originating workspace and request", async () => {
  await listFizzAiJobs({
    workspaceId: "original-workspace",
    idempotencyKey: "original:key",
    documentId: "doc",
    documentBlockId: "node",
    sourceSurface: "fizzstudio-canvas",
    type: "image",
  });
  const [url, config] = vi.mocked(api.get).mock.calls[0];
  expect(new URL(String(url), "https://fixture.test").searchParams.get("idempotencyKey")).toBe(
    "original:key"
  );
  expect(config?.headers).toEqual({ "x-fizz-workspace-id": "original-workspace" });
  await submitFizzAiJob({
    context: {
      workspaceId: "original-workspace",
      projectId: "project",
      documentId: "doc",
      documentBlockId: "node",
      sourceSurface: "fizzstudio-canvas",
    },
    idempotencyKey: "original:key",
    input: { prompt: "reviewed" },
    modelId: "original-model",
    schemaVersion: "1",
  });
  expect(api.post).toHaveBeenCalledWith(
    "/aurora/ai/jobs",
    expect.objectContaining({
      headers: { "x-fizz-workspace-id": "original-workspace" },
      data: expect.objectContaining({ idempotencyKey: "original:key", modelId: "original-model" }),
    })
  );
});
