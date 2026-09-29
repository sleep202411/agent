import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskCustomFields, customFieldText, type CustomField } from "./task-custom-fields-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
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
  type: "single_select",
  options: [{ id: "art", label: "Art" }],
};
const labels = { unset: "Unset", yes: "Yes", no: "No" };
beforeEach(() => vi.resetAllMocks());
it("loads ordered definitions and sparse values with scoped, versioned task data", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ fields: [field] })
    .mockResolvedValueOnce({ ...detail, customFieldValues: [{ fieldId: id, value: "art" }] });
  const signal = new AbortController().signal;
  expect(await fetchTaskCustomFields(detail, signal)).toEqual([{ field, value: "art" }]);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/task-project", { service: "aurora", signal });
});
it("rejects cross-Crew, stale and ambiguous field data", async () => {
  for (const change of [
    { version: 2 },
    { crewId: "other" },
    {
      customFieldValues: [
        { fieldId: id, value: 1 },
        { fieldId: id, value: 2 },
      ],
    },
  ]) {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ fields: [field] })
      .mockResolvedValueOnce({ ...detail, customFieldValues: [], ...change });
    await expect(fetchTaskCustomFields(detail, new AbortController().signal)).rejects.toThrow();
  }
  for (const fields of [
    [{ ...field, crewId: "other" }],
    [field, field],
    [{ ...field, options: [...field.options, ...field.options] }],
  ]) {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ fields })
      .mockResolvedValueOnce({ ...detail, customFieldValues: [] });
    await expect(fetchTaskCustomFields(detail, new AbortController().signal)).rejects.toThrow();
  }
});
it("formats every supported type without confusing false, zero, or missing values", () => {
  const cases: [CustomField["type"], Parameters<typeof customFieldText>[1], string][] = [
    ["text", "Brief", "Brief"],
    ["number", 0, "0"],
    ["date", "2026-09-29", "2026-09-29"],
    ["checkbox", false, "No"],
    ["checkbox", true, "Yes"],
    ["single_select", "art", "Art"],
    ["multi_select", ["art", "legacy"], "Art, legacy"],
    ["user", "1", "Artist"],
    ["text", null, "Unset"],
    ["checkbox", undefined, "Unset"],
  ];
  for (const [type, value, expected] of cases)
    expect(
      customFieldText({ ...field, type }, value, labels, new Map([["1", { nickname: "Artist" }]]))
    ).toBe(expected);
});
