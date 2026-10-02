// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImageStudio } from "../../images/_components/image-studio";
import { VideoStudio } from "../../video/_components/video-studio";
const state = vi.hoisted(() => ({
  error: "History request failed",
  jobs: [] as Record<string, unknown>[],
  refresh: vi.fn(),
  submit: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("./studio-composer", () => ({ StudioComposer: () => null }));
vi.mock("./result-lightbox", () => ({ ResultLightbox: () => null }));
function controller() {
  return {
    feed: {
      historyError: state.error,
      jobs: state.jobs,
      refreshHistory: state.refresh,
      retry: state.retry,
    },
    uploads: { remove: vi.fn() },
    submit: state.submit,
  };
}
vi.mock("./use-image-generation", () => ({ useImageGeneration: () => controller() }));
vi.mock("./use-video-generation", () => ({ useVideoGeneration: () => controller() }));
it.each([
  ["image", ImageStudio],
  ["video", VideoStudio],
] as const)(
  "%s exposes a failed history read and retains existing results",
  async (_name, Component) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    state.error = "History request failed";
    state.jobs = [];
    const host = document.createElement("div"),
      root = createRoot(host);
    try {
      await act(async () => root.render(<Component />));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(state.error);
      expect(host.textContent).not.toContain("feed.startCreatingWith");
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click()
      );
      expect(state.refresh).toHaveBeenCalledTimes(1);
      expect(state.submit).not.toHaveBeenCalled();
      expect(state.retry).not.toHaveBeenCalled();
      state.jobs = [
        {
          localId: "one",
          input: {},
          status: "queued",
          prompt: "Existing job",
          outputs: [],
          stage: "queue",
          createdAtMs: Date.now(),
        },
      ];
      await act(async () => root.render(<Component />));
      expect(host.textContent).toContain("Existing job");
      expect(host.textContent).toContain(state.error);
      state.error = "";
      await act(async () => root.render(<Component />));
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.textContent).toContain("Existing job");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  }
);
