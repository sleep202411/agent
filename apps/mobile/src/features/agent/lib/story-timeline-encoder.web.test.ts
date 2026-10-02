import { afterEach, expect, it, vi } from "vitest";
import { createTimelineEncoder } from "./story-timeline-encoder.web";
const h = vi.hoisted(() => ({ file: vi.fn() }));
vi.mock("./story-timeline-export-browser", () => ({
  createBrowserTimelineEncoder: () => ({ file: h.file }),
}));
const artifact = { uri: "blob:owned", size: 4, contentType: "video/mp4" as const };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("downloads an encoder-owned file and releases only the download URL later", async () => {
  vi.useFakeTimers();
  const create = vi.fn(() => "blob:download"),
    revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const file = new File(["test"], "timeline.mp4", { type: "video/mp4" });
  h.file.mockReturnValue(file);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    expect(this.download).toBe("timeline.mp4");
    expect(this.href).toBe("blob:download");
  });
  await createTimelineEncoder().share(artifact, "timeline.mp4", () => true);
  expect(click).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(file);
  expect(document.querySelector("a")).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:download");
});
it("does not access a file after scope expiration", async () => {
  h.file.mockClear();
  await createTimelineEncoder().share(artifact, "timeline.mp4", () => false);
  expect(h.file).not.toHaveBeenCalled();
});
