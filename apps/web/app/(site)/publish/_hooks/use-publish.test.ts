import { afterEach, expect, it, vi } from "vitest";
import { useUploadPersonalCover, useUploadPersonalVideoFile } from "./use-publish";
import { uploadPersonalVideo } from "@/src/services/project";
import { notifyUnauthorized } from "@/src/lib/api";
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }),
}));
vi.mock("@/src/hooks/use-tag-list", () => ({}));
vi.mock("@/src/services/project", () => ({ uploadPersonalVideo: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ notifyUnauthorized: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
it("forwards cancellation to video uploads and rejects already cancelled starts", async () => {
  const controller = new AbortController();
  vi.mocked(uploadPersonalVideo).mockResolvedValue("saved");
  const mutation = useUploadPersonalVideoFile();
  await mutation.mutateAsync({ personalId: 1, file, signal: controller.signal });
  expect(uploadPersonalVideo).toHaveBeenCalledWith(1, file, controller.signal);
  controller.abort();
  await expect(
    mutation.mutateAsync({ personalId: 1, file, signal: controller.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(uploadPersonalVideo).toHaveBeenCalledTimes(1);
});
it("does not interpret arbitrary provider messages containing 401 as session expiry", async () => {
  vi.mocked(uploadPersonalVideo).mockRejectedValue(new Error("File 4012 cannot be processed"));
  await expect(useUploadPersonalVideoFile().mutateAsync({ personalId: 1, file })).rejects.toThrow(
    "4012"
  );
  expect(notifyUnauthorized).not.toHaveBeenCalled();
});
it("rejects HTTP cover failures even when their body resembles success", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ code: 200, path: "wrong" }), { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(useUploadPersonalCover().mutateAsync({ personalId: 1, file })).rejects.toThrow(
    "HTTP 500"
  );
});
it("rejects cover completion after cancellation during response reading", async () => {
  const controller = new AbortController();
  let resolveBody!: (body: unknown) => void;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      new Promise((resolve) => {
        resolveBody = resolve;
      }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const pending = useUploadPersonalCover().mutateAsync({
    personalId: 1,
    file,
    signal: controller.signal,
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  controller.abort();
  resolveBody({ code: 200, path: "saved" });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
