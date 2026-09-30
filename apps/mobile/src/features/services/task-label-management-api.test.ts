import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createTaskLabel,
  deleteTaskLabel,
  fetchManagedLabels,
  managedLabel,
  taskLabelInput,
  updateTaskLabel,
} from "./task-label-management-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const label = () =>
  managedLabel.parse({
    id: uid(1),
    crewId: "crew",
    name: "Art",
    color: "#aabbcc",
    description: "Assets",
    updatedAt: "2026-09-30T00:00:00.000Z",
  });
const input = { name: " Next ", description: " Work ", color: "#AABBCC" };
const read = () => fetchManagedLabels("crew", "1", 1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  vi.mocked(api.get).mockResolvedValue({ labels: [label()] });
  vi.mocked(api.post).mockResolvedValue({ ...label(), id: uid(2), ...taskLabelInput.parse(input) });
  vi.mocked(api.patch).mockImplementation(async (_path, options) => ({
    ...label(),
    ...(options?.data as object),
    updatedAt: "2026-09-30T00:00:01.000Z",
  }));
  vi.mocked(api.delete).mockResolvedValue(undefined);
});
it("lists scoped labels and preserves server order", async () => {
  expect(await read()).toEqual([label()]);
  expect(h.access).toHaveBeenCalledWith("crew", "1", expect.any(AbortSignal));
});
it.each(["foreign", "duplicate"])("rejects %s label rows", async (mode) => {
  vi.mocked(api.get).mockResolvedValue({
    labels: mode === "foreign" ? [{ ...label(), crewId: "other" }] : [label(), label()],
  });
  await expect(read()).rejects.toThrow("scope mismatch");
});
it("denies management before reading or writing", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await expect(createTaskLabel("crew", "1", 1, input)).rejects.toThrow("permission");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("trims inputs and normalizes color before creation", async () => {
  await createTaskLabel("crew", "1", 1, input);
  expect(api.post).toHaveBeenCalledWith("/crews/crew/task-labels", {
    service: "aurora",
    data: { name: "Next", description: "Work", color: "#aabbcc" },
  });
});
it("rejects an existing label name before creation", async () => {
  await expect(createTaskLabel("crew", "1", 1, { ...input, name: "Art" })).rejects.toThrow(
    "already exists"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["scope", "id", "name", "color", "description"])(
  "rejects incorrect create receipt %s",
  async (mode) => {
    const receipt = { ...label(), id: uid(2), ...taskLabelInput.parse(input) };
    if (mode === "scope") receipt.crewId = "other";
    else if (mode === "id") receipt.id = uid(1);
    else receipt[mode as "name" | "color" | "description"] = mode === "color" ? "#000000" : "Other";
    vi.mocked(api.post).mockResolvedValue(receipt);
    await expect(createTaskLabel("crew", "1", 1, input)).rejects.toThrow("could not be verified");
  }
);
it("uses a captured timestamp and sends only changed edit fields", async () => {
  await updateTaskLabel(label(), "1", 1, { name: "Next", description: "Assets", color: "#AABBCC" });
  expect(api.patch).toHaveBeenCalledWith(`/crew-task-labels/${uid(1)}`, {
    service: "aurora",
    data: { name: "Next", expectedUpdatedAt: label().updatedAt },
  });
});
it("skips no-op edits", async () => {
  await updateTaskLabel(label(), "1", 1, {
    name: " Art ",
    description: "Assets",
    color: "#AABBCC",
  });
  expect(api.patch).not.toHaveBeenCalled();
  expect(h.access).not.toHaveBeenCalled();
});
it.each(["scope", "version", "settings"])("rejects incorrect update receipt %s", async (mode) => {
  const receipt = { ...label(), name: "Next", updatedAt: "2026-09-30T00:00:01.000Z" };
  if (mode === "scope") receipt.crewId = "other";
  if (mode === "version") receipt.updatedAt = label().updatedAt;
  if (mode === "settings") receipt.name = "Other";
  vi.mocked(api.patch).mockResolvedValue(receipt);
  await expect(
    updateTaskLabel(label(), "1", 1, { name: "Next", description: "Assets", color: "#aabbcc" })
  ).rejects.toThrow("could not be verified");
});
it("deletes only the label after fresh authorization and snapshot comparison", async () => {
  await deleteTaskLabel(label(), "1", 1);
  expect(api.delete).toHaveBeenCalledExactlyOnceWith(`/crew-task-labels/${uid(1)}`, {
    service: "aurora",
  });
});
it.each(["missing", "version", "settings"])("blocks deleting %s labels", async (mode) => {
  const fresh = label();
  if (mode === "version") fresh.updatedAt = "2026-09-30T00:00:01.000Z";
  if (mode === "settings") fresh.name = "Other";
  vi.mocked(api.get).mockResolvedValue({ labels: mode === "missing" ? [] : [fresh] });
  await expect(deleteTaskLabel(label(), "1", 1)).rejects.toThrow("changed");
  expect(api.delete).not.toHaveBeenCalled();
});
it("does not retry uncertain creation or interpret deletion 404 as success", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await expect(createTaskLabel("crew", "1", 1, input)).rejects.toThrow("Connection lost");
  expect(api.post).toHaveBeenCalledOnce();
  vi.mocked(api.delete).mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
  await expect(deleteTaskLabel(label(), "1", 1)).rejects.toThrow("Not found");
  expect(api.delete).toHaveBeenCalledOnce();
});
it("blocks account changes during authorization and ignores write completion", async () => {
  h.access.mockImplementation(async () => {
    h.generation++;
    return { canManage: true };
  });
  await expect(createTaskLabel("crew", "1", 1, input)).rejects.toThrow("expired");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  vi.mocked(api.delete).mockImplementation(async () => {
    h.generation++;
  });
  await expect(deleteTaskLabel(label(), "1", 1)).rejects.toThrow("expired");
});
it.each([
  { name: "" },
  { name: "x".repeat(65) },
  { color: "red" },
  { color: "#fff" },
  { description: "x".repeat(241) },
])("rejects invalid input %j before writes", async (change) => {
  await expect(createTaskLabel("crew", "1", 1, { ...input, ...change })).rejects.toThrow();
  expect(h.access).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects invalid Crew scope and cancelled reads", async () => {
  await expect(
    fetchManagedLabels("../crew", "1", 1, new AbortController().signal)
  ).rejects.toThrow();
  expect(h.access).not.toHaveBeenCalled();
  const c = new AbortController();
  c.abort();
  await expect(fetchManagedLabels("crew", "1", 1, c.signal)).rejects.toThrow("cancelled");
  expect(api.get).not.toHaveBeenCalled();
});
