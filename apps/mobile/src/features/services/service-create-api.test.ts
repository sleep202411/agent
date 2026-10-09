import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { createServiceDraft } from "./service-create-api";
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
const data = {
  title: " Film ",
  summary: " Edit ",
  category: "editing_post" as const,
  tags: ["cut"],
};
it("creates an unpublished draft with a stable request key and no invented packages", async () => {
  vi.mocked(api.post).mockResolvedValue({ id: "s" });
  expect(await createServiceDraft(data, "request-key")).toEqual({ id: "s" });
  expect(api.post).toHaveBeenCalledWith("/creator-services", {
    service: "aurora",
    data: {
      title: "Film",
      summary: "Edit",
      category: "editing_post",
      tags: ["cut"],
      clientRequestKey: "request-key",
      packages: [],
      requirementQuestions: [],
    },
  });
});
it("rejects invalid fields/keys and malformed success replies", async () => {
  vi.mocked(api.post).mockClear();
  await expect(createServiceDraft({ ...data, title: " " }, "request-key")).rejects.toThrow();
  await expect(createServiceDraft(data, "x")).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockResolvedValue({});
  await expect(createServiceDraft(data, "request-key")).rejects.toThrow();
});
