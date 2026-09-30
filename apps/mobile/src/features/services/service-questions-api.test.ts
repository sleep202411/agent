import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { questionsSchema, saveServiceQuestions } from "./service-questions-api";
vi.mock("@/lib/api-client", () => ({ api: { patch: vi.fn() } }));
const question = { id: "persisted", prompt: " Brief? ", helpText: " Link ", required: true };
it("preserves IDs, mints new IDs server-side and sends display order without unrelated fields", async () => {
  await saveServiceQuestions("a/b", {
    expectedVersion: 4,
    requirementQuestions: [{ prompt: "New", helpText: "", required: false }, question],
  });
  expect(api.patch).toHaveBeenCalledWith("/creator-services/a%2Fb", {
    service: "aurora",
    data: {
      expectedVersion: 4,
      requirementQuestions: [
        { prompt: "New", helpText: "", required: false, displayOrder: 0 },
        { id: "persisted", prompt: "Brief?", helpText: "Link", required: true, displayOrder: 1 },
      ],
    },
  });
  await saveServiceQuestions("s", { expectedVersion: 4, requirementQuestions: [] });
  expect(api.patch).toHaveBeenLastCalledWith("/creator-services/s", {
    service: "aurora",
    data: { expectedVersion: 4, requirementQuestions: [] },
  });
});
it.each([
  [question, question],
  [{ ...question, prompt: " " }],
  [{ ...question, helpText: "x".repeat(241) }],
  Array(21).fill({ prompt: "New", helpText: "", required: false }),
])("rejects invalid replace-all edits", (items) => {
  expect(
    questionsSchema.safeParse({ expectedVersion: 1, requirementQuestions: items }).success
  ).toBe(false);
});
it("requires a revision and propagates conflicts without retry", async () => {
  expect(questionsSchema.safeParse({ requirementQuestions: [] }).success).toBe(false);
  vi.mocked(api.patch).mockClear();
  vi.mocked(api.patch).mockRejectedValue(new Error("Version conflict"));
  await expect(
    saveServiceQuestions("s", { expectedVersion: 1, requirementQuestions: [question] })
  ).rejects.toThrow("Version conflict");
  expect(api.patch).toHaveBeenCalledOnce();
});
