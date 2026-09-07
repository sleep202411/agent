// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireVideoPoster } from "./video-poster";

let videos: HTMLVideoElement[];
beforeEach(() => {
  videos = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
    const element = create(tag, options);
    if (tag === "video") {
      videos.push(element as HTMLVideoElement);
      Object.defineProperties(element, {
        videoWidth: { value: 1280 },
        videoHeight: { value: 720 },
      });
    }
    return element;
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,poster"
  );
});
afterEach(() => vi.restoreAllMocks());
it("bounds extraction to two decoders, shares duplicate requests and cancels queued work", async () => {
  const requests = Array.from({ length: 100 }, (_, index) =>
    acquireVideoPoster(`https://cdn.test/pool-${index}.mp4`)
  );
  const settled = Promise.allSettled(requests.map((request) => request.promise));
  const duplicate = acquireVideoPoster("https://cdn.test/pool-0.mp4");
  expect(duplicate.promise).toBe(requests[0].promise);
  expect(videos).toHaveLength(2);
  videos[0].dispatchEvent(new Event("loadeddata"));
  await expect(duplicate.promise).resolves.toMatchObject({ width: 1280, height: 720 });
  expect(videos[0].hasAttribute("src")).toBe(false);
  duplicate.release();
  requests.forEach((request) => request.release());
  await settled;
  expect(videos.every((video) => !video.hasAttribute("src"))).toBe(true);
  const before = videos.length;
  const cached = acquireVideoPoster("https://cdn.test/pool-0.mp4");
  await cached.promise;
  expect(videos).toHaveLength(before);
  cached.release();
});
