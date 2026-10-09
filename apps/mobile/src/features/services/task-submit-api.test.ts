import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchTaskSubmitPermission,
  fetchDeliveryFolders,
  submitTask,
  validateTaskSubmission,
} from "./task-submit-api";
import type { TaskDetail } from "./task-detail-api";
import type { DeliveryTemplate } from "./task-delivery-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const file = "22222222-2222-4222-8222-222222222222";
const task: TaskDetail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "",
  version: 1,
  status: "open",
  revisionLimit: 2,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  workflowState: { name: "Open" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [{ id, userId: "1" }],
  submissions: [],
};
const template: DeliveryTemplate = {
  categoryId: id,
  version: 2,
  definition: {
    name: "Video",
    description: "",
    prices: [],
    fields: [
      { key: "description", label: "Description", instructions: "", type: "text", required: true },
      { key: "video", label: "Video", instructions: "", type: "attachment", required: true },
    ],
  },
};
const input = {
  note: " Done ",
  assetNodeIds: [file],
  professionalDelivery: {
    categoryId: id,
    version: 2,
    answers: { description: " Final cut ", video: [file] },
  },
};
beforeEach(() => vi.resetAllMocks());
it("requires explicit submit permission plus assignment or management", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.manage"] });
  expect(await fetchTaskSubmitPermission(task, "1", signal)).toBe(false);
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: ["tasks.submit_assigned"] });
  expect(await fetchTaskSubmitPermission(task, "1", signal)).toBe(true);
  expect(await fetchTaskSubmitPermission({ ...task, assignees: [] }, "1", signal)).toBe(false);
  expect(await fetchTaskSubmitPermission({ ...task, status: "submitted" }, "1", signal)).toBe(
    false
  );
  await expect(fetchTaskSubmitPermission(task, "2", signal)).rejects.toThrow("account mismatch");
  vi.mocked(api.get).mockResolvedValue({
    userId: "1",
    permissions: ["tasks.submit_assigned", "tasks.manage"],
  });
  expect(await fetchTaskSubmitPermission({ ...task, assignees: [] }, "1", signal)).toBe(true);
});
it("requires current template revision and all mandatory answers", () => {
  expect(validateTaskSubmission(input, template).professionalDelivery?.answers.description).toBe(
    "Final cut"
  );
  expect(() => validateTaskSubmission(input, null)).toThrow("no professional");
  expect(() => validateTaskSubmission({ note: "", assetNodeIds: [] }, template)).toThrow(
    "changed or is missing"
  );
  expect(() =>
    validateTaskSubmission(
      { ...input, professionalDelivery: { ...input.professionalDelivery, version: 1 } },
      template
    )
  ).toThrow("changed or is missing");
  const badAnswers: Record<string, string | string[]>[] = [
    { video: [file] },
    { description: " ", video: [file] },
    { description: "Cut", video: [] },
    { description: "Cut", video: [id] },
    { description: "Cut", video: [file, file] },
    { description: "Cut", video: [file], unknown: "x" },
  ];
  for (const answers of badAnswers) {
    expect(() =>
      validateTaskSubmission(
        { ...input, professionalDelivery: { ...input.professionalDelivery, answers } },
        template
      )
    ).toThrow();
  }
  expect(() =>
    validateTaskSubmission({ ...input, assetNodeIds: [file, file] }, template)
  ).toThrow();
});

it("lists only writable delivery folders and preserves transport failures", async () => {
  vi.mocked(api.get).mockResolvedValue([
    { id, parentId: null, name: "Read only", effectivePermission: "view" },
    { id: file, parentId: null, name: "Delivery", effectivePermission: "upload" },
  ]);
  expect(
    (await fetchDeliveryFolders("crew", new AbortController().signal)).map((f) => f.id)
  ).toEqual([file]);
  vi.mocked(api.get).mockRejectedValue(new Error("Forbidden"));
  await expect(fetchDeliveryFolders("crew", new AbortController().signal)).rejects.toThrow(
    "Forbidden"
  );
});
it("validates a new submission's account, task, files and note before accepting success", async () => {
  const submission = {
    id,
    versionNumber: 1,
    submittedByUserId: "1",
    note: "Done",
    professionalDelivery: null,
    canvasVersionId: null,
    productionVersionId: null,
    reviewNote: null,
    reviewedByUserId: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: "2026-09-29T00:00:00Z",
    assets: [
      { id: file, name: "Final.mp4", mediaAssetId: null, contentType: "video/mp4", sizeBytes: 100 },
    ],
  };
  const result = { ...task, status: "submitted", submissions: [submission] };
  const value = { note: " Done ", assetNodeIds: [file], deliveryFolderId: id };
  vi.mocked(api.post).mockResolvedValue(result);
  await submitTask(task, "1", value, null);
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/submissions`, {
    service: "aurora",
    data: { ...value, note: "Done" },
  });
  for (const invalid of [
    { ...result, crewId: "other" },
    { ...result, status: "open" },
    { ...result, submissions: [{ ...submission, submittedByUserId: "2" }] },
    { ...result, submissions: [{ ...submission, note: "other" }] },
    { ...result, submissions: [{ ...submission, assets: [] }] },
  ]) {
    vi.mocked(api.post).mockResolvedValue(invalid);
    await expect(submitTask(task, "1", value, null)).rejects.toThrow("acknowledgement mismatch");
  }
  vi.mocked(api.post).mockResolvedValue(result);
  await expect(
    submitTask({ ...task, submissions: [submission] }, "1", value, null)
  ).rejects.toThrow("acknowledgement mismatch");
});

it("requires the returned professional delivery revision and answers to match", async () => {
  const delivery = { ...template, answers: { description: "Final cut", video: [file] } };
  const submission = {
    id,
    versionNumber: 1,
    submittedByUserId: "1",
    note: "Done",
    professionalDelivery: delivery,
    canvasVersionId: null,
    productionVersionId: null,
    reviewNote: null,
    reviewedByUserId: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: "2026-09-29T00:00:00Z",
    assets: [
      { id: file, name: "Final.mp4", mediaAssetId: null, contentType: "video/mp4", sizeBytes: 100 },
    ],
  };
  vi.mocked(api.post).mockResolvedValue({
    ...task,
    status: "submitted",
    submissions: [submission],
  });
  await submitTask(task, "1", input, template);
  for (const professionalDelivery of [
    null,
    { ...delivery, version: 1 },
    { ...delivery, answers: { ...delivery.answers, video: [] } },
  ]) {
    vi.mocked(api.post).mockResolvedValue({
      ...task,
      status: "submitted",
      submissions: [{ ...submission, professionalDelivery }],
    });
    await expect(submitTask(task, "1", input, template)).rejects.toThrow(
      "acknowledgement mismatch"
    );
  }
});
