import { beforeEach, expect, it, vi } from "vitest";
import { fetchCreatorById } from "./creator-api";
const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { post: mocks.post } }));
vi.mock("@/config", () => ({
  appEnv: {
    assets: {
      staticBaseUrl: "https://static.test",
      userBaseUrl: "https://user.test",
      bannerBaseUrl: "https://banner.test",
    },
  },
  resolveAssetUrl: (path: string, base: string) => `${base}/${path}`,
}));
beforeEach(() => mocks.post.mockReset());
it("maps assigned creator qualifications into the existing profile tags", async () => {
  mocks.post.mockResolvedValue({
    info: { id: "creator", nickName: "Artist" },
    level: [
      { id: 20, type: 3, name: "Free viewing" },
      { id: 101, type: 1, name: "FD I", imagePath: "fd.png" },
      { id: 13, name: "AI Producer" },
      { id: 201, type: 4, name: "Animation" },
      { id: 202, name: "FD named privilege" },
    ],
  });
  const creator = await fetchCreatorById("creator");
  expect(creator?.levels.map((level) => level.name)).toEqual(["FD I", "AI Producer", "Animation"]);
  expect(creator?.primaryLevel).toBe("FD I");
  expect(creator?.levels[0]?.iconUrl).toBe("https://static.test/fd.png");
  expect(mocks.post).toHaveBeenCalledWith("/user/other/user/info", {
    params: { UserId: "creator" },
    raw: true,
    service: "content",
  });
});
it.each(
  [null, {}, [null, { id: -1, type: 1, name: "Invalid" }, { id: 13, name: " " }]].map((value) => [
    value,
  ])
)("keeps public profile data when qualification data is absent or malformed: %j", async (level) => {
  mocks.post.mockResolvedValue({ info: { id: "creator", nickName: "Artist" }, level });
  expect(await fetchCreatorById("creator")).toMatchObject({ name: "Artist", levels: [] });
});
