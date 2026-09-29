import { beforeEach, expect, it, vi } from "vitest";
import { getCreatorExperience } from "./experience-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
beforeEach(() => vi.resetAllMocks());
it.each([true, false])(
  "reads public experience with either Web response shape (%s)",
  async (wrapped) => {
    const row = {
      id: 12,
      title: " Director ",
      organization: " Studio ",
      location: "SG",
      startTime: "2025-01",
      description: "First line\nSecond line",
      privateField: "secret",
    };
    h.get.mockResolvedValue(wrapped ? { list: [row] } : [row]);
    const signal = new AbortController().signal;
    const result = await getCreatorExperience("creator/id", signal);
    expect(h.get).toHaveBeenCalledWith("/user/resumer/list/creator%2Fid", {
      service: "content",
      signal,
    });
    expect(result).toEqual([
      {
        id: "12",
        title: "Director",
        organization: "Studio",
        location: "SG",
        startTime: "2025-01",
        endTime: "",
        description: "First line\nSecond line",
      },
    ]);
  }
);
it("ignores invalid rows and empty fields", async () => {
  h.get.mockResolvedValue([null, [], 42, {}, { title: "Producer", organization: 42 }]);
  expect(await getCreatorExperience("id")).toEqual([
    {
      id: undefined,
      title: "Producer",
      organization: "",
      location: "",
      startTime: "",
      endTime: "",
      description: "",
    },
  ]);
});
it("does not treat malformed or failed replies as an empty resume", async () => {
  h.get.mockResolvedValue({ list: {} });
  await expect(getCreatorExperience("id")).rejects.toThrow("Invalid experience response");
  h.get.mockRejectedValue(new Error("Offline"));
  await expect(getCreatorExperience("id")).rejects.toThrow("Offline");
});
