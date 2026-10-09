import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchManualTaskWorkflows } from "./task-workflow-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const state = { id, crewId: "crew", name: "To Do", semantic: "open", archived: false };
beforeEach(() => vi.resetAllMocks());
it("loads Crew workflow columns and allows only manual creation states", async () => {
  const signal = new AbortController().signal;
  for (const semantic of [
    "open",
    "in_progress",
    "revision_requested",
    "submitted",
    "approved",
    "cancelled",
  ]) {
    vi.mocked(api.get).mockResolvedValue({ workflowStates: [{ ...state, semantic }] });
    const result = await fetchManualTaskWorkflows("crew", signal);
    expect(result.length).toBe(
      ["open", "in_progress", "revision_requested"].includes(semantic) ? 1 : 0
    );
  }
  expect(api.get).toHaveBeenCalledWith("/crews/crew/task-project", { service: "aurora", signal });
  vi.mocked(api.get).mockResolvedValue({ workflowStates: [{ ...state, archived: true }] });
  expect(await fetchManualTaskWorkflows("crew", signal)).toEqual([]);
});
it("rejects wrong-Crew, duplicate and malformed workflow data", async () => {
  for (const workflowStates of [
    [{ ...state, crewId: "other" }],
    [state, state],
    [{ ...state, archived: undefined }],
    [{ ...state, semantic: "unknown" }],
  ]) {
    vi.mocked(api.get).mockResolvedValue({ workflowStates });
    await expect(fetchManualTaskWorkflows("crew", new AbortController().signal)).rejects.toThrow();
  }
});
it("surfaces upstream failures without defaulting to an invented column", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Forbidden"));
  await expect(fetchManualTaskWorkflows("crew", new AbortController().signal)).rejects.toThrow(
    "Forbidden"
  );
});
