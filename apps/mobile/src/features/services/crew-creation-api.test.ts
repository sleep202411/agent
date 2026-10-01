import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { loadAgentProjects } from "@/features/agent/api/studio-projects-api";
import {
  createMobileCrew,
  crewCreationInput,
  crewCreationPending,
  fetchCrewCreationCanvas,
  fetchCrewCreationEligibility,
  fetchCrewsForCreationReview,
} from "./crew-creation-api";
const h = vi.hoisted(() => ({
  generation: 1,
  records: new Map<string, string>(),
  failStorage: false,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({ loadAgentProjects: vi.fn() }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, identity: string) => ({
    read: () => h.records.get(`${namespace}:${user}:${identity}`) ?? null,
    write: (value: string) => {
      if (h.failStorage) throw new Error("Storage unavailable");
      h.records.set(`${namespace}:${user}:${identity}`, value);
    },
  }),
}));
const workspace = { id: "11111111-1111-4111-8111-111111111111", name: "Studio" };
const projectId = "22222222-2222-4222-8222-222222222222";
const input = () => ({
  name: "Crew",
  description: "A production",
  logo: "logo.png",
  productionTemplateLocale: "en-US" as const,
  productionKind: "series" as const,
  studioWorkspaceId: workspace.id,
});
const response = () => ({ ...input(), id: "crew", ownerUserId: "user" });
const tree = () => ({
  title: "Story",
  description: "",
  startNodeId: "start",
  nodes: [
    { id: "start", type: "scene", content: {}, transitions: [{ to: "end", label: "Continue" }] },
    { id: "end", type: "ending", content: {}, transitions: [] },
  ],
});
const canvas = () => ({
  projectId,
  title: "Story",
  plotTree: tree(),
  storyboardClipsByNode: {
    start: [{ clipId: "clip", title: "Shot", order: 0, durationSeconds: 2 }],
  },
});
const signal = () => new AbortController().signal;
const create = () => createMobileCrew(input(), "user", 1, signal());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.failStorage = false;
  vi.mocked(api.get).mockResolvedValue({ eligible: true, workspaces: [workspace] });
  vi.mocked(api.post).mockResolvedValue(response());
  vi.mocked(loadAgentProjects).mockResolvedValue({
    workspaceId: workspace.id,
    projects: [{ id: projectId, workspaceId: workspace.id, title: "Story" }],
  });
});
it("reads fresh eligibility without retrying and rejects duplicate workspace options", async () => {
  await expect(fetchCrewCreationEligibility(1, signal())).resolves.toEqual({
    eligible: true,
    workspaces: [workspace],
  });
  expect(api.get).toHaveBeenCalledWith(
    "/crews/creation-eligibility",
    expect.objectContaining({ retry: false })
  );
  vi.mocked(api.get).mockResolvedValue({ eligible: true, workspaces: [workspace, workspace] });
  await expect(fetchCrewCreationEligibility(1, signal())).rejects.toThrow("Duplicate");
});
it.each(["ineligible", "removed"])("prevents creation when access is %s", async (mode) => {
  vi.mocked(api.get).mockResolvedValue({ eligible: mode !== "ineligible", workspaces: [] });
  await expect(create()).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
  expect(crewCreationPending("user", 1).read()).toBeNull();
});
it("persists the exact request before POST and keeps a verified receipt for navigation recovery", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    expect(crewCreationPending("user", 1).read()?.input).toEqual(input());
    return response();
  });
  expect(await create()).toMatchObject({ id: "crew" });
  expect(crewCreationPending("user", 1).read()?.receipt?.id).toBe("crew");
  expect(api.post).toHaveBeenCalledWith(
    "/crews",
    expect.objectContaining({ data: input(), retry: false })
  );
  await expect(create()).rejects.toThrow("previous");
  expect(api.post).toHaveBeenCalledOnce();
});
it("supports a new workspace without guessing its server-generated identity", async () => {
  const { studioWorkspaceId: _, ...base } = input();
  expect(
    await createMobileCrew(
      { ...base, createStudioWorkspace: { name: "New Studio" } },
      "user",
      1,
      signal()
    )
  ).toMatchObject({ studioWorkspaceId: workspace.id });
});
it("blocks POST when durable storage cannot preserve the request", async () => {
  h.failStorage = true;
  await expect(create()).rejects.toThrow("Storage");
  expect(api.post).not.toHaveBeenCalled();
});
it("retains lost-response attempts and never automatically retries or infers success", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await expect(create()).rejects.toThrow("Connection lost");
  expect(crewCreationPending("user", 1).read()).toMatchObject({ input: input() });
  expect(crewCreationPending("user", 1).read()?.receipt).toBeUndefined();
  await expect(create()).rejects.toThrow("previous");
  expect(api.post).toHaveBeenCalledOnce();
});
it.each(["ownerUserId", "name", "description", "logo", "productionKind", "studioWorkspaceId"])(
  "rejects a mismatched %s receipt without clearing the attempt",
  async (field) => {
    vi.mocked(api.post).mockResolvedValue({
      ...response(),
      [field]:
        field === "studioWorkspaceId"
          ? projectId
          : field === "productionKind"
            ? "interactive_film"
            : "different",
    });
    await expect(create()).rejects.toThrow("verified");
    expect(crewCreationPending("user", 1).read()?.receipt).toBeUndefined();
  }
);
it("clears only the selected account's reviewed attempt", async () => {
  await create();
  expect(crewCreationPending("other", 1).read()).toBeNull();
  crewCreationPending("user", 1).clear();
  expect(crewCreationPending("user", 1).read()).toBeNull();
});
it("rejects an account change after eligibility before POST", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation = 2;
    return { eligible: true, workspaces: [workspace] };
  });
  await expect(create()).rejects.toThrow("session");
  expect(api.post).not.toHaveBeenCalled();
});
it("does not apply another account's mutation result", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return response();
  });
  await expect(create()).rejects.toThrow("session");
  h.generation = 1;
  expect(crewCreationPending("user", 1).read()?.receipt).toBeUndefined();
});
it("does not read or mutate after cancellation", async () => {
  const c = new AbortController();
  c.abort();
  await expect(createMobileCrew(input(), "user", 1, c.signal)).rejects.toThrow("cancelled");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("exports only a project in the selected workspace and checks the response identity", async () => {
  vi.mocked(api.get).mockResolvedValue(canvas());
  expect(await fetchCrewCreationCanvas(workspace.id, projectId, 1, signal())).toEqual(canvas());
  vi.mocked(api.get).mockResolvedValue({ ...canvas(), projectId: workspace.id });
  await expect(fetchCrewCreationCanvas(workspace.id, projectId, 1, signal())).rejects.toThrow(
    "scope"
  );
});
it.each(["workspace", "missing"])("rejects %s project scope before exporting", async (mode) => {
  vi.mocked(loadAgentProjects).mockResolvedValue({
    workspaceId: mode === "workspace" ? projectId : workspace.id,
    projects: [],
  });
  await expect(fetchCrewCreationCanvas(workspace.id, projectId, 1, signal())).rejects.toThrow(
    "available"
  );
  expect(api.get).not.toHaveBeenCalled();
});
it.each([
  "none",
  "both",
  "seriesCanvas",
  "unknownNode",
  "unreachable",
  "duplicate",
  "missingEnd",
  "badTransition",
])("rejects invalid creation input: %s", (mode) => {
  const value: Record<string, unknown> = { ...input() };
  if (mode === "none") delete value.studioWorkspaceId;
  else if (mode === "both") value.createStudioWorkspace = { name: "Another" };
  else {
    const plot = tree();
    value.plotTree = plot;
    value.productionKind = mode === "seriesCanvas" ? "series" : "interactive_film";
    if (mode === "unknownNode") value.storyboardClipsByNode = { unknown: [] };
    if (mode === "unreachable")
      plot.nodes.push({ id: "orphan", type: "ending", content: {}, transitions: [] });
    if (mode === "duplicate") plot.nodes.push(plot.nodes[1]);
    if (mode === "missingEnd") plot.nodes.pop();
    if (mode === "badTransition") plot.nodes[0].transitions[0].to = "missing";
  }
  expect(crewCreationInput.safeParse(value).success).toBe(false);
});
it("preserves reviewed interactive canvas content and clip metadata", () => {
  const data = crewCreationInput.parse({
    ...input(),
    productionKind: "interactive_film",
    plotTree: tree(),
    storyboardClipsByNode: canvas().storyboardClipsByNode,
  });
  expect(data.plotTree).toEqual(tree());
  expect(data.storyboardClipsByNode).toEqual(canvas().storyboardClipsByNode);
});

it("admits only one POST when confirmations race during the eligibility read", async () => {
  const results = await Promise.allSettled([create(), create()]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(api.post).toHaveBeenCalledOnce();
});

it("retains an unresolved request if cancelled after the server accepted it", async () => {
  const controller = new AbortController();
  vi.mocked(api.post).mockImplementation(async () => {
    controller.abort();
    return response();
  });
  await expect(createMobileCrew(input(), "user", 1, controller.signal)).rejects.toThrow(
    "cancelled"
  );
  expect(crewCreationPending("user", 1).read()?.receipt).toBeUndefined();
  await expect(create()).rejects.toThrow("previous");
  expect(api.post).toHaveBeenCalledOnce();
});

it("does not silently discard a corrupt saved attempt and send another creation", async () => {
  h.records.set("crew-creation:user:create", "{broken");
  await expect(create()).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

it("reads the current owner directory with legacy unlinked Crews and never suppresses network errors", async () => {
  const row = { ...response(), studioWorkspaceId: null, createdAt: "2026-10-01T00:00:00Z" };
  vi.mocked(api.get).mockResolvedValue({ founded: [row], joined: [] });
  expect(await fetchCrewsForCreationReview("user", 1, signal())).toMatchObject([
    { id: "crew", ownerUserId: "user", studioWorkspaceId: null, createdAt: row.createdAt },
  ]);
  expect(api.get).toHaveBeenCalledWith("/crews/my", expect.objectContaining({ retry: false }));
  vi.mocked(api.get).mockRejectedValue(new Error("Directory unavailable"));
  await expect(fetchCrewsForCreationReview("user", 1, signal())).rejects.toThrow(
    "Directory unavailable"
  );
});
it.each(["owner", "duplicate"])("rejects %s mismatches in the recovery directory", async (mode) => {
  const row = { ...response(), createdAt: "2026-10-01T00:00:00Z" };
  vi.mocked(api.get).mockResolvedValue({
    founded: mode === "owner" ? [{ ...row, ownerUserId: "other" }] : [row, row],
  });
  await expect(fetchCrewsForCreationReview("user", 1, signal())).rejects.toThrow("verified");
});
