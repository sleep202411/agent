import { beforeEach, it, expect, vi } from "vitest";
import { api } from "@/lib/api-client";
import type { CustomField } from "./task-custom-fields-api";
import { normalizeCustomValue, updateCustomField } from "./task-custom-field-edit-api";
vi.mock("@/lib/api-client", () => ({ api: { patch: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const detail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Render",
  submissions: [],
  version: 1,
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  status: "submitted",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: "2026-10-01T00:00:00Z",
  labels: [],
  assignees: [],
};

const field: CustomField = {
  id,
  crewId: "crew",
  name: "Department",
  required: false,
  type: "single_select",
  options: [{ id: "art", label: "Art" }],
};

const task = { ...detail, status: "open" };
beforeEach(() => vi.resetAllMocks());
it("normalizes all seven types and explicit clearing", () => {
  const cases: [CustomField["type"], Parameters<typeof normalizeCustomValue>[1], unknown][] = [
    ["text", "  Brief  ", "Brief"],
    ["number", "0", 0],
    ["number", "-1.25", -1.25],
    ["date", "2024-02-29", "2024-02-29"],
    ["checkbox", false, false],
    ["single_select", "art", "art"],
    ["multi_select", ["art"], ["art"]],
    ["user", "123", "123"],
    ["text", " ", null],
    ["multi_select", [], null],
  ];
  for (const [type, draft, value] of cases)
    expect(normalizeCustomValue({ ...field, type }, draft)).toEqual(value);
});
it("rejects malformed, unknown, repeated and missing required values", () => {
  for (const [type, draft] of [
    ["number", "NaN"],
    ["number", true],
    ["date", "2026-02-30"],
    ["date", "today"],
    ["checkbox", "true"],
    ["single_select", "old"],
    ["multi_select", ["art", "art"]],
    ["multi_select", ["old"]],
    ["text", "x".repeat(4001)],
  ] as const)
    expect(() =>
      normalizeCustomValue({ ...field, type }, typeof draft === "object" ? [...draft] : draft)
    ).toThrow();
  for (const type of [
    "text",
    "number",
    "checkbox",
    "date",
    "single_select",
    "multi_select",
    "user",
  ] as const)
    expect(() => normalizeCustomValue({ ...field, type, required: true }, null)).toThrow(
      "required"
    );
});
it("patches only one field with the expected task version", async () => {
  const result = { ...task, version: 2, customFieldValues: [{ fieldId: id, value: "art" }] };
  vi.mocked(api.patch).mockResolvedValue(result);
  await updateCustomField(task, field, "art");
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/crew-tasks/${id}`, {
    service: "aurora",
    data: { expectedVersion: 1, customFieldValues: [{ fieldId: id, value: "art" }] },
  });
});
it("accepts sparse removal and rejects stale, scoped or incorrect acknowledgements", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...task, version: 2, customFieldValues: [] });
  await updateCustomField(task, field, null);
  for (const change of [
    { version: 1 },
    { crewId: "wrong" },
    { customFieldValues: [] },
    { customFieldValues: [{ fieldId: id, value: "wrong" }] },
    {
      customFieldValues: [
        { fieldId: id, value: "art" },
        { fieldId: id, value: "art" },
      ],
    },
  ]) {
    vi.mocked(api.patch).mockResolvedValue({
      ...task,
      version: 2,
      customFieldValues: [{ fieldId: id, value: "art" }],
      ...change,
    });
    await expect(updateCustomField(task, field, "art")).rejects.toThrow("acknowledgement");
  }
});
it("rejects closed or foreign tasks before writing", async () => {
  for (const status of ["approved", "cancelled"])
    await expect(updateCustomField({ ...task, status }, field, "art")).rejects.toThrow();
  await expect(updateCustomField(task, { ...field, crewId: "other" }, "art")).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
});
