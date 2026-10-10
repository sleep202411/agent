import { expect, it, vi } from "vitest";
import { api, ApiRequestError } from "@/lib/api-client";
import { createServiceDraft } from "./service-create-api";
vi.mock("@/lib/api-client", () => ({
  api: { post: vi.fn() },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public responseBody?: string
    ) {
      super(message);
    }
  },
}));
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

it("recovers the existing service identified by an edited-creation conflict", async () => {
  vi.mocked(api.post).mockRejectedValue(
    new ApiRequestError(
      "HTTP_409",
      "The created service has changed",
      409,
      JSON.stringify({ serviceId: "existing", message: "The created service has changed" })
    )
  );
  expect(await createServiceDraft(data, "request-key")).toEqual({ id: "existing" });
});
it.each([
  [409, '{"message":"Archived creation"}'],
  [409, '{"serviceId":""}'],
  [409, "<html>Proxy failure</html>"],
  [403, '{"serviceId":"forbidden"}'],
  [500, '{"serviceId":"unconfirmed"}'],
])("preserves unidentified or non-conflict failures (%s, %s)", async (status, body) => {
  const error = new ApiRequestError(`HTTP_${status}`, "Original failure", status, body);
  vi.mocked(api.post).mockRejectedValue(error);
  await expect(createServiceDraft(data, "request-key")).rejects.toBe(error);
});
