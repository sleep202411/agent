import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ensureMediaCached } from "./experience-media-cache";
const state = vi.hoisted(() => ({
  download: vi.fn(),
  touch: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
  protectedNames: undefined as undefined | (() => ReadonlySet<string>),
}));
vi.mock("expo-file-system", () => ({ File: { downloadFileAsync: state.download } }));
vi.mock("@/hooks/app-active", () => ({ subscribeAppActive: () => () => {} }));
vi.mock("./experience-media", () => ({
  absolutizeExperienceMediaUri: (uri: string) => uri,
  resolvePlayableMediaUrl: (uri: string) => Promise.resolve(uri),
}));
vi.mock("./experience-disk-cache", () => ({
  deleteQuietly: state.remove,
  createDiskCachePool: (options: { protectedFileNames: () => ReadonlySet<string> }) => {
    state.protectedNames = options.protectedFileNames;
    return {
      ensureDirectory: () => {},
      touch: state.touch,
      enqueueEviction: () => Promise.resolve(),
      file: (name: string) => ({ name, uri: `file://${name}`, exists: false, size: 0 }),
    };
  },
}));
let serial = 0;
const source = () => `https://fixture.invalid/${++serial}.mp4`;
const output = () => ({ exists: true, size: 12, move: state.move });
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.move.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
it("rejects pre-cancelled downloads before resolving or downloading", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(ensureMediaCached(source(), { signal: controller.signal })).rejects.toThrow(
    "cancelled"
  );
  expect(state.download).not.toHaveBeenCalled();
});
it("does not publish a native download that finishes after cancellation", async () => {
  let finish!: (value: unknown) => void;
  state.download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const controller = new AbortController();
  const pending = ensureMediaCached(source(), { signal: controller.signal });
  const assertion = expect(pending).rejects.toThrow("cancelled");
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  finish(output());
  await assertion;
  expect(state.move).not.toHaveBeenCalled();
  expect(state.touch).not.toHaveBeenCalled();
});
it("ignores late native progress after cleanup", async () => {
  state.download.mockResolvedValueOnce(output());
  const progress = vi.fn();
  await ensureMediaCached(source(), { onProgress: progress });
  const count = progress.mock.calls.length;
  state.download.mock.calls[0][2].onProgress({ bytesWritten: 10, totalBytes: 12 });
  expect(progress).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});
it("serializes a replacement behind a cancelled asynchronous publication", async () => {
  let finishMove!: () => void;
  state.move.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishMove = resolve;
      })
  );
  state.download.mockResolvedValue(output());
  const uri = source();
  const controller = new AbortController();
  const old = ensureMediaCached(uri, { signal: controller.signal });
  const assertion = expect(old).rejects.toThrow("cancelled");
  await vi.advanceTimersByTimeAsync(0);
  expect(state.move).toHaveBeenCalledTimes(1);
  controller.abort();
  const replacement = ensureMediaCached(uri);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.move).toHaveBeenCalledTimes(1);
  finishMove();
  await assertion;
  await expect(replacement).resolves.toMatch(/^file:/);
  expect(state.move).toHaveBeenCalledTimes(2);
  expect(state.touch).toHaveBeenCalledTimes(1);
});

it("keeps a shared download alive for another caller and retires only abandoned progress", async () => {
  let finish!: (value: unknown) => void;
  state.download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const uri = source();
  const firstController = new AbortController();
  const firstProgress = vi.fn();
  const secondProgress = vi.fn();
  const first = ensureMediaCached(uri, {
    signal: firstController.signal,
    onProgress: firstProgress,
  });
  const cancelled = expect(first).rejects.toThrow("cancelled");
  const second = ensureMediaCached(uri, { onProgress: secondProgress });
  await vi.advanceTimersByTimeAsync(0);
  firstController.abort();
  await cancelled;
  const native = state.download.mock.calls[0][2];
  expect(native.signal.aborted).toBe(false);
  native.onProgress({ bytesWritten: 6, totalBytes: 12 });
  expect(firstProgress).not.toHaveBeenCalled();
  expect(secondProgress).toHaveBeenCalledWith(0.5);
  finish(output());
  await expect(second).resolves.toMatch(/^file:/);
  expect(state.download).toHaveBeenCalledTimes(1);
});

it("releases a cancelled playback wait without cancelling another download owner", async () => {
  const { resolvePlaybackUri } = await import("./experience-media-cache");
  let finish!: (value: unknown) => void;
  state.download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const uri = source();
  const preload = ensureMediaCached(uri);
  await vi.advanceTimersByTimeAsync(0);
  state.download.mock.calls[0][2].onProgress({ bytesWritten: 7, totalBytes: 12 });
  const controller = new AbortController();
  const playback = resolvePlaybackUri(uri, controller.signal);
  const cancelled = expect(playback).rejects.toThrow("cancelled");
  controller.abort();
  await cancelled;
  expect(state.download.mock.calls[0][2].signal.aborted).toBe(false);
  finish(output());
  await preload;
});

it("protects both staging files until an abandoned native transfer actually settles", async () => {
  let finishOld!: (value: unknown) => void;
  let finishNew!: (value: unknown) => void;
  state.download
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        })
    );
  const uri = source();
  const controller = new AbortController();
  const old = ensureMediaCached(uri, { signal: controller.signal });
  const cancelled = expect(old).rejects.toThrow("cancelled");
  await vi.advanceTimersByTimeAsync(0);
  const oldName = state.download.mock.calls[0][1].name;
  controller.abort();
  await cancelled;
  const replacement = ensureMediaCached(uri);
  await vi.advanceTimersByTimeAsync(0);
  const newName = state.download.mock.calls[1][1].name;
  expect(state.protectedNames!().has(oldName)).toBe(true);
  expect(state.protectedNames!().has(newName)).toBe(true);
  finishOld(output());
  await vi.advanceTimersByTimeAsync(0);
  expect(state.protectedNames!().has(oldName)).toBe(false);
  expect(state.protectedNames!().has(newName)).toBe(true);
  finishNew(output());
  await replacement;
});
