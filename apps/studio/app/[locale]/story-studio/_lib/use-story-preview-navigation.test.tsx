// @vitest-environment jsdom

import { NextIntlClientProvider } from "next-intl";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { useStoryPreviewNavigation } from "./use-story-preview-navigation";

const error = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error } }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string }) => `/${locale}${href}`,
}));

let host: HTMLDivElement, root: Root, hook: ReturnType<typeof useStoryPreviewNavigation>;
let previewWindow: {
  opener: unknown;
  closed: boolean;
  location: { replace: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
};

function Harness() {
  const value = useStoryPreviewNavigation("project-one");
  useLayoutEffect(() => {
    hook = value;
  });
  return null;
}

async function render(locale = "en-US") {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <Harness />
      </NextIntlClientProvider>
    );
  });
}

beforeEach(() => {
  error.mockReset();
  previewWindow = {
    opener: window,
    closed: false,
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(previewWindow as unknown as Window);
  useStoryProjectUiStore.setState({ activeChapterId: "chapter-one", draftBarrier: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStoryProjectUiStore.setState({ activeChapterId: null, draftBarrier: null });
  vi.restoreAllMocks();
});

describe("preview in a new tab", () => {
  it.each(["en-US", "zh-CN", "zh-HK"])(
    "keeps the editor URL and preserves the %s locale, chapter, and scene",
    async (locale) => {
      await render(locale);
      const editorUrl = window.location.href;
      await act(async () => hook.openPreviewFromScene("scene/two"));
      expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
      expect(previewWindow.opener).toBeNull();
      expect(previewWindow.location.replace).toHaveBeenCalledWith(
        `/${locale}/story-studio/projects/project-one/playtest?chapter=chapter-one&scene=scene%2Ftwo`
      );
      expect(window.location.href).toBe(editorUrl);
    }
  );

  it("reserves a tab synchronously and waits for the draft save before navigating", async () => {
    let saved!: () => void;
    const saving = new Promise<void>((resolve) => {
      saved = resolve;
    });
    useStoryProjectUiStore.setState({
      draftBarrier: async (submit) => {
        expect(window.open).toHaveBeenCalledTimes(1);
        await saving;
        return submit(7);
      },
    });
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = hook.openPreview();
    });
    expect(hook.pending).toBe(true);
    expect(previewWindow.location.replace).not.toHaveBeenCalled();
    await act(async () => hook.openPreview());
    expect(window.open).toHaveBeenCalledTimes(1);
    await act(async () => {
      saved();
      await opening;
    });
    expect(previewWindow.location.replace).toHaveBeenCalledWith(
      "/en-US/story-studio/projects/project-one/playtest?chapter=chapter-one"
    );
    expect(hook.pending).toBe(false);
  });

  it("closes the blank tab and shows the specific save failure", async () => {
    useStoryProjectUiStore.setState({
      draftBarrier: async () => {
        throw new Error("Resolve the draft conflict first.");
      },
    });
    await render();
    await act(async () => hook.openPreview());
    expect(previewWindow.close).toHaveBeenCalledOnce();
    expect(previewWindow.location.replace).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Resolve the draft conflict first.");
    expect(hook.pending).toBe(false);
  });

  it("reports a blocked tab without starting the draft save", async () => {
    const barrier = vi.fn();
    useStoryProjectUiStore.setState({ draftBarrier: barrier });
    vi.mocked(window.open).mockReturnValue(null);
    await render();
    await act(async () => hook.openPreview());
    expect(barrier).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(messages.storyStudio.canvas.workingPreview.popupBlocked);
    expect(hook.pending).toBe(false);
  });

  it("does not navigate a tab the creator closed while saving", async () => {
    useStoryProjectUiStore.setState({
      draftBarrier: async (submit) => {
        previewWindow.closed = true;
        return submit(7);
      },
    });
    await render();
    await act(async () => hook.openPreview());
    expect(previewWindow.location.replace).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(hook.pending).toBe(false);
  });
});
