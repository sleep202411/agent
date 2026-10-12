import { beforeEach, it, expect, vi } from "vitest";
import { pickWorkspaceIcon } from "./workspace-icon-upload";
const h = vi.hoisted(() => ({ pick: vi.fn(), upload: vi.fn(), generation: 1 }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/lib/media-upload", () => ({ uploadMobileMediaFile: h.upload }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const file = { uri: "file:///icon.png", name: "icon.png", mimeType: "image/png", size: 500 };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pick.mockResolvedValue({ canceled: false, assets: [file] });
  h.upload.mockResolvedValue({ url: "https://cdn.test/icon.png" });
});
it("uses the official verified-image upload kind and size cap", async () => {
  const signal = new AbortController().signal;
  await expect(pickWorkspaceIcon(1, signal)).resolves.toBe("https://cdn.test/icon.png");
  expect(h.upload).toHaveBeenCalledWith(
    { uri: file.uri, name: file.name, type: file.mimeType, size: 500 },
    { kind: "workspace_icon", maxBytes: 5242880, signal }
  );
});
it.each([
  { ...file, mimeType: "image/svg+xml" },
  { ...file, size: 0 },
  { ...file, size: 5242881 },
])("rejects invalid selections without reserving storage", async (asset) => {
  h.pick.mockResolvedValue({ canceled: false, assets: [asset] });
  await expect(pickWorkspaceIcon(1, new AbortController().signal)).rejects.toThrow();
  expect(h.upload).not.toHaveBeenCalled();
});
it("cancellation leaves the icon unchanged", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  await expect(pickWorkspaceIcon(1, new AbortController().signal)).resolves.toBeNull();
  expect(h.upload).not.toHaveBeenCalled();
});
it("rejects a late picker completion after account change", async () => {
  h.pick.mockImplementation(async () => {
    h.generation++;
    return { canceled: false, assets: [file] };
  });
  await expect(pickWorkspaceIcon(1, new AbortController().signal)).rejects.toThrow(
    "account changed"
  );
  expect(h.upload).not.toHaveBeenCalled();
});
it("rejects an aborted upload completion", async () => {
  const c = new AbortController();
  h.upload.mockImplementation(async () => {
    c.abort();
    return { url: "https://cdn.test/icon.png" };
  });
  await expect(pickWorkspaceIcon(1, c.signal)).rejects.toThrow();
});
