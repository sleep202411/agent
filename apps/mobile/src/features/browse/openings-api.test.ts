import { beforeEach, expect, it, vi } from "vitest";
import { fetchOpenings, openingFilters, salaryMinor } from "./openings-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
});
it("serializes all official filters without requiring a signed-in viewer", async () => {
  const filters = openingFilters.parse({
    q: "director",
    genre: "animation",
    positionType: "director",
    employment: ["full_time", "freelance"],
    skills: ["Editing, sound", "Director", "Director"],
    workMode: ["remote"],
    salaryMinMinor: "12000",
    salaryCurrency: "USD",
    salaryPeriod: "project",
    sort: "oldest",
  });
  await fetchOpenings(filters, "cursor", 1, new AbortController().signal);
  expect(h.get).toHaveBeenCalledWith(
    "/positions",
    expect.objectContaining({
      retry: false,
      params: {
        limit: 20,
        q: "director",
        genre: "animation",
        positionType: "director",
        employment: "freelance,full_time",
        skills: '["Director","Editing, sound"]',
        workMode: "remote",
        salaryMinMinor: "12000",
        salaryCurrency: "USD",
        salaryPeriod: "project",
        sort: "oldest",
        cursor: "cursor",
      },
    })
  );
});
it("preserves exact monetary values including zero and the server maximum", () => {
  expect(salaryMinor("0")).toBe("0");
  expect(salaryMinor("1.01")).toBe("101");
  expect(salaryMinor("99999999999999.99")).toBe("9999999999999999");
  expect(salaryMinor(" ")).toBeUndefined();
});
it.each(["-1", "1.001", "1e3", "01", "100000000000000", "NaN"])(
  "rejects invalid salary %s",
  (value) => {
    expect(() => salaryMinor(value)).toThrow();
  }
);
it.each([
  { skills: [""] },
  { skills: ["x".repeat(81)] },
  { skills: Array.from({ length: 21 }, (_, i) => `Skill ${i}`) },
  { workMode: ["unknown"] },
  { genre: "unknown" },
  { salaryMinMinor: "1" },
  { salaryMinMinor: "200", salaryMaxMinor: "100", salaryCurrency: "USD", salaryPeriod: "project" },
])("rejects invalid filter combinations %j", (filters) => {
  expect(() => openingFilters.parse(filters)).toThrow();
});
it("does not send empty query or inactive salary filters", async () => {
  await fetchOpenings(openingFilters.parse({}), null, 1, new AbortController().signal);
  expect(h.get.mock.calls[0]![1].params).toEqual({ limit: 20, sort: "newest" });
});
it("rejects old account and malformed pagination responses", async () => {
  h.get.mockResolvedValue({ items: [], nextCursor: "loop", total: 0 });
  await expect(
    fetchOpenings(openingFilters.parse({}), "loop", 1, new AbortController().signal)
  ).rejects.toThrow();
  h.generation = 2;
  await expect(
    fetchOpenings(openingFilters.parse({}), null, 1, new AbortController().signal)
  ).rejects.toThrow("expired");
});
