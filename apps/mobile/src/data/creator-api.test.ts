import { beforeEach, expect, it, vi } from "vitest";
import { fetchCreatorById, searchCreators } from "./creator-api";
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
beforeEach(() => {
  mocks.post.mockReset();
});
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

it("carries public education without exposing private profile fields", async () => {
  const study = JSON.stringify([
    { schoolName: "Film School", major: "Animation", startDate: "2024-09" },
  ]);
  mocks.post.mockResolvedValue({
    info: {
      id: "artist",
      nickName: "Artist",
      study,
      contact: "private@example.com",
      other: "private notes",
    },
  });
  const creator = await fetchCreatorById("artist");
  expect(creator?.study).toBe(study);
  expect(creator).not.toHaveProperty("contact");
  expect(creator).not.toHaveProperty("other");
});
it("ignores non-string education without losing the public profile", async () => {
  mocks.post.mockResolvedValue({
    info: { id: "artist", nickName: "Artist", study: { bad: true } },
  });
  expect(await fetchCreatorById("artist")).toMatchObject({ name: "Artist", study: undefined });
});

it("uses Web search query parameters and maps wrapped and flat creator rows", async () => {
  mocks.post.mockResolvedValue({
    data: [
      { info: { id: "1", nickName: "Alice" }, level: [{ id: 13, name: "Producer" }] },
      { id: "2", nickName: "Bob" },
      { id: "2" },
      null,
    ],
    sum: 71,
  });
  const result = await searchCreators(" Alice ", 50, 50);
  expect(mocks.post).toHaveBeenCalledWith("/user/search/users", {
    service: "content",
    params: { key: "Alice", page: 2, pageSize: 50 },
    raw: true,
    retry: false,
  });
  expect(result.creators.map((c) => c.name)).toEqual(["Alice", "Bob"]);
  expect(result.creators[0]?.levels[0]?.name).toBe("Producer");
  expect(result.nextOffset).toBe(100);
  expect(result.total).toBe(71);
});
it("does not turn malformed or failed searches into an empty directory", async () => {
  mocks.post.mockResolvedValue({ data: null });
  await expect(searchCreators("A")).rejects.toThrow("response");
  mocks.post.mockResolvedValue({ data: [], sum: -1 });
  await expect(searchCreators("A")).rejects.toThrow("total");
  mocks.post.mockRejectedValue(new Error("Java search unavailable"));
  await expect(searchCreators("A")).rejects.toThrow("Java search unavailable");
});
it("stops search pagination on a genuinely empty transport page", async () => {
  mocks.post.mockResolvedValue({ data: [], sum: 300 });
  expect((await searchCreators("A", 50, 100)).nextOffset).toBe(100);
});

it("preserves profile lookup failures instead of reporting a missing creator", async () => {
  mocks.post.mockRejectedValue(new Error("Creator service offline"));
  await expect(fetchCreatorById("artist")).rejects.toThrow("Creator service offline");
});
