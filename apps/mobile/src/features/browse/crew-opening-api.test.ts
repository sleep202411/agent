import { ApiRequestError } from "@/lib/api-client";
import { beforeEach, expect, it, vi } from "vitest";
import { fetchCrewOpening, openingIsFull, openingViewerIsMember } from "./crew-opening-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public responseBody?: string
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
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

const read = () => fetchCrewOpening("crew", "position", new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.get.mockImplementation(async (path) =>
    path === "/crews/crew" ? { id: "crew", name: "Crew" } : { items: [row], nextCursor: null }
  );
});
it("reads public detail without requiring membership", async () => {
  expect((await read())?.position.description).toBe("Original");
  expect(h.get.mock.calls.every(([path]) => !path.includes("members"))).toBe(true);
});
it("finds the selected opening beyond the first page", async () => {
  h.get
    .mockResolvedValueOnce({ id: "crew", name: "Crew" })
    .mockResolvedValueOnce({ items: [{ ...row, id: "another" }], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [row], nextCursor: null });
  expect((await read())?.position.id).toBe("position");
  expect(h.get.mock.calls[2][1].params.cursor).toBe("next");
});
it.each([{ status: "frozen" }, { recruitmentVisibility: "private" }])(
  "hides ineligible opening %j",
  async (patch) => {
    h.get
      .mockResolvedValueOnce({ id: "crew", name: "Crew" })
      .mockResolvedValueOnce({ items: [{ ...row, ...patch }], nextCursor: null });
    expect(await read()).toBeNull();
  }
);
it("does not substitute another job for a removed selection", async () => {
  h.get
    .mockResolvedValueOnce({ id: "crew", name: "Crew" })
    .mockResolvedValueOnce({ items: [{ ...row, id: "other" }], nextCursor: null });
  expect(await read()).toBeNull();
});
it("rejects repeated pagination and propagates request failures", async () => {
  h.get
    .mockResolvedValueOnce({ id: "crew", name: "Crew" })
    .mockResolvedValue({ items: [], nextCursor: "loop" });
  await expect(read()).rejects.toThrow("Repeated");
  h.get.mockRejectedValue(new Error("Offline"));
  await expect(read()).rejects.toThrow("Offline");
});
it("rejects wrong crew data and unsafe route IDs before requesting", async () => {
  h.get.mockResolvedValueOnce({ id: "other", name: "Crew" });
  await expect(read()).rejects.toThrow("match");
  h.get.mockClear();
  await expect(
    fetchCrewOpening("../crew", "position", new AbortController().signal)
  ).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("marks full status and exhausted headcount as full", () => {
  expect(openingIsFull({ ...row, status: "full" } as never)).toBe(true);
  expect(openingIsFull({ ...row, recruitedCount: 3 } as never)).toBe(true);
  expect(openingIsFull(row as never)).toBe(false);
});

it("disables members but treats only official non-member verdict as eligible", async () => {
  h.get.mockResolvedValueOnce({ userId: "actor" });
  expect(await openingViewerIsMember("crew", "actor", new AbortController().signal)).toBe(true);
  h.get.mockRejectedValueOnce(
    new ApiRequestError(
      "HTTP_403",
      "Not a member",
      403,
      JSON.stringify({ code: "CREW_MEMBERSHIP_REQUIRED" })
    )
  );
  expect(await openingViewerIsMember("crew", "actor", new AbortController().signal)).toBe(false);
  h.get.mockRejectedValueOnce(new ApiRequestError("HTTP_403", "Denied", 403));
  await expect(
    openingViewerIsMember("crew", "actor", new AbortController().signal)
  ).rejects.toThrow("Denied");
  h.get.mockResolvedValueOnce({ userId: "other" });
  await expect(
    openingViewerIsMember("crew", "actor", new AbortController().signal)
  ).rejects.toThrow("account");
});
