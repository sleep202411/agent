import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { saveServiceDetails, serviceDetailsSchema } from "./service-edit-api";
vi.mock("@/lib/api-client", () => ({ api: { patch: vi.fn() } }));
const input = {
  title: " Film ",
  summary: " Editing ",
  category: "editing_post" as const,
  tags: [" Film "],
  expectedVersion: 3,
};
it("saves metadata with concurrency protection without replacing other service fields", async () => {
  await saveServiceDetails("a/b", {
    ...input,
    packages: [],
    requirementQuestions: [],
    coverPath: "",
  } as typeof input);
  expect(api.patch).toHaveBeenCalledWith("/creator-services/a%2Fb", {
    service: "aurora",
    data: {
      title: "Film",
      summary: "Editing",
      category: "editing_post",
      tags: ["Film"],
      expectedVersion: 3,
    },
  });
});
it.each([
  { title: " " },
  { summary: "x".repeat(1001) },
  { category: "unknown" },
  { tags: Array(11).fill("tag") },
  { tags: ["x".repeat(49)] },
  { expectedVersion: undefined },
  { expectedVersion: -1 },
])("rejects invalid metadata or missing concurrency token", (invalid) => {
  expect(serviceDetailsSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
});
it("propagates version conflicts without resubmitting", async () => {
  vi.mocked(api.patch).mockClear();
  const error = new Error("Service changed; reload before saving");
  vi.mocked(api.patch).mockRejectedValue(error);
  await expect(saveServiceDetails("s", input)).rejects.toBe(error);
  expect(api.patch).toHaveBeenCalledOnce();
});
