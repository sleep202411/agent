import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewModal } from "./media-preview-modal";
const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: feedback }));
const language = vi.hoisted(() => ({ prefix: "" }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => {
    const prefix = language.prefix;
    return (key: string) => prefix + key;
  },
}));
vi.mock("./audio-player", () => ({ AudioPlayer: () => null }));
vi.mock("./mention-prompt-display", () => ({ MentionPromptDisplay: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: ComponentProps<"button">) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
describe("media preview download", () => {
  let root: Root, container: HTMLDivElement;
  const create = vi.fn(),
    revoke = vi.fn(),
    fetcher = vi.fn(),
    open = vi.fn();
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    language.prefix = "";
    feedback.success.mockReset();
    feedback.error.mockReset();
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
    delete (navigator as { clipboard?: unknown }).clipboard;
    delete (document as { execCommand?: unknown }).execCommand;
    document.querySelectorAll("textarea").forEach((el) => el.remove());
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
  it("aborts and ignores a download after replacing the preview", async () => {
    let resolve!: (r: Response) => void;
    fetcher.mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      })
    );
    await download();
    const signal = fetcher.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;
    await act(async () =>
      root.render(
        <MediaPreviewModal
          open
          onOpenChange={() => {}}
          type="image"
          src="https://cdn.test/new.png"
        />
      )
    );
    await act(async () => resolve(new Response("old media")));
    expect(signal?.aborted).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it("does not close a replacement preview when an old deletion finishes", async () => {
    let resolve!: () => void;
    const remove = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const close = vi.fn();
    await act(async () =>
      root.render(
        <MediaPreviewModal open onOpenChange={close} type="image" src="first" onDelete={remove} />
      )
    );
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "delete")!
        .click()
    );
    await act(async () =>
      root.render(
        <MediaPreviewModal open onOpenChange={close} type="image" src="second" onDelete={remove} />
      )
    );
    await act(async () => resolve());
    expect(close).not.toHaveBeenCalled();
  });
  it("admits one custom download per pending operation", async () => {
    let resolve!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    await act(async () =>
      root.render(
        <MediaPreviewModal
          open
          onOpenChange={() => {}}
          type="image"
          src="first"
          onDownload={save}
        />
      )
    );
    await act(async () => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "download"
      )!;
      button.click();
      button.click();
    });
    await act(async () => resolve());
    expect(save).toHaveBeenCalledOnce();
  });
  it("allows deletion retry after an active callback rejects", async () => {
    const close = vi.fn();
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("Try again"))
      .mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        <MediaPreviewModal open onOpenChange={close} type="image" src="first" onDelete={remove} />
      )
    );
    const click = () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "delete")!
        .click();
    await act(async () => click());
    expect(close).not.toHaveBeenCalled();
    await act(async () => click());
    expect(remove).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith(false);
  });
  it("offers manual copy when the fallback command returns false", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "copyLink")!
        .click()
    );
    expect(feedback.success).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });
  it("removes the fallback textarea even when copying throws", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("blocked");
      }),
    });
    vi.spyOn(window, "prompt").mockReturnValue(null);
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "copyLink")!
        .click()
    );
    expect(document.querySelector("textarea")).toBeNull();
  });
  it("does not open manual copy after the preview is replaced", async () => {
    let reject!: (e: Error) => void;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(
          () =>
            new Promise((_, r) => {
              reject = r;
            })
        ),
      },
    });
    const command = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", { configurable: true, value: command });
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "copyLink")!
        .click()
    );
    await act(async () =>
      root.render(<MediaPreviewModal open onOpenChange={() => {}} type="image" src="second" />)
    );
    await act(async () => reject(new Error("abandoned")));
    expect(command).not.toHaveBeenCalled();
    expect(feedback.success).not.toHaveBeenCalled();
  });
  it("refreshes the fallback media name when the language changes", async () => {
    const render = () =>
      root.render(<MediaPreviewModal open onOpenChange={() => {}} type="image" src="same" />);
    await act(async () => render());
    expect(document.querySelector("img")?.alt).toBe("imagePreview");
    language.prefix = "translated:";
    await act(async () => render());
    expect(document.querySelector("img")?.alt).toBe("translated:imagePreview");
  });
  it("preserves an explicit media name across language changes", async () => {
    language.prefix = "translated:";
    await act(async () =>
      root.render(
        <MediaPreviewModal open onOpenChange={() => {}} type="image" src="same" name=" My file " />
      )
    );
    expect(document.querySelector("img")?.alt).toBe("My file");
  });
});
