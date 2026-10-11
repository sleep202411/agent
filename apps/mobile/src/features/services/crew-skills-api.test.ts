import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCrewSkills, requiredSkillsSchema, sameSkills } from "./crew-skills-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
it("reads the official regional catalog with cancellation and validates its contents", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue({ skills: ["Editing", "Lighting"] });
  expect(await fetchCrewSkills(signal)).toEqual(["Editing", "Lighting"]);
  expect(api.get).toHaveBeenLastCalledWith("/crew-qualification-catalog", {
    service: "aurora",
    signal,
  });
  for (const skills of [[""], ["Editing", "Editing"], ["x".repeat(65)], null]) {
    vi.mocked(api.get).mockResolvedValue({ skills });
    await expect(fetchCrewSkills(signal)).rejects.toThrow();
  }
});
it("enforces task selection limits and compares skills independently of order", () => {
  expect(requiredSkillsSchema.parse([])).toEqual([]);
  for (const skills of [[" "], ["a", " a "], Array.from({ length: 21 }, (_, n) => String(n))])
    expect(requiredSkillsSchema.safeParse(skills).success).toBe(false);
  expect(sameSkills(["Editing", "Lighting"], ["Lighting", "Editing"])).toBe(true);
  expect(sameSkills(["Editing"], [])).toBe(false);
});
