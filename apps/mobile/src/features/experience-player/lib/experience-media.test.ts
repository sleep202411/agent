import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { resolvePlayableMediaUrl } from "./experience-media";
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (uri: string) => uri }));
const fetchMock = vi.fn();
let index = 0;
const uri = () =>
  `https://fixture.invalid/aurora/story-projects/project/builds/${++index}/assets/clip/content`;
const response = (url: string) => ({
  ok: true,
  status: 206,
  url,
  body: { cancel: () => Promise.resolve() },
});
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("rejects cancelled callers before using direct or cached URLs", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolvePlayableMediaUrl("https://fixture.invalid/direct.mp4", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps shared transport alive when one caller cancels", async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const address = uri();
  const first = new AbortController();
  const second = new AbortController();
  const a = resolvePlayableMediaUrl(address, first.signal);
  const b = resolvePlayableMediaUrl(address, second.signal);
  const cancelled = expect(a).rejects.toMatchObject({ name: "AbortError" });
  first.abort();
  await cancelled;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  finish(response("https://cdn.invalid/clip.mp4"));
  await expect(b).resolves.toBe("https://cdn.invalid/clip.mp4");
});
it("aborts the last owner and preserves replacement work from delayed cleanup", async () => {
  const finishes: ((value: unknown) => void)[] = [];
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      })
  );
  const address = uri();
  const controller = new AbortController();
  const first = resolvePlayableMediaUrl(address, controller.signal);
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await cancelled;
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  const second = resolvePlayableMediaUrl(address);
  finishes[0](response("https://cdn.invalid/old.mp4"));
  await Promise.resolve();
  await Promise.resolve();
  const joined = resolvePlayableMediaUrl(address);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  finishes[1](response("https://cdn.invalid/new.mp4"));
  await expect(second).resolves.toBe("https://cdn.invalid/new.mp4");
  await expect(joined).resolves.toBe("https://cdn.invalid/new.mp4");
  await expect(resolvePlayableMediaUrl(address)).resolves.toBe("https://cdn.invalid/new.mp4");
});
