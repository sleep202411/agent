import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backendApi } from "@/src/lib/api";
import { store } from "@/src/store";
import { setTasks } from "@/src/store/slices/taskSlice";
import { submitImageTask } from "./ai-image-queue";
import { submitAudioTask } from "./ai-audio-queue";
import { submitFusionTask } from "./ai-fusion-queue";
import { submitLipSyncTask } from "./ai-lipsync-queue";
vi.mock("@/src/lib/api", () => ({
  backendApi: { post: vi.fn() },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/src/store", async () => {
  const { configureStore } = await import("@reduxjs/toolkit");
  const { taskSlice } = await import("@/src/store/slices/taskSlice");
  return { store: configureStore({ reducer: { task: taskSlice.reducer } }) };
});
const cases = [
  {
    name: "image",
    bad: [{}],
    good: "image.png",
    submit: () =>
      submitImageTask({ mode: "edit", prompt: "scene", shotId: "shot", shotColumnId: "image" }),
  },
  {
    name: "audio",
    bad: { storagePath: {} },
    good: { storagePath: "audio.mp3" },
    submit: () => submitAudioTask({ prompt: "voice", shotId: "shot", shotColumnId: "audio" }),
  },
  {
    name: "fusion",
    bad: { error: "missing media" },
    good: "fusion.png",
    submit: () =>
      submitFusionTask({
        prompt: "combine",
        worldRoleId: 1,
        characterImageUrl: "https://media.invalid/character",
        propImageUrls: [],
      }),
  },
  {
    name: "lip-sync",
    bad: { url: {} },
    good: { url: "video.mp4" },
    submit: () =>
      submitLipSyncTask({
        shotId: "shot",
        shotColumnId: "video",
        videoUrl: "https://media.invalid/video",
        audioUrl: "https://media.invalid/audio",
      }),
  },
];
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(backendApi.post).mockReset();
  store.dispatch(setTasks([]));
});
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(1000);
  vi.useRealTimers();
});
it.each(cases)(
  "rejects malformed $name output rather than completing with an object URL",
  async ({ bad, submit }) => {
    vi.mocked(backendApi.post).mockResolvedValue(bad);
    const id = submit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().task.tasks[id]?.status).toBe("failed");
    expect(store.getState().task.tasks[id]?.output).toBeUndefined();
  }
);
it.each(cases)("preserves valid $name output", async ({ good, submit }) => {
  vi.mocked(backendApi.post).mockResolvedValue(good);
  const id = submit();
  await vi.advanceTimersByTimeAsync(1000);
  expect(store.getState().task.tasks[id]?.status).toBe("completed");
  expect(store.getState().task.tasks[id]?.output?.storagePath).toBeTruthy();
});
it.each(cases)("rejects empty $name output", async ({ submit }) => {
  vi.mocked(backendApi.post).mockResolvedValue("  ");
  const id = submit();
  await vi.advanceTimersByTimeAsync(1000);
  expect(store.getState().task.tasks[id]?.status).toBe("failed");
});

it.each([
  { queue: 0, response: ["image.png"], path: "image.png" },
  { queue: 1, response: ["preview.png", "audio.mp3"], path: "audio.mp3" },
  { queue: 3, response: ["video.mp4"], path: "video.mp4" },
])("preserves existing array selection for queue $queue", async ({ queue, response, path }) => {
  vi.mocked(backendApi.post).mockResolvedValue(response);
  const id = cases[queue]!.submit();
  await vi.advanceTimersByTimeAsync(1000);
  expect(store.getState().task.tasks[id]?.output?.storagePath).toBe(path);
});
