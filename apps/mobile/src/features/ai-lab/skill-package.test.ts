import { beforeEach, expect, it, vi } from "vitest";
import {
  packSkillPackage,
  unpackSkillPackage,
  SKILL_PACKAGE_MAX_BYTES,
} from "./skill-package-content";
import { pickSkillPackage } from "./skill-package-picker";
const h = vi.hoisted(() => ({ generation: 1, pick: vi.fn(), read: vi.fn() }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("./skill-package-file", () => ({ readSkillPackageFile: h.read }));
vi.mock("./jobs-api", () => ({
  generationSession: (generation: number, signal: AbortSignal) => {
    if (signal.aborted || generation !== h.generation) throw Error("expired");
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: "SKILL.md", uri: "file:///skill", size: 4 }],
  });
  h.read.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
});
it("retains exact bytes up to the server limit and rejects corrupt/oversized packages", () => {
  const bytes = new Uint8Array(SKILL_PACKAGE_MAX_BYTES).fill(123),
    packed = packSkillPackage("技能.zip", bytes);
  expect(Buffer.compare(Buffer.from(unpackSkillPackage(packed)), Buffer.from(bytes))).toBe(0);
  expect(() => packSkillPackage("empty.md", new Uint8Array())).toThrow("non-empty");
  expect(() => packSkillPackage("large.zip", new Uint8Array(SKILL_PACKAGE_MAX_BYTES + 1))).toThrow(
    "1 MiB"
  );
  expect(() => packSkillPackage("../SKILL.md", bytes)).toThrow();
  expect(() => unpackSkillPackage({ ...packed, checksum: "0".repeat(64) })).toThrow("checksum");
});
it("uses the native picker without base64 and reads exact content before creating a request", async () => {
  const file = await pickSkillPackage(1, new AbortController().signal);
  expect(file?.bytes).toBe(4);
  expect(file?.hex).toBe("01020304");
  expect(h.pick).toHaveBeenCalledWith(
    expect.objectContaining({ multiple: false, copyToCacheDirectory: true, base64: false })
  );
});
it("rejects oversized metadata, unsupported names and stale picker completion without reading bytes", async () => {
  h.pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ name: "large.zip", uri: "file:///large", size: SKILL_PACKAGE_MAX_BYTES + 1 }],
  });
  await expect(pickSkillPackage(1, new AbortController().signal)).rejects.toThrow("1 MiB");
  h.pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ name: "bad.exe", uri: "file:///bad" }],
  });
  await expect(pickSkillPackage(1, new AbortController().signal)).rejects.toThrow("Markdown");
  h.pick.mockImplementationOnce(async () => {
    h.generation++;
    return { canceled: true };
  });
  await expect(pickSkillPackage(1, new AbortController().signal)).rejects.toThrow("expired");
  expect(h.read).not.toHaveBeenCalled();
});
it("cancellation does not create a package or read a file", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  await expect(pickSkillPackage(1, new AbortController().signal)).resolves.toBeNull();
  expect(h.read).not.toHaveBeenCalled();
});
