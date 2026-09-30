import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskChildContext } from "./task-child-context";
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

const other = "22222222-2222-4222-8222-222222222222";
const workflow = { id, crewId: "crew", name: "Open", semantic: "open" as const, archived: false };
const snapshot = { ...detail, status: "open", workflowStateId: id, workflowState: workflow };

beforeEach(() => vi.resetAllMocks());
it("prefills the current parent and a valid manual workflow", async () => {
  vi.mocked(api.get).mockResolvedValue(snapshot);
  const signal = new AbortController().signal;
  expect(await fetchTaskChildContext(snapshot, signal)).toEqual({ parent: snapshot, workflow });
  expect(api.get).toHaveBeenCalledWith(`/crew-tasks/${id}`, { service: "aurora", signal });
});
it("uses the normal creation default for submitted or archived parent columns", async () => {
  for (const change of [
    { status: "submitted", workflowState: { ...workflow, semantic: "submitted" } },
    { workflowState: { ...workflow, archived: true } },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...snapshot, ...change });
    expect(
      (await fetchTaskChildContext(snapshot, new AbortController().signal)).workflow
    ).toBeUndefined();
  }
});
it("rejects stale, cross-Crew, closed and inconsistent parent snapshots", async () => {
  for (const change of [
    { version: 2 },
    { crewId: "other" },
    { id: other },
    { workflowStateId: other },
    ...(["approved", "cancelled"] as const).map((status) => ({
      status,
      workflowState: { ...workflow, semantic: status },
    })),
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...snapshot, ...change });
    await expect(fetchTaskChildContext(snapshot, new AbortController().signal)).rejects.toThrow();
  }
});
