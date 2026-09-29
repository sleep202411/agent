import { beforeEach, expect, it, vi } from "vitest";
import { AvatarValidationError, pickAndUploadAvatar } from "./avatar-upload";
const h = vi.hoisted(() => ({ pick: vi.fn(), post: vi.fn(), platform: { OS: "web" } }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("react-native", () => ({ Platform: h.platform }));
vi.mock("@/lib/api-client", () => ({ api: { postFormData: h.post } }));
beforeEach(() => {
  vi.resetAllMocks();
  h.platform.OS = "web";
});
const run = (current = () => true) => pickAndUploadAvatar(current, new AbortController().signal);
it("sends the selected image using Web's multipart field and endpoint", async () => {
  const file = new File(["image"], "avatar.png", { type: "image/png" });
  h.pick.mockResolvedValue({ canceled: false, assets: [{ file, name: file.name }] });
  expect(await run()).toBe(true);
  const [path, form, config] = h.post.mock.calls[0];
  expect(path).toBe("/user/uploadAratar");
  expect(form.get("file").name).toBe("avatar.png");
  expect(config.service).toBe("content");
});
it.each([
  new File(["text"], "a.txt", { type: "text/plain" }),
  new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.png", { type: "image/png" }),
  new File([], "empty.png", { type: "image/png" }),
])("rejects invalid image uploads", async (file) => {
  h.pick.mockResolvedValue({ canceled: false, assets: [{ file, name: file.name }] });
  await expect(run()).rejects.toBeInstanceOf(AvatarValidationError);
  expect(h.post).not.toHaveBeenCalled();
});
it("ignores a canceled picker", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await run()).toBe(false);
  expect(h.post).not.toHaveBeenCalled();
});
it("does not submit a picker result belonging to an old account", async () => {
  let current = true;
  h.pick.mockImplementation(async () => {
    current = false;
    return { canceled: false, assets: [{}] };
  });
  expect(await run(() => current)).toBe(false);
  expect(h.post).not.toHaveBeenCalled();
});

it("uses a native URI multipart part without converting the image into a web File", async () => {
  h.platform.OS = "ios";
  const append = vi.spyOn(FormData.prototype, "append");
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: "file:///cache/avatar.png", name: "avatar.png", mimeType: "image/png", size: 100 },
    ],
  });
  try {
    expect(await run()).toBe(true);
    expect(append).toHaveBeenCalledWith("file", {
      uri: "file:///cache/avatar.png",
      name: "avatar.png",
      type: "image/png",
    });
  } finally {
    append.mockRestore();
  }
});
