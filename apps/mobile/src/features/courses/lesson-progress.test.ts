import { beforeEach, expect, it, vi } from "vitest";
import type { VideoPlayer } from "expo-video";
import {
  lessonProgressKey,
  readLessonProgress,
  saveLessonProgress,
  trackLessonProgress,
} from "./lesson-progress";
const h = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/persistent-storage", () => ({ getStoredString: h.get, setStoredString: h.set }));
beforeEach(() => {
  vi.resetAllMocks();
  h.set.mockResolvedValue(undefined);
});
function player() {
  const events = new Map<string, (value: any) => void>();
  const mock = {
    duration: 100,
    currentTime: 0,
    status: "readyToPlay",
    timeUpdateEventInterval: 0,
    addListener: vi.fn((name: string, listener: (value: any) => void) => {
      events.set(name, listener);
      return { remove: () => events.delete(name) };
    }),
  };
  return {
    mock,
    native: mock as unknown as VideoPlayer,
    emit: (name: string, value = {}) => events.get(name)?.(value),
    events,
  };
}
it("isolates account, region, course and lesson with SecureStore-safe keys", () => {
  const keys = [
    lessonProgressKey(null, "global", 1, 2),
    lessonProgressKey("guest", "global", 1, 2),
    lessonProgressKey("用户/1", "global", 1, 2),
    lessonProgressKey("用户/1", "cn", 1, 2),
    lessonProgressKey("用户/1", "global", 2, 2),
    lessonProgressKey("用户/1", "global", 1, 3),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  for (const key of keys) expect(key).toMatch(/^[\w.-]+$/);
});
it.each([
  "broken",
  "null",
  '{"currentTime":-1,"duration":100}',
  '{"currentTime":101,"duration":100}',
  '{"currentTime":"12","duration":100}',
  '{"currentTime":1,"duration":0}',
])("ignores invalid progress %s", async (raw) => {
  h.get.mockResolvedValue(raw);
  expect(await readLessonProgress("invalid")).toBeNull();
});
it("tolerates storage failure for both restore and save", async () => {
  h.get.mockRejectedValue(new Error("Unavailable"));
  h.set.mockRejectedValue(new Error("Full"));
  expect(await readLessonProgress("failure")).toBeNull();
  await expect(
    saveLessonProgress("failure", { currentTime: 2, duration: 100 })
  ).resolves.toBeUndefined();
});
it("restores once when media is ready and clamps against the current duration", async () => {
  const p = player();
  p.mock.status = "loading";
  p.mock.duration = 0;
  const stop = trackLessonProgress(p.native, "restore", { currentTime: 120, duration: 200 });
  expect(p.mock.currentTime).toBe(0);
  p.mock.status = "readyToPlay";
  p.mock.duration = 80;
  p.emit("sourceLoad", { duration: 80 });
  expect(p.mock.currentTime).toBe(79);
  p.mock.currentTime = 20;
  p.emit("statusChange", { status: "readyToPlay" });
  expect(p.mock.currentTime).toBe(20);
  stop();
  await readLessonProgress("restore");
  expect(p.events.size).toBe(0);
});
it("flushes the latest position on pause and exit without letting late events overwrite it", async () => {
  const p = player();
  const stop = trackLessonProgress(p.native, "flush", null);
  p.mock.currentTime = 12;
  p.emit("playingChange", { isPlaying: false });
  await readLessonProgress("flush");
  expect(h.set).toHaveBeenLastCalledWith(
    "flush",
    JSON.stringify({ currentTime: 12, duration: 100 })
  );
  const late = p.events.get("timeUpdate")!;
  p.mock.currentTime = 19;
  stop();
  p.mock.currentTime = 0;
  late({});
  await readLessonProgress("flush");
  expect(h.set).toHaveBeenLastCalledWith(
    "flush",
    JSON.stringify({ currentTime: 19, duration: 100 })
  );
});
it("does not replace valid progress with a player's error reset", async () => {
  const p = player();
  const stop = trackLessonProgress(p.native, "error", null);
  p.mock.currentTime = 25;
  p.emit("timeUpdate");
  p.mock.status = "error";
  p.mock.currentTime = 0;
  stop();
  await readLessonProgress("error");
  expect(h.set).toHaveBeenLastCalledWith(
    "error",
    JSON.stringify({ currentTime: 25, duration: 100 })
  );
});
it("orders writes and waits for a final save before restoring a remounted lesson", async () => {
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  let persisted = "";
  h.set
    .mockImplementationOnce(() => first)
    .mockImplementationOnce(async (_key, value) => {
      persisted = value;
    });
  h.get.mockImplementation(async () => persisted);
  const a = saveLessonProgress("queued", { currentTime: 1, duration: 100 });
  const b = saveLessonProgress("queued", { currentTime: 50, duration: 100 });
  const read = readLessonProgress("queued");
  await Promise.resolve();
  expect(h.set).toHaveBeenCalledTimes(1);
  expect(h.get).not.toHaveBeenCalled();
  release();
  await Promise.all([a, b]);
  // Both writes must complete before the queued read reaches storage.
  expect(h.set.mock.calls.map((call) => JSON.parse(call[1]).currentTime)).toEqual([1, 50]);
  expect(await read).toEqual({ currentTime: 50, duration: 100 });
});
it("throttles periodic storage writes but flushes on exit", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
  const p = player();
  const stop = trackLessonProgress(p.native, "throttle", null);
  expect(p.mock.timeUpdateEventInterval).toBe(1);
  try {
    p.mock.currentTime = 10;
    p.emit("timeUpdate");
    await readLessonProgress("throttle");
    for (let i = 1; i < 5; i++) {
      clock.mockReturnValue(10000 + i * 1000);
      p.mock.currentTime++;
      p.emit("timeUpdate");
    }
    await readLessonProgress("throttle");
    expect(h.set).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(15000);
    p.mock.currentTime = 15;
    p.emit("timeUpdate");
    await readLessonProgress("throttle");
    expect(h.set).toHaveBeenCalledTimes(2);
    p.mock.currentTime = 16;
    stop();
    await readLessonProgress("throttle");
    expect(h.set).toHaveBeenLastCalledWith(
      "throttle",
      JSON.stringify({ currentTime: 16, duration: 100 })
    );
  } finally {
    clock.mockRestore();
  }
});
