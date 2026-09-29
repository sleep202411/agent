import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { createEpisode, episodeCreateInput, fetchEpisodeCreateAccess } from "./episode-create-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111";
const response = {
  id,
  crewId: "crew",
  number: 2,
  title: "Pilot",
  synopsis: "Opening",
  status: "planned",
  createdByUserId: "user",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("requires production.manage rather than tasks.manage and verifies account", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "user", permissions: ["tasks.manage"] })
    .mockResolvedValueOnce({ userId: "user", permissions: ["production.manage"] })
    .mockResolvedValueOnce({ userId: "someone", permissions: ["production.manage"] });
  const signal = new AbortController().signal;
  expect(await fetchEpisodeCreateAccess("crew", "user", signal)).toBe(false);
  expect(await fetchEpisodeCreateAccess("crew", "user", signal)).toBe(true);
  await expect(fetchEpisodeCreateAccess("crew", "user", signal)).rejects.toThrow("account");
});
it("creates a planned episode and leaves automatic numbering to the server", async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  expect(await createEpisode("crew", "user", 1, { title: " Pilot ", synopsis: "Opening" })).toEqual(
    response
  );
  expect(api.post).toHaveBeenCalledWith("/crews/crew/episodes", {
    service: "aurora",
    data: { title: "Pilot", synopsis: "Opening", status: "planned" },
  });
});
it.each([0, -1, 1.2, 100001])("rejects invalid episode number %s", (number) => {
  expect(() => episodeCreateInput.parse({ title: "Pilot", synopsis: "", number })).toThrow();
});
it("validates blanks, lengths and disallows approval status in the request", () => {
  for (const input of [
    { title: " ", synopsis: "" },
    { title: "x".repeat(181), synopsis: "" },
    { title: "Pilot", synopsis: "x".repeat(20001) },
    { title: "Pilot", synopsis: "", status: "completed" },
  ])
    expect(() => episodeCreateInput.parse(input)).toThrow();
});
it.each([
  { crewId: "other" },
  { createdByUserId: "other" },
  { number: 3 },
  { status: "completed" },
  { title: "Other" },
])("rejects mismatched creation receipts %j", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({ ...response, ...patch });
  await expect(
    createEpisode("crew", "user", 1, { title: "Pilot", synopsis: "Opening", number: 2 })
  ).rejects.toThrow();
});
it("does not post from a stale session", async () => {
  h.generation = 2;
  await expect(createEpisode("crew", "user", 1, { title: "Pilot", synopsis: "" })).rejects.toThrow(
    "expired"
  );
  expect(api.post).not.toHaveBeenCalled();
});
