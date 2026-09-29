import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskCommitments, setTaskCommitment, closeTaskHandover } from "./task-commitment-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const record = {
  id,
  taskId: id,
  assignmentId: id,
  userId: "1",
  status: "accepted",
  promisedDueAt: "2026-10-01T00:00:00Z",
  acceptedAt: "2026-09-29T00:00:00Z",
  reason: "",
  releasedAt: null,
  handoverNote: null,
  currentAssignment: true,
  overdue: false,
  deadlineChanged: false,
};
beforeEach(() => vi.resetAllMocks());
it("loads task-scoped records with cancellation and rejects foreign records", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue({ records: [record] });
  expect(await fetchTaskCommitments(id, signal)).toEqual([record]);
  expect(api.get).toHaveBeenCalledWith(`/crew-tasks/${id}/commitments`, {
    service: "aurora",
    signal,
  });
  vi.mocked(api.get).mockResolvedValue({ records: [{ ...record, taskId: other }] });
  await expect(fetchTaskCommitments(id, signal)).rejects.toThrow("scope mismatch");
});
it("sends the task version, validates reasons and requires the caller's updated commitment", async () => {
  vi.mocked(api.post).mockResolvedValue({ records: [record] });
  await setTaskCommitment(id, "1", { expectedVersion: 4, action: "accept", reason: "" });
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/commitments`, {
    service: "aurora",
    data: { expectedVersion: 4, action: "accept", reason: "" },
  });
  await expect(
    setTaskCommitment(id, "1", { expectedVersion: 4, action: "at_risk", reason: "x" })
  ).rejects.toThrow();
  await expect(
    setTaskCommitment(id, "2", { expectedVersion: 4, action: "accept", reason: "" })
  ).rejects.toThrow("acknowledgement mismatch");
  vi.mocked(api.post).mockResolvedValue({
    records: [{ ...record, status: "withdrawn", reason: "Need replacement" }],
  });
  await setTaskCommitment(id, "1", {
    expectedVersion: 4,
    action: "withdraw",
    reason: " Need replacement ",
  });
});
it("checks handover identity, closure and note without accepting unrelated success", async () => {
  vi.mocked(api.post).mockResolvedValue({
    ...record,
    releasedAt: record.acceptedAt,
    handoverNote: "Files transferred",
  });
  await closeTaskHandover(id, id, " Files transferred ");
  expect(api.post).toHaveBeenCalledWith(`/crew-commitments/${id}/handover`, {
    service: "aurora",
    data: { note: "Files transferred" },
  });
  vi.mocked(api.post).mockResolvedValue(record);
  await expect(closeTaskHandover(id, id, "Files transferred")).rejects.toThrow(
    "acknowledgement mismatch"
  );
  await expect(closeTaskHandover(id, id, " ")).rejects.toThrow();
});
