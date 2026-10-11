import { beforeEach, expect, it, vi } from "vitest";
import { pickLevelApplicationAttachment } from "./level-application-upload";
const h = vi.hoisted(() => ({
  generation: 1,
  pick: vi.fn(),
  upload: vi.fn(),
  platform: { OS: "web" },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/lib/api-client", () => ({ api: { postFormData: h.upload } }));
vi.mock("react-native", () => ({ Platform: h.platform }));
const asset = () => ({
  file: new File(["proof"], "proof.pdf", { type: "application/pdf" }),
  name: "proof.pdf",
  uri: "file:///proof.pdf",
  mimeType: "application/pdf",
  size: 5,
});
const run = () => pickLevelApplicationAttachment(1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.platform.OS = "web";
  h.pick.mockResolvedValue({ canceled: false, assets: [asset()] });
  h.upload.mockResolvedValue("apply/proof.pdf");
});
it("uploads an explicitly selected document to the official endpoint", async () => {
  expect(await run()).toEqual({ name: "proof.pdf", path: "apply/proof.pdf" });
  expect(h.pick).toHaveBeenCalledWith(
    expect.objectContaining({ multiple: false, copyToCacheDirectory: true })
  );
  const [path, form, options] = h.upload.mock.calls[0];
  expect(path).toBe("/user/levels/apply/upload");
  expect(form.get("file").name).toBe("proof.pdf");
  expect(options).toMatchObject({ service: "content", retry: false });
});
it("uses a local native URI and the validated MIME type", async () => {
  h.platform.OS = "ios";
  h.pick.mockResolvedValue({ canceled: false, assets: [{ ...asset(), file: undefined }] });
  const append = vi.spyOn(FormData.prototype, "append");
  try {
    await run();
    expect(append).toHaveBeenCalledWith("file", {
      uri: "file:///proof.pdf",
      name: "proof.pdf",
      type: "application/pdf",
    });
  } finally {
    append.mockRestore();
  }
});
it("does not upload after picker cancellation", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await run()).toBeNull();
  expect(h.upload).not.toHaveBeenCalled();
});
it.each([
  { name: "script.exe" },
  { mimeType: "text/html" },
  { size: 0 },
  { size: undefined },
  { size: NaN },
])("rejects an invalid device attachment %j", async (patch) => {
  h.platform.OS = "android";
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ ...asset(), file: undefined, ...patch }],
  });
  await expect(run()).rejects.toThrow();
  expect(h.upload).not.toHaveBeenCalled();
});
it("rejects a remote URI instead of sending it as a local attachment", async () => {
  h.platform.OS = "android";
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ ...asset(), file: undefined, uri: "https://other.test/private" }],
  });
  await expect(run()).rejects.toThrow("local");
  expect(h.upload).not.toHaveBeenCalled();
});
it.each(["pick", "upload"])("rejects a changed account during %s", async (stage) => {
  if (stage === "pick")
    h.pick.mockImplementation(async () => {
      h.generation = 2;
      return { canceled: false, assets: [asset()] };
    });
  else
    h.upload.mockImplementation(async () => {
      h.generation = 2;
      return "apply/proof.pdf";
    });
  await expect(run()).rejects.toThrow("session");
  if (stage === "pick") expect(h.upload).not.toHaveBeenCalled();
});
it.each([null, {}, ""])("does not accept malformed upload receipts %j", async (value) => {
  h.upload.mockResolvedValue(value);
  await expect(run()).rejects.toThrow();
});
it("respects cancellation before the picker opens", async () => {
  const c = new AbortController();
  c.abort();
  await expect(pickLevelApplicationAttachment(1, c.signal)).rejects.toThrow("cancelled");
  expect(h.pick).not.toHaveBeenCalled();
});
