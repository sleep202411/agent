import { beforeEach, expect, it, vi } from "vitest";
import { pickCrewLogo } from "./crew-logo-upload";
const h = vi.hoisted(() => ({
  generation: 1,
  pick: vi.fn(),
  upload: vi.fn(),
  post: vi.fn(),
  platform: { OS: "web" },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/profile/publish-work-api", () => ({ pickWorkFile: h.pick }));
vi.mock("@/lib/api-client", () => ({ api: { postFormData: h.upload, post: h.post } }));
vi.mock("react-native", () => ({ Platform: h.platform }));
const run = () => pickCrewLogo(1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.platform.OS = "web";
  h.pick.mockResolvedValue({
    file: new File(["image"], "logo.png", { type: "image/png" }),
    name: "logo.png",
    uri: "file:///logo.png",
    mimeType: "image/png",
  });
  h.upload.mockResolvedValue("crews/logo.png");
});
it("uploads only the banner asset, without updating the account profile", async () => {
  expect(await run()).toBe("crews/logo.png");
  expect(h.pick).toHaveBeenCalledWith("cover");
  const [path, form, options] = h.upload.mock.calls[0];
  expect(path).toBe("/project/uploadBanner");
  expect(form.get("file").name).toBe("logo.png");
  expect(options.service).toBe("content");
  expect(h.post).not.toHaveBeenCalled();
});
it("uses the native URI multipart form on devices", async () => {
  h.platform.OS = "ios";
  const append = vi.spyOn(FormData.prototype, "append");
  try {
    await run();
    expect(append).toHaveBeenCalledWith("file", {
      uri: "file:///logo.png",
      name: "logo.png",
      type: "image/png",
    });
  } finally {
    append.mockRestore();
  }
});
it("does not upload a cancelled selection", async () => {
  h.pick.mockResolvedValue(null);
  expect(await run()).toBeNull();
  expect(h.upload).not.toHaveBeenCalled();
});
it("rejects a stale account's picker result before upload", async () => {
  h.pick.mockImplementation(async () => {
    h.generation = 2;
    return {};
  });
  await expect(run()).rejects.toThrow("session");
  expect(h.upload).not.toHaveBeenCalled();
});
it("does not accept a late upload response after account replacement", async () => {
  h.upload.mockImplementation(async () => {
    h.generation = 2;
    return "logo.png";
  });
  await expect(run()).rejects.toThrow("session");
});
it.each(["", null, {}, "x".repeat(513)])("rejects an invalid logo response", async (value) => {
  h.upload.mockResolvedValue(value);
  await expect(run()).rejects.toThrow();
});
it("does not open a picker after cancellation", async () => {
  const c = new AbortController();
  c.abort();
  await expect(pickCrewLogo(1, c.signal)).rejects.toThrow("cancelled");
  expect(h.pick).not.toHaveBeenCalled();
});
