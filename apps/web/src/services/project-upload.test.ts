import { afterEach, expect, it, vi } from "vitest";
import { uploadPersonalVideo } from "./project";
vi.mock("@/src/lib/api", () => ({ api: {} }));
afterEach(() => vi.unstubAllGlobals());
it("forwards video abort to fetch and discards cancelled response bodies", async () => {
  const controller = new AbortController();
  let resolveBody!: (body: unknown) => void;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      new Promise((resolve) => {
        resolveBody = resolve;
      }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const pending = uploadPersonalVideo(1, new File(["x"], "video.mp4"), controller.signal);
  await Promise.resolve();
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  controller.abort();
  resolveBody({ code: 200, data: "saved" });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    uploadPersonalVideo(1, new File([], "video.mp4"), controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("preserves the existing upload request and success result without a signal", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ code: 200, data: "saved" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const file = new File(["x"], "video.mp4");
  expect(await uploadPersonalVideo(7, file)).toBe("saved");
  const options = fetchMock.mock.calls[0][1];
  expect(options.credentials).toBe("include");
  expect(options.body.get("id")).toBe("7");
  expect(options.body.get("file")).toBe(file);
});
