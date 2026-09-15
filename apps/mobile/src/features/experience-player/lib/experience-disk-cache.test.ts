import { createDiskCachePool } from "./experience-disk-cache";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  files: new Map<string, { size: number; fail?: boolean }>(),
  mkdir: vi.fn(),
}));
vi.mock("expo-file-system", () => {
  class File {
    name: string;
    constructor(_dir: unknown, name: string) {
      this.name = name;
    }
    get exists() {
      return state.files.has(this.name);
    }
    get size() {
      return state.files.get(this.name)?.size ?? 0;
    }
    delete() {
      if (state.files.get(this.name)?.fail) throw Error("read only");
      state.files.delete(this.name);
    }
    info() {
      return { modificationTime: this.name === "old.mp4" ? 1 : 2 };
    }
    create() {
      state.files.set(this.name, { size: 1 });
    }
    write() {}
    textSync() {
      return "{}";
    }
  }
  class Directory {
    get exists() {
      return false;
    }
    create() {
      state.mkdir();
    }
    list() {
      return [...state.files.keys()].map((name) => new File(this, name));
    }
  }
  // Directory existence is separately configurable without changing the file model.
  Object.defineProperty(Directory.prototype, "exists", { get: () => state.files.size > 0 });
  return { File, Directory, Paths: { cache: "fixture" } };
});
beforeEach(() => {
  state.files.clear();
  state.mkdir.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("continues eviction when an older file cannot be deleted", async () => {
  state.files.set("old.mp4", { size: 10, fail: true });
  state.files.set("new.mp4", { size: 10 });
  const pool = createDiskCachePool({
    dirName: "fixture",
    budgetBytes: 10,
    isManaged: (name) => name.endsWith(".mp4"),
  });
  await pool.enqueueEviction();
  expect(state.files.has("old.mp4")).toBe(true);
  expect(state.files.has("new.mp4")).toBe(false);
});
it("contains directory-creation failures from delayed index writes", async () => {
  state.mkdir.mockImplementation(() => {
    throw Error("disk unavailable");
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const pool = createDiskCachePool({ dirName: "fixture", budgetBytes: 10, isManaged: () => true });
  pool.touch("clip.mp4");
  await vi.advanceTimersByTimeAsync(250);
  expect(warning).toHaveBeenCalled();
});
