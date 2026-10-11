import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readSkillPackageFile, skillPackageForm } from "./skill-package-file.native";
const h = vi.hoisted(() => ({
  size: 4,
  exists: true,
  bytes: vi.fn(),
  write: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.join("/");
    }
    get exists() {
      return h.exists;
    }
    get size() {
      return h.size;
    }
    bytes = h.bytes;
    write = h.write;
    create = h.create;
    delete = h.remove;
  },
}));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "request" } }));
beforeEach(() => {
  vi.resetAllMocks();
  h.exists = true;
  h.size = 4;
  h.bytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
});
afterEach(() => vi.unstubAllGlobals());
it("reads bounded native file bytes and rejects missing, oversized and aborted files", async () => {
  const file = { name: "SKILL.md", uri: "file:///picked", lastModified: 0 };
  await expect(readSkillPackageFile(file, new AbortController().signal)).resolves.toEqual(
    new Uint8Array([1, 2, 3, 4])
  );
  h.size = 1_048_577;
  await expect(readSkillPackageFile(file, new AbortController().signal)).rejects.toThrow("1 MiB");
  expect(h.bytes).toHaveBeenCalledTimes(1);
  h.exists = false;
  await expect(readSkillPackageFile(file, new AbortController().signal)).rejects.toThrow(
    "no longer available"
  );
  const c = new AbortController();
  c.abort();
  await expect(readSkillPackageFile(file, c.signal)).rejects.toThrow();
});
it("materializes original bytes into a temporary multipart file and cleans up", () => {
  const append = vi.fn();
  vi.stubGlobal(
    "FormData",
    class {
      append = append;
    }
  );
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const upload = skillPackageForm(bytes, "技能.zip");
  expect(h.write).toHaveBeenCalledWith(bytes);
  expect(append).toHaveBeenCalledWith("file", {
    uri: "file:///cache/skill-import-request",
    name: "技能.zip",
    type: "application/zip",
  });
  upload.dispose();
  expect(h.remove).toHaveBeenCalledTimes(1);
  h.write.mockImplementationOnce(() => {
    throw Error("disk full");
  });
  expect(() => skillPackageForm(bytes, "SKILL.md")).toThrow("disk full");
  expect(h.remove).toHaveBeenCalledTimes(2);
});
