// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AudioStudio } from "./audio-studio";
const state = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  historyError: null as string | null,
  refresh: vi.fn(),
  retry: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../../_components/generation/studio-composer", () => ({ StudioComposer: () => null }));
vi.mock("../../_components/generation/use-image-generation", () => ({
  useAudioGeneration: () => ({
    feed: {
      jobs: state.jobs,
      historyError: state.historyError,
      refreshHistory: state.refresh,
      retry: state.retry,
    },
    uploads: { remove: vi.fn() },
    submit: state.submit,
  }),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.jobs = [];
  state.historyError = null;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<AudioStudio />));
it("renders completed audio controls and a download using the accessible output URL", async () => {
  state.jobs = [
    {
      localId: "one",
      status: "done",
      prompt: "Rain",
      outputs: [{ id: "out", type: "audio", accessUrl: "/audio.wav" }],
    },
  ];
  await render();
  expect(container.querySelector("audio")?.controls).toBe(true);
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("/audio.wav");
  expect(container.querySelector("a[download]")?.getAttribute("href")).toBe("/audio.wav");
  expect(container.querySelector("img")).toBeNull();
});
it("reports missing outputs without automatically resubmitting a paid job", async () => {
  state.jobs = [{ localId: "one", status: "done", prompt: "Rain", outputs: [] }];
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("audio.noOutput");
  expect(state.submit).not.toHaveBeenCalled();
  expect(state.retry).not.toHaveBeenCalled();
});
it("offers a read-only history retry instead of an empty-state success", async () => {
  state.historyError = "History unavailable";
  await render();
  expect(container.textContent).toContain("History unavailable");
  expect(container.textContent).not.toContain("audio.emptyTitle");
  await act(async () => container.querySelector("button")!.click());
  expect(state.refresh).toHaveBeenCalledTimes(1);
  expect(state.submit).not.toHaveBeenCalled();
  expect(state.retry).not.toHaveBeenCalled();
});
it("retries a failed job only after an explicit click", async () => {
  state.jobs = [
    {
      localId: "one",
      status: "failed",
      prompt: "Rain",
      error: "Provider unavailable",
      outputs: [],
    },
  ];
  await render();
  expect(container.textContent).toContain("Provider unavailable");
  expect(state.retry).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(state.retry).toHaveBeenCalledWith(state.jobs[0]);
});
