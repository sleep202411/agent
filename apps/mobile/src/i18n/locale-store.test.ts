import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), invalidate: vi.fn() }));
vi.mock("expo-localization", () => ({ getLocales: () => [{ languageTag: "en-US" }] }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: m.invalidate }));
vi.mock("@/lib/persistent-storage", () => ({ getStoredString: m.read, setStoredString: m.write }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.write.mockResolvedValue(undefined);
});
it("does not let delayed initialization overwrite a new selection", async () => {
  let finish!: (s: string) => void;
  m.read.mockReturnValue(new Promise((r) => (finish = r)));
  const s = await import("./locale-store");
  const pending = s.initLocale();
  s.setLocale("zh-HK");
  finish("zh-CN");
  await pending;
  expect(s.getLocale()).toBe("zh-HK");
  expect(m.invalidate).toHaveBeenCalledTimes(1);
});
it("honors an explicit selection of the current language", async () => {
  let finish!: (s: string) => void;
  m.read.mockReturnValue(new Promise((r) => (finish = r)));
  const s = await import("./locale-store");
  const pending = s.initLocale();
  s.setLocale("en-US");
  finish("zh-CN");
  await pending;
  expect(s.getLocale()).toBe("en-US");
  expect(m.write).toHaveBeenCalledWith("fizzdragon.locale.override", "en-US");
  expect(m.invalidate).not.toHaveBeenCalled();
});
it("loads saved locale when no user selection intervenes", async () => {
  m.read.mockResolvedValue("zh-CN");
  const s = await import("./locale-store");
  await s.initLocale();
  expect(s.getLocale()).toBe("zh-CN");
  expect(m.invalidate).toHaveBeenCalledOnce();
});
it("keeps device locale on invalid saved value or storage failure", async () => {
  m.read.mockResolvedValue("invalid");
  const s = await import("./locale-store");
  await s.initLocale();
  expect(s.getLocale()).toBe("en-US");
  m.read.mockRejectedValue(new Error("storage"));
  await s.initLocale();
  expect(s.getLocale()).toBe("en-US");
});
