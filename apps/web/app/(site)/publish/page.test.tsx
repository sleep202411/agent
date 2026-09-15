import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PublishPage from "./page";
const s = vi.hoisted(() => ({
  user: "a",
  create: vi.fn(),
  upload: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: s.replace }) }));
vi.mock("sonner", () => ({ toast: { success: s.toast, error: s.toast, warning: s.toast } }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("./_hooks/use-publish", () => ({
  useTagList: () => ({ data: [] }),
  useCreatePersonalVideo: () => ({ mutateAsync: s.create }),
  useUpdatePersonalVideo: () => ({ mutateAsync: vi.fn() }),
  useUploadPersonalVideoFile: () => ({ mutateAsync: s.upload }),
  useUploadPersonalCover: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("./_components/basic-info-form", () => ({
  BasicInfoForm: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button onClick={() => onChange({ title: "Title", description: "Description", tagIds: [1] })}>
      Fill
    </button>
  ),
}));
vi.mock("./_components/video-upload-step", () => ({
  VideoUploadStep: ({ onPickVideo }: { onPickVideo: (file: File) => void }) => (
    <button onClick={() => onPickVideo(new File(["x"], "clip.mp4"))}>Upload</button>
  ),
}));
let root: Root;
let node: HTMLDivElement;
async function render() {
  await act(async () => root.render(<PublishPage />));
}
function button(text: string) {
  return [...node.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.create.mockReset().mockResolvedValue({ id: 1 });
  s.upload.mockReset().mockResolvedValue("saved");
  s.toast.mockClear();
  s.replace.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("guards duplicate creation and ignores replaced account completion", async () => {
  let resolve!: (value: { id: number }) => void;
  s.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await click("Fill");
  await act(async () => {
    button("nextStep").click();
    button("nextStep").click();
  });
  expect(s.create).toHaveBeenCalledTimes(1);
  s.user = "b";
  await render();
  await act(async () => resolve({ id: 1 }));
  expect(button("Fill")).toBeDefined();
  expect(button("Upload")).toBeUndefined();
});
it("aborts uploads and suppresses abandoned feedback and previews", async () => {
  let resolve!: () => void;
  s.upload.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await click("Fill");
  await click("nextStep");
  await click("Upload");
  const signal = s.upload.mock.calls[0][0].signal as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve());
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(s.toast).not.toHaveBeenCalled();
});
it("releases previews and cancels deferred navigation on departure", async () => {
  await render();
  await click("Fill");
  await click("nextStep");
  await click("Upload");
  vi.useFakeTimers();
  await click("publish");
  s.user = "b";
  await render();
  await act(async () => vi.advanceTimersByTime(1500));
  expect(s.replace).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
