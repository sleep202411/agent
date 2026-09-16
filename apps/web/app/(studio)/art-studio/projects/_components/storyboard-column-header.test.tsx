import { act, type ReactNode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  project: "first",
  active: false,
  confirm: undefined as undefined | ((config: { model: string; voiceId: string }) => void),
  post: vi.fn(),
  dispatch: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://cdn.test" } }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: h.post } }));
vi.mock("sonner", () => ({
  toast: { success: h.success, error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/src/store", () => ({
  store: { getState: () => ({ project: { currentProjectId: h.project } }), dispatch: h.dispatch },
  useAppSelector: (fn: (s: unknown) => unknown) => fn({ project: { currentProjectId: h.project } }),
  useAppDispatch: () => h.dispatch,
}));
vi.mock("@/src/store/slices/projectSlice", () => ({
  selectCurrentInstance: () => ({
    rows: [
      { shotId: "one", shotValues: [{ presetColumnKey: "dialogue", value: "Hello" }] },
      { shotId: "two", shotValues: [{ presetColumnKey: "dialogue", value: "World" }] },
    ],
    columns: [],
    detail: {},
    batchGeneratingActive: h.active,
  }),
  setBatchGeneratingActive: (payload: unknown) => ({ type: "active", payload }),
  setBatchGenerating: (payload: unknown) => ({ type: "generating", payload }),
  setBatchCompleted: (payload: unknown) => ({ type: "completed", payload }),
  clearBatchGenerating: (payload?: string) => ({ type: "clear", payload }),
  touchStoryboard: () => ({ type: "touch" }),
}));
vi.mock("./storyboard-batch-generate-dialog", () => ({
  StoryboardBatchGenerateDialog: () => null,
}));
vi.mock("./storyboard-batch-voice-dialog", () => ({
  StoryboardBatchVoiceDialog: (p: { onConfirm: typeof h.confirm }) => {
    h.confirm = p.onConfirm;
    return null;
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: ComponentProps<"button">) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: () => null }));
vi.mock("@/components/ui/dialog", () =>
  Object.fromEntries(
    [
      "Dialog",
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogHeader",
      "DialogTitle",
    ].map((k) => [k, () => null])
  )
);
vi.mock("@/components/ui/tooltip", () =>
  Object.fromEntries(
    ["Tooltip", "TooltipContent", "TooltipTrigger"].map((k) => [
      k,
      ({ children }: { children: ReactNode }) => <>{children}</>,
    ])
  )
);
vi.mock("@/components/ui/field", () =>
  Object.fromEntries(["Field", "FieldLabel", "FieldDescription"].map((k) => [k, () => null]))
);
import { StoryboardColumnHeader } from "./storyboard-column-header";
let root: Root, container: HTMLDivElement;
const column = { id: "voice", presetColumnKey: "sound_path" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  h.project = "first";
  h.active = false;
  h.post.mockReset();
  h.success.mockReset();
  h.dispatch.mockReset().mockImplementation((a) => {
    if (a.type === "active") h.active = a.payload;
    if (a.type === "clear" && (!a.payload || a.payload === h.project)) h.active = false;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  container.remove();
});
it("does not clear a batch owned by another column on unmount", async () => {
  await act(async () => root.render(<StoryboardColumnHeader column={column} />));
  h.active = true;
  h.dispatch.mockClear();
  await act(async () => root.render(null));
  expect(h.dispatch).not.toHaveBeenCalled();
});
it("stops old generation feedback and requests after project replacement", async () => {
  let resolve!: (v: unknown) => void;
  h.post
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    )
    .mockResolvedValue({});
  await act(async () => root.render(<StoryboardColumnHeader column={column} />));
  await act(async () => document.querySelector("button")!.click());
  act(() => {
    h.confirm!({ model: "voice-model", voiceId: "voice" });
  });
  h.project = "second";
  await act(async () => root.render(<StoryboardColumnHeader column={column} />));
  h.active = true;
  h.dispatch.mockClear();
  await act(async () => {
    resolve({});
    await vi.runAllTimersAsync();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.active).toBe(true);
});

it("keeps a replacement batch active when the cancelled request finishes", async () => {
  let oldResolve!: (v: unknown) => void, newResolve!: (v: unknown) => void;
  h.post
    .mockReturnValueOnce(
      new Promise((r) => {
        oldResolve = r;
      })
    )
    .mockReturnValueOnce(
      new Promise((r) => {
        newResolve = r;
      })
    )
    .mockResolvedValue({});
  await act(async () => root.render(<StoryboardColumnHeader column={column} />));
  await act(async () => document.querySelector("button")!.click());
  act(() => h.confirm!({ model: "voice-model", voiceId: "voice" }));
  const oldSignal = h.post.mock.calls[0]![1].signal as AbortSignal;
  h.active = false;
  act(() => h.confirm!({ model: "voice-model", voiceId: "voice" }));
  expect(oldSignal.aborted).toBe(true);
  h.dispatch.mockClear();
  await act(async () => {
    oldResolve({});
    await vi.runAllTimersAsync();
  });
  expect(h.active).toBe(true);
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(h.post).toHaveBeenCalledTimes(2);
  await act(async () => {
    newResolve({});
    await vi.runAllTimersAsync();
  });
  expect(h.post).toHaveBeenCalledTimes(3);
  expect(h.success).toHaveBeenCalledTimes(1);
  expect(h.active).toBe(false);
});
it("retains valid batch spacing and refuses duplicate confirmation", async () => {
  h.post.mockResolvedValue({});
  await act(async () => root.render(<StoryboardColumnHeader column={column} />));
  await act(async () => document.querySelector("button")!.click());
  await act(async () => {
    h.confirm!({ model: "voice-model", voiceId: "voice" });
    h.confirm!({ model: "voice-model", voiceId: "voice" });
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(9999));
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.success).toHaveBeenCalledTimes(1);
});
it("releases the pending inter-item delay when departing", async () => {
  h.post.mockResolvedValue({});
  await act(async () => root.render(<StoryboardColumnHeader column={column} />));
  await act(async () => document.querySelector("button")!.click());
  await act(async () => h.confirm!({ model: "voice-model", voiceId: "voice" }));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.success).not.toHaveBeenCalled();
});
