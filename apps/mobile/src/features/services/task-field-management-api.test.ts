import { beforeEach, it, expect, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
  fetchManagedFields,
  fieldOptionsFromLabels,
  type ManagedField,
} from "./task-field-management-api";
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const input = {
  name: "Department",
  description: "Team",
  type: "single_select" as const,
  required: false,
  options: [{ id: other, label: "Art", color: "#123456" }],
};
const field: ManagedField = { ...input, id, crewId: "crew", updatedAt: "2026-09-29T00:00:00.000Z" };
beforeEach(() => vi.resetAllMocks());
it("reads ordered definitions with timestamps, rejecting foreign or duplicated records", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue({ fields: [field] });
  expect(await fetchManagedFields("crew", signal)).toEqual([field]);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/task-project", { service: "aurora", signal });
  for (const fields of [
    [field, field],
    [{ ...field, crewId: "other" }],
    [{ ...field, updatedAt: undefined }],
  ]) {
    vi.mocked(api.get).mockResolvedValue({ fields });
    await expect(fetchManagedFields("crew", signal)).rejects.toThrow();
  }
});
it("creates and verifies a definition including option IDs and colors", async () => {
  vi.mocked(api.post).mockResolvedValue(field);
  await expect(createFieldDefinition("crew", input)).resolves.toEqual(field);
  expect(api.post).toHaveBeenCalledExactlyOnceWith("/crews/crew/task-fields", {
    service: "aurora",
    data: input,
  });
  for (const change of [
    { crewId: "other" },
    { required: true },
    { options: [{ id: other, label: "Art" }] },
    { type: "text" },
  ]) {
    vi.mocked(api.post).mockResolvedValue({ ...field, ...change });
    await expect(createFieldDefinition("crew", input)).rejects.toThrow();
  }
});
it("rejects malformed or unsupported field definitions before writes", async () => {
  for (const change of [
    { name: " " },
    { description: "x".repeat(241) },
    { type: "text" as const },
    { options: [input.options[0]!, input.options[0]!] },
    { options: [{ id: "invalid", label: "Art" }] },
  ])
    await expect(createFieldDefinition("crew", { ...input, ...change })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("uses the fetched timestamp and preserves settings omitted from an edit", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...field, name: "New name" });
  await updateFieldDefinition(field, { expectedUpdatedAt: field.updatedAt, name: "New name" });
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/crew-task-fields/${id}`, {
    service: "aurora",
    data: { expectedUpdatedAt: field.updatedAt, name: "New name" },
  });
  vi.mocked(api.patch).mockResolvedValue({ ...field, name: "New name", required: true });
  await expect(
    updateFieldDefinition(field, { expectedUpdatedAt: field.updatedAt, name: "New name" })
  ).rejects.toThrow("acknowledgement");
});
it("rejects stale timestamps and illegal options before edits", async () => {
  await expect(
    updateFieldDefinition(field, { expectedUpdatedAt: "2026-09-28T00:00:00.000Z", name: "New" })
  ).rejects.toThrow();
  await expect(
    updateFieldDefinition(
      { ...field, type: "text", options: [] },
      { expectedUpdatedAt: field.updatedAt, options: input.options }
    )
  ).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
});
it("preserves option identity and color, and creates IDs only for new labels", () => {
  const makeId = vi.fn(() => id);
  expect(fieldOptionsFromLabels("Art, New, Art", field.options, makeId)).toEqual([
    ...field.options,
    { id, label: "New" },
  ]);
  expect(makeId).toHaveBeenCalledOnce();
});
it("surfaces server option-in-use rejection without retries", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Option in use"));
  await expect(
    updateFieldDefinition(field, { expectedUpdatedAt: field.updatedAt, options: [] })
  ).rejects.toThrow("Option in use");
  expect(api.patch).toHaveBeenCalledOnce();
});
it("uses the existing deletion route and propagates failure", async () => {
  vi.mocked(api.delete).mockRejectedValue(new Error("Forbidden"));
  await expect(deleteFieldDefinition(field)).rejects.toThrow("Forbidden");
  expect(api.delete).toHaveBeenCalledExactlyOnceWith(`/crew-task-fields/${id}`, {
    service: "aurora",
  });
});
