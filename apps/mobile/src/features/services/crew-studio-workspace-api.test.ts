import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchCrewStudioWorkspace,
  initializeCrewStudioWorkspace,
  linkCrewStudioWorkspace,
  type CrewStudioWorkspaceState,
} from "./crew-studio-workspace-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const workspace = { id: "00000000-0000-4000-8000-000000000001", name: "Studio" };
const snapshot = (): CrewStudioWorkspaceState => ({
  crewId: "crew",
  workspace: null,
  legacyProject: null,
  options: [workspace],
});
const overview = () => ({
  page: { crewId: "crew" },
  studioWorkspace: null,
  studioProject: null,
  capabilities: { linkWorkspace: true },
});
const read = () => fetchCrewStudioWorkspace("crew", "1", 1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/members/me")
      ? { userId: "1" }
      : path.endsWith("/production-overview")
        ? overview()
        : [workspace]
  );
  vi.mocked(api.patch).mockResolvedValue({ studioWorkspace: workspace });
  vi.mocked(api.post).mockResolvedValue({ studioWorkspace: workspace, created: true });
});
it("loads the current link and server-filtered eligible options", async () => {
  expect(await read()).toEqual(snapshot());
  expect(api.get).toHaveBeenCalledTimes(3);
});
it("blocks mismatched membership before requesting options", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "2" });
  await expect(read()).rejects.toThrow("account mismatch");
  expect(api.get).toHaveBeenCalledOnce();
});
it.each(["scope", "permission"])("rejects invalid overview %s", async (mode) => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1" })
    .mockResolvedValueOnce({
      ...overview(),
      ...(mode === "scope"
        ? { page: { crewId: "other" } }
        : { capabilities: { linkWorkspace: false } }),
    });
  await expect(read()).rejects.toThrow();
  expect(api.get).toHaveBeenCalledTimes(2);
});
it("rejects duplicate workspace options", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1" })
    .mockResolvedValueOnce(overview())
    .mockResolvedValueOnce([workspace, workspace]);
  await expect(read()).rejects.toThrow("Duplicate");
});
it("ignores a response after an account switch", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation = 2;
    return { userId: "1" };
  });
  await expect(read()).rejects.toThrow("session");
});
it("does not read after cancellation", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchCrewStudioWorkspace("crew", "1", 1, c.signal)).rejects.toThrow("cancelled");
  expect(api.get).not.toHaveBeenCalled();
});
it("links only an option still present in a fresh read", async () => {
  await linkCrewStudioWorkspace(snapshot(), "1", 1, workspace.id);
  expect(api.patch).toHaveBeenCalledWith("/crews/crew/studio-workspace", {
    service: "aurora",
    data: { workspaceId: workspace.id },
  });
});
it("rejects a workspace no longer eligible", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1" })
    .mockResolvedValueOnce(overview())
    .mockResolvedValueOnce([]);
  await expect(linkCrewStudioWorkspace(snapshot(), "1", 1, workspace.id)).rejects.toThrow(
    "no longer available"
  );
  expect(api.patch).not.toHaveBeenCalled();
});
it.each(["workspace", "legacy"])("rejects observed concurrent %s link changes", async (mode) => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1" })
    .mockResolvedValueOnce({
      ...overview(),
      ...(mode === "workspace"
        ? { studioWorkspace: workspace }
        : { studioProject: { ...workspace, workspace } }),
    });
  await expect(linkCrewStudioWorkspace(snapshot(), "1", 1, workspace.id)).rejects.toThrow(
    "link changed"
  );
  expect(api.patch).not.toHaveBeenCalled();
});
it("unlinks with an explicit null and verifies null receipt", async () => {
  vi.mocked(api.patch).mockResolvedValue({ studioWorkspace: null });
  await expect(linkCrewStudioWorkspace(snapshot(), "1", 1, null)).resolves.toBeNull();
  expect(api.patch).toHaveBeenCalledWith(expect.any(String), {
    service: "aurora",
    data: { workspaceId: null },
  });
});
it("rejects an incorrect link receipt", async () => {
  vi.mocked(api.patch).mockResolvedValue({ studioWorkspace: null });
  await expect(linkCrewStudioWorkspace(snapshot(), "1", 1, workspace.id)).rejects.toThrow(
    "verified"
  );
});
it.each([true, false])("accepts server initialization receipt created=%s", async (created) => {
  vi.mocked(api.post).mockResolvedValue({ studioWorkspace: workspace, created });
  expect(await initializeCrewStudioWorkspace(snapshot(), "1", 1)).toEqual({
    studioWorkspace: workspace,
    created,
  });
  expect(api.post).toHaveBeenCalledOnce();
});
it.each(["workspace", "legacy"])("does not initialize over an existing %s link", async (mode) => {
  const state = snapshot();
  if (mode === "workspace") state.workspace = workspace;
  else state.legacyProject = { ...workspace, workspace };
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1" })
    .mockResolvedValueOnce({
      ...overview(),
      studioWorkspace: state.workspace,
      studioProject: state.legacyProject,
    });
  await expect(initializeCrewStudioWorkspace(state, "1", 1)).rejects.toThrow(
    "existing Studio link"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("propagates exclusive-link conflict without retry", async () => {
  vi.mocked(api.patch).mockRejectedValue(
    new Error("This workspace is already linked to another Crew.")
  );
  await expect(linkCrewStudioWorkspace(snapshot(), "1", 1, workspace.id)).rejects.toThrow(
    "another Crew"
  );
  expect(api.patch).toHaveBeenCalledOnce();
});
it("does not accept mutation receipts from a replaced account", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return { studioWorkspace: workspace, created: true };
  });
  await expect(initializeCrewStudioWorkspace(snapshot(), "1", 1)).rejects.toThrow("session");
});
