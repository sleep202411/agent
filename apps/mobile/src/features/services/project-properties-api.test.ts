import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchProjectProperties,
  updateProjectProperties,
  projectValues,
  valuesOf,
  projectChanges,
} from "./project-properties-api";
const h = vi.hoisted(() => ({ generation: 1, page: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("./crew-members-api", () => ({ fetchCrewMemberPage: h.page }));
const label = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  name: "Art",
  color: "#ff0000",
};
const project = {
  crewId: "crew",
  version: 2,
  status: "planned" as const,
  priority: null,
  leadMemberId: null,
  startDate: null,
  startDateGranularity: "day" as const,
  targetDate: null,
  targetDateGranularity: "day" as const,
};
const data = { project, labels: [], labelOptions: [label], capabilities: { manage: true } };
let permissions: string[];
const read = () => fetchProjectProperties("crew", "actor", 1, new AbortController().signal);
const write = (change: Partial<ReturnType<typeof valuesOf>> = { status: "in_progress" }) =>
  updateProjectProperties("crew", "actor", 1, data, { ...valuesOf(data), ...change });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  permissions = ["production.view", "production.manage", "members.view"];
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me") ? { userId: "actor", permissions } : data
  );
  h.page.mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(api.patch).mockResolvedValue({
    project: { ...project, version: 3, status: "in_progress" },
    labels: [],
  });
});
it("sends only modified properties and captured metadata version", async () => {
  await write();
  expect(api.patch).toHaveBeenCalledWith("/crews/crew/production-overview/properties", {
    service: "aurora",
    data: { status: "in_progress", expectedVersion: 2 },
  });
});
it("loads all lead candidates", async () => {
  h.page
    .mockResolvedValueOnce({ items: [{ id: "a", userId: "a" }], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [{ id: "b", userId: "b" }], nextCursor: null });
  expect((await read()).members).toHaveLength(2);
});
it("can read without directory permission", async () => {
  permissions = ["production.view"];
  const v = await read();
  expect(v.canChooseLead).toBe(false);
  expect(v.capabilities.manage).toBe(false);
  expect(h.page).not.toHaveBeenCalled();
});
it.each([{ value: [] }, { value: ["tasks.manage"] }])(
  "requires production view %j",
  async ({ value }) => {
    permissions = value;
    await expect(read()).rejects.toThrow();
  }
);
it("does not confuse task management with production management", async () => {
  permissions = ["production.view", "tasks.manage"];
  await expect(write()).rejects.toThrow("Production management");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects stale metadata versions", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions }
      : { ...data, project: { ...project, version: 3 } }
  );
  await expect(write()).rejects.toThrow("changed");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects inactive leads", async () => {
  await expect(write({ leadMemberId: "missing" })).rejects.toThrow("active Crew");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects unknown labels", async () => {
  await expect(write({ labelIds: ["22222222-2222-4222-8222-222222222222"] })).rejects.toThrow(
    "label"
  );
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects a roster loop", async () => {
  h.page.mockResolvedValue({ items: [], nextCursor: "same" });
  await expect(read()).rejects.toThrow("advance");
});
it("rejects duplicate members across pages", async () => {
  h.page.mockResolvedValue({ items: [{ id: "a", userId: "a" }], nextCursor: "next" });
  await expect(read()).rejects.toThrow("members changed");
});
it.each([{ crewId: "other" }, { version: 2 }, { status: "planned" }])(
  "rejects wrong receipts %j",
  async (change) => {
    vi.mocked(api.patch).mockResolvedValue({
      project: { ...project, version: 3, status: "in_progress", ...change },
      labels: [],
    });
    await expect(write()).rejects.toThrow();
  }
);
it("rejects account changes during reads", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation++;
    return { userId: "actor", permissions };
  });
  await expect(write()).rejects.toThrow("expired");
  expect(api.patch).not.toHaveBeenCalled();
});
it("does not retry a failed write", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Version conflict"));
  await expect(write()).rejects.toThrow("Version conflict");
  expect(api.patch).toHaveBeenCalledTimes(1);
});
it.each([
  { startDate: "2026-02-30" },
  { startDate: "2026-05-02", startDateGranularity: "month" },
  { startDate: "2026-02-01", startDateGranularity: "quarter" },
  { startDate: "2026-04-01", startDateGranularity: "half_year" },
  { startDate: "2026-07-01", startDateGranularity: "year" },
  { startDate: "2026-06-01", targetDate: "2026-05-31" },
])("rejects invalid dates %j", (change) => {
  expect(projectValues.safeParse({ ...valuesOf(data), ...change }).success).toBe(false);
});
it.each(["month", "quarter", "half_year", "year"] as const)(
  "accepts a target period covering the start: %s",
  (granularity) => {
    expect(
      projectValues.safeParse({
        ...valuesOf(data),
        startDate: "2026-01-20",
        targetDate: "2026-01-01",
        targetDateGranularity: granularity,
      }).success
    ).toBe(true);
  }
);
it("compares labels without depending on order", () => {
  const other = { ...label, id: "22222222-2222-4222-8222-222222222222" };
  expect(
    projectChanges(
      { ...data, labels: [label, other] },
      { ...valuesOf(data), labelIds: [other.id, label.id] }
    )
  ).toEqual({});
});
it("rejects duplicate label selections", () => {
  expect(
    projectValues.safeParse({ ...valuesOf(data), labelIds: [label.id, label.id] }).success
  ).toBe(false);
});

it("rejects cross-Crew label options", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions }
      : { ...data, labelOptions: [{ ...label, crewId: "other" }] }
  );
  await expect(read()).rejects.toThrow("scope");
});
it("rejects mismatched accounts before reading the project", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "other", permissions });
  await expect(read()).rejects.toThrow("account mismatch");
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("rejects an already-cancelled read", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchProjectProperties("crew", "actor", 1, c.signal)).rejects.toThrow("cancelled");
  expect(api.get).not.toHaveBeenCalled();
});
it("rejects receipts after an account change", async () => {
  vi.mocked(api.patch).mockImplementation(async () => {
    h.generation++;
    return { project: { ...project, version: 3, status: "in_progress" }, labels: [] };
  });
  await expect(write()).rejects.toThrow("expired");
});
it("allows clearing lead, dates and labels without sending the rich document", async () => {
  const old = {
    ...data,
    project: { ...project, leadMemberId: "old", startDate: "2026-01-01", targetDate: "2026-02-01" },
    labels: [label],
  };
  vi.mocked(api.patch).mockResolvedValue({ project: { ...project, version: 3 }, labels: [] });
  await updateProjectProperties("crew", "actor", 1, old, valuesOf(data));
  expect(api.patch).toHaveBeenCalledWith(expect.anything(), {
    service: "aurora",
    data: {
      leadMemberId: null,
      startDate: null,
      targetDate: null,
      labelIds: [],
      expectedVersion: 2,
    },
  });
});
