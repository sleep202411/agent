import { beforeEach, expect, it, vi } from "vitest";
import { fetchSavedOpenings, readSavedOpening, setSavedOpening } from "./saved-openings-api";
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put, delete: h.delete } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
const row = {
  id: "position",
  crewId: "crew",
  taskId: null,
  recruitmentVisibility: "public",
  positionType: "custom old role",
  description: "Original",
  targetCount: 3,
  recruitedCount: 1,
  status: "open",
  workMode: "remote",
  location: null,
  employmentType: "project_based",
  experienceLevel: "any",
  requiredSkills: [],
  salary: {
    currency: "USD",
    period: "project",
    minAmount: 1234,
    maxAmount: 5000,
    negotiable: false,
  },
  durationMonths: null,
  revenueSharePercent: null,
  closeDate: null,
};

const crew = { id: "crew", name: "Crew", logo: null, tagline: null, genres: [], styles: [] };
const scope = { userId: "user", generation: 1 };
const page = () => ({ items: [{ position: row, crew }], nextCursor: null, total: 1 });
const read = (cursor: string | null = null) =>
  fetchSavedOpenings(scope, cursor, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(page());
});
it("requests only saved currently public openings with stable pagination", async () => {
  expect((await read()).items[0]?.position.id).toBe("position");
  expect(h.get).toHaveBeenCalledWith(
    "/positions",
    expect.objectContaining({
      params: { saved: "true", limit: 20, sort: "newest" },
      retry: false,
      credentials: "include",
    })
  );
  await read("previous");
  expect(h.get.mock.calls.at(-1)?.[1].params.cursor).toBe("previous");
});
it.each([
  { items: [{ position: row, crew: { ...crew, id: "wrong" } }] },
  { items: [{ position: { ...row, status: "full" }, crew }] },
  { items: [{ position: { ...row, recruitmentVisibility: "private" }, crew }] },
  {
    items: [
      { position: row, crew },
      { position: row, crew },
    ],
    total: 2,
  },
  { total: 0 },
  { nextCursor: "other" },
  { items: [], nextCursor: "other" },
])("rejects inconsistent saved-list receipts %j", async (patch) => {
  h.get.mockResolvedValue({ ...page(), ...patch });
  await expect(read()).rejects.toThrow();
});
it("rejects cursor loops", async () => {
  h.get.mockResolvedValue({ ...page(), nextCursor: "position" });
  await expect(read("position")).rejects.toThrow();
});
it("refuses unsafe paths and stale or aborted reads before network access", async () => {
  await expect(read("../bad")).rejects.toThrow();
  h.generation = 2;
  await expect(read()).rejects.toThrow("expired");
  h.generation = 1;
  const c = new AbortController();
  c.abort();
  await expect(fetchSavedOpenings(scope, null, c.signal)).rejects.toThrow("expired");
  await expect(readSavedOpening(scope, "../bad", new AbortController().signal)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("checks account generation after the response", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return page();
  });
  await expect(read()).rejects.toThrow("expired");
});
it("requires an explicit matching mutation receipt", async () => {
  h.put.mockResolvedValue({ saved: false });
  await expect(
    setSavedOpening(scope, "position", true, new AbortController().signal)
  ).rejects.toThrow("verified");
  h.delete.mockResolvedValue({ saved: false });
  expect(await setSavedOpening(scope, "position", false, new AbortController().signal)).toBe(false);
});
