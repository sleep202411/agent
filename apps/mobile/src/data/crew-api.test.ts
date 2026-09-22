import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCrewById, fetchMyCrews } from "./crew-api";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get } }));
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
        title: "Art Director",
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

it("stops a repeated cursor instead of making unbounded requests", async () => {
  respond([
    { items: [], nextCursor: "repeat" },
    { items: [], nextCursor: "repeat" },
  ]);
  expect((await fetchCrewById("crew"))?.roles).toEqual([]);
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
