import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewModal } from "./media-preview-modal";
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./audio-player", () => ({ AudioPlayer: () => null }));
vi.mock("./mention-prompt-display", () => ({ MentionPromptDisplay: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    variant: _v,
    color: _c,
    ...p
  }: ComponentProps<"button"> & { variant?: string; color?: string }) => <button {...p} />,
}));
describe("media preview download", () => {
  let root: Root, container: HTMLDivElement;
  const create = vi.fn(),
    revoke = vi.fn(),
    fetcher = vi.fn(),
    open = vi.fn();
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    create.mockReset().mockReturnValue("blob:test");
    revoke.mockReset();
    fetcher.mockReset().mockResolvedValue(new Response("media"));
    open.mockReset();
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("open", open);
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      }
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <MediaPreviewModal
          open
          onOpenChange={() => {}}
          type="image"
          src="https://cdn.test/image.png"
          name="image.png"
        />
      )
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const download = async () => {
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "download")!
        .click()
    );
  };
  it("does not save an HTTP failure response as media", async () => {
    fetcher.mockResolvedValue(new Response("error", { status: 403 }));
    await download();
    expect(create).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "https://cdn.test/image.png",
      "_blank",
      "noopener,noreferrer"
    );
  });
  it("releases the temporary anchor and URL when clicking fails", async () => {
    vi.useFakeTimers();
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error("blocked");
    });
    await download();
    await vi.runAllTimersAsync();
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
  it("retains the blob briefly after a successful click", async () => {
    vi.useFakeTimers();
    await download();
    expect(revoke).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledWith("blob:test");
    expect(open).not.toHaveBeenCalled();
  });
});
