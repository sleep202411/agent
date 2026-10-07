import { beforeEach, expect, it, vi } from "vitest";
import { pickHomework } from "./homework-upload";
import { getDocumentAsync } from "expo-document-picker";
import { uploadMobileMediaFile } from "@/lib/media-upload";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("@/lib/media-upload", () => ({ uploadMobileMediaFile: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("does not upload a cancelled selection", async () => {
  vi.mocked(getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
  expect(await pickHomework(new AbortController().signal)).toBeNull();
  expect(uploadMobileMediaFile).not.toHaveBeenCalled();
});
it("rejects account changes while the native picker is open", async () => {
  vi.mocked(getDocumentAsync).mockImplementation(async () => {
    h.generation++;
    return {
      canceled: false,
      assets: [{ uri: "file:///work.pdf", name: "work.pdf", size: 50, lastModified: 0 }],
    };
  });
  await expect(pickHomework(new AbortController().signal)).rejects.toThrow("account changed");
  expect(uploadMobileMediaFile).not.toHaveBeenCalled();
});
it("uses private document media for PDF homework", async () => {
  vi.mocked(getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///work.pdf", name: "work.pdf", size: 50, lastModified: 0 }],
  });
  vi.mocked(uploadMobileMediaFile).mockResolvedValue({
    mediaAssetId: "asset",
    url: "https://private.test/work",
  });
  expect(await pickHomework(new AbortController().signal)).toEqual({
    id: "asset",
    name: "work.pdf",
  });
  expect(uploadMobileMediaFile).toHaveBeenCalledWith(
    expect.objectContaining({ type: "application/pdf" }),
    expect.objectContaining({ kind: "agent_attachment_document" })
  );
});
