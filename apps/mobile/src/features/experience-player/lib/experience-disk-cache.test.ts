import { createDiskCachePool } from "./experience-disk-cache";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  files: new Map<string, { size: number; fail?: boolean; text?: string }>(),
  mkdir: vi.fn(),
  failList: false,
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
    write(text: string) {
      state.files.set(this.name, { ...state.files.get(this.name)!, text });
    }
    textSync() {
      return state.files.get(this.name)?.text ?? "{}";
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
      if (state.failList) throw new Error("Cannot list directory");
      return [...state.files.keys()].map((name) => new File(this, name));
    }
  }
  // Directory existence is separately configurable without changing the file model.
  Object.defineProperty(Directory.prototype, "exists", { get: () => state.files.size > 0 });
  return { File, Directory, Paths: { cache: "fixture" } };
});
beforeEach(() => {
  state.files.clear();
  state.failList = false;
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

it("releases the delayed flush when eviction flushes the index immediately", async () => {
  state.files.set("old.mp4", { size: 10 });
  state.files.set("new.mp4", { size: 10 });
  const pool = createDiskCachePool({
    dirName: "fixture",
    budgetBytes: 10,
    isManaged: (name) => name.endsWith(".mp4"),
  });
  pool.touch("new.mp4");
  expect(vi.getTimerCount()).toBe(1);
  await pool.enqueueEviction();
  expect(vi.getTimerCount()).toBe(0);
  pool.touch("new.mp4");
  expect(vi.getTimerCount()).toBe(1);
});

it("persists stale index removal even while the cache is below budget", async () => {
  state.files.set("access-index.json", { size: 1, text: JSON.stringify({ "gone.mp4": 1 }) });
  state.files.set("new.mp4", { size: 1 });
  const pool = createDiskCachePool({
    dirName: "fixture",
    budgetBytes: 10,
    isManaged: (name) => name.endsWith(".mp4"),
  });
  await pool.enqueueEviction();
  expect(JSON.parse(state.files.get("access-index.json")!.text!)).toEqual({});
});

it("retains access history when directory listing fails", async () => {
  state.files.set("new.mp4", { size: 1 });
  const pool = createDiskCachePool({
    dirName: "fixture",
    budgetBytes: 10,
    isManaged: (name) => name.endsWith(".mp4"),
  });
  pool.touch("new.mp4");
  state.failList = true;
  await pool.enqueueEviction();
  await vi.advanceTimersByTimeAsync(250);
  expect(JSON.parse(state.files.get("access-index.json")!.text!)).toHaveProperty("new.mp4");
});
