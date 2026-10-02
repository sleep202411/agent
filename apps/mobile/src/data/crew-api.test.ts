import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { fetchCrewById, fetchCrewFeedPage, fetchMyCrews } from "./crew-api";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/config", () => ({
  appEnv: { assets: { bannerBaseUrl: "https://assets.test" } },
  resolveAssetUrl: vi.fn(),
}));

beforeEach(() => {
  get.mockReset();
});
function respond(pages: unknown[]) {
  get.mockImplementation(async (path: string) =>
    path.endsWith("/positions") ? pages.shift() : { id: "crew", name: "Crew" }
  );
}
describe("Crew detail positions", () => {
  it("maps the server's items envelope into selectable roles", async () => {
    respond([
      {
        items: [{ id: "role", status: "open", positionType: "art_director", targetCount: 2 }],
        nextCursor: null,
      },
    ]);
    expect((await fetchCrewById("crew"))?.roles).toEqual([
      {
        id: "role",
        title: "art_director",
        positionType: "art_director",
        count: 2,
        location: undefined,
        employmentType: undefined,
      },
    ]);
  });
  it("includes roles beyond the first server page", async () => {
    respond([
      { items: [{ id: "first", status: "open" }], nextCursor: "first" },
      { items: [{ id: "last", status: "open" }], nextCursor: null },
    ]);
    expect((await fetchCrewById("crew"))?.roles.map((role) => role.id)).toEqual(["first", "last"]);
    expect(get).toHaveBeenCalledWith(
      "/crews/crew/positions",
      expect.objectContaining({ params: { cursor: "first" } })
    );
  });
  it("finishes when there are no openings", async () => {
    respond([{ items: [], nextCursor: null }]);
    expect((await fetchCrewById("crew"))?.roles).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

it("retains canonical role codes for localized cards and detail, and preserves custom titles", async () => {
  get.mockResolvedValueOnce({
    items: [{ id: "crew", openPositionPreview: ["storyboard", "VFX / AI lead"] }],
  });
  expect((await fetchCrewFeedPage()).items[0].roleTags).toEqual(["storyboard", "VFX / AI lead"]);
  respond([
    {
      items: [
        { id: "preset", status: "open", positionType: "storyboard" },
        { id: "custom", status: "open", positionType: "VFX / AI lead" },
      ],
      nextCursor: null,
    },
  ]);
  const roles = (await fetchCrewById("crew"))!.roles;
  expect(roles[0]).toMatchObject({
    id: "preset",
    positionType: "storyboard",
    title: "Storyboard Artist",
  });
  expect(roles[1]).toMatchObject({
    id: "custom",
    positionType: "VFX / AI lead",
    title: "VFX / AI lead",
  });
});

it("stops a repeated cursor instead of making unbounded requests", async () => {
  respond([
    { items: [], nextCursor: "repeat" },
    { items: [], nextCursor: "repeat" },
  ]);
  await expect(fetchCrewById("crew")).rejects.toThrow("Repeated crew positions cursor");
  expect(get).toHaveBeenCalledTimes(3);
});

it("offers only open positions when the server includes full or frozen positions", async () => {
  respond([
    {
      items: [
        { id: "full", status: "full" },
        { id: "frozen", status: "frozen" },
        { id: "available", status: "open" },
      ],
      nextCursor: null,
    },
  ]);
  expect((await fetchCrewById("crew"))?.roles.map((role) => role.id)).toEqual(["available"]);
});

it("includes founded and joined crews without treating community subscriptions as membership", async () => {
  get.mockResolvedValue({
    founded: [{ id: "founded", name: "Founded" }],
    joined: [{ id: "joined", name: "Joined" }],
    community: [{ id: "fan", name: "Fan community" }],
  });
  expect((await fetchMyCrews()).map((crew) => crew.id)).toEqual(["founded", "joined"]);
});

it("distinguishes missing crews from permission and transport failures", async () => {
  get.mockRejectedValueOnce(new ApiRequestError("NOT_FOUND", "Missing", 404));
  expect(await fetchCrewById("crew")).toBeUndefined();
  expect(get).toHaveBeenCalledTimes(1);
  for (const error of [
    new Error("Offline"),
    new ApiRequestError("FORBIDDEN", "Private crew", 403),
  ]) {
    get.mockRejectedValueOnce(error);
    await expect(fetchCrewById("crew")).rejects.toBe(error);
  }
});

it("does not turn a failed later openings page into an empty or partial list", async () => {
  get
    .mockResolvedValueOnce({ id: "crew", name: "Crew" })
    .mockResolvedValueOnce({ items: [{ id: "first", status: "open" }], nextCursor: "first" })
    .mockRejectedValueOnce(new Error("Openings unavailable"));
  await expect(fetchCrewById("crew")).rejects.toThrow("Openings unavailable");
});

it("encodes the destination and stops paging when the reader leaves", async () => {
  const controller = new AbortController();
  get.mockResolvedValueOnce({ id: "crew/id", name: "Crew" }).mockImplementationOnce(async () => {
    controller.abort();
    return { items: [], nextCursor: "next" };
  });
  await expect(fetchCrewById("crew/id", controller.signal)).rejects.toThrow();
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenLastCalledWith(
    "/crews/crew%2Fid/positions",
    expect.objectContaining({ signal: controller.signal, retry: false })
  );
});
