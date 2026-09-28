// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryClipDetailDialog } from "./story-clip-detail-dialog";
import type { StoryStoryboardClip } from "@/lib/story-production-api";

const mocks = vi.hoisted(() => ({
  account: "alice",
  generate: vi.fn(),
  patch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: mocks.account },
    isCurrentAccount: (id: string) => id === mocks.account,
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/story-production-api", async (original) => ({
  ...(await original<typeof import("@/lib/story-production-api")>()),
  createStoryStoryboardClipGeneration: mocks.generate,
  patchStoryStoryboardClip: mocks.patch,
}));
vi.mock("./use-story-production-generation-defaults", () => ({
  useStoryProductionGenerationDefaults: () => ({ models: [] }),
}));
vi.mock("./story-prompt-composer", () => ({
  useStoryAssetMentions: () => [],
  StoryPromptComposer: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/ui/dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrap,
    DialogContent: Wrap,
    DialogDescription: Wrap,
    DialogFooter: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
  };
});
const clip: StoryStoryboardClip = {
  id: "clip",
  stableKey: "clip-1",
  title: "Clip",
  rank: 0,
  kind: "image",
  track: "main",
  startMs: 0,
  durationMs: 1000,
  description: null,
  imagePrompt: "Original",
  videoPrompt: null,
  negativePrompt: null,
  generationConfig: {},
  status: "current",
  version: 1,
  selectedMediaVersionId: null,
  selectedMediaVersion: null,
  mediaVersions: [],
  latestGeneration: null,
  userModifiedAt: null,
  assetBindings: [],
};
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const close = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "alice";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
const render = (open = true, editable = true) =>
  root.render(
    <QueryClientProvider client={client}>
      <StoryClipDetailDialog
        clip={clip}
        sequenceId="sequence"
        projectId="project"
        chapterId="chapter"
        open={open}
        editable={editable}
        onOpenChange={close}
      />
    </QueryClientProvider>
  );
const generate = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "generate")!;

it.each(["active", "account", "closed", "readonly", "unmount", "failure", "stale-failure"])(
  "owns duplicate admission and %s completion",
  async (mode) => {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    mocks.generate.mockReturnValue(
      new Promise<void>((a, b) => {
        resolve = a;
        reject = b;
      })
    );
    await act(async () => render());
    await act(async () => {
      generate().click();
      generate().click();
    });
    expect(mocks.generate).toHaveBeenCalledOnce();
    await act(async () => {
      if (mode === "account" || mode === "stale-failure") {
        mocks.account = "bob";
        render();
      }
      if (mode === "closed") render(false);
      if (mode === "readonly") render(true, false);
      if (mode === "unmount") root.render(null);
    });
    await act(async () => {
      if (mode.includes("failure")) reject(new Error("Failed"));
      else resolve();
    });
    expect(mocks.success).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(close).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(mocks.error).toHaveBeenCalledTimes(mode === "failure" ? 1 : 0);
    if (mode === "failure") {
      mocks.generate.mockResolvedValue(undefined);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await act(async () => generate().click());
      expect(mocks.generate).toHaveBeenCalledTimes(2);
      expect(mocks.success).toHaveBeenCalledOnce();
    }
  }
);

it("does not generate after closing during prompt persistence", async () => {
  let resolve!: (value: StoryStoryboardClip) => void;
  mocks.patch.mockReturnValue(
    new Promise<StoryStoryboardClip>((r) => {
      resolve = r;
    })
  );
  await act(async () => render());
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Changed"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => generate().click());
  expect(mocks.patch).toHaveBeenCalledOnce();
  await act(async () => render(false));
  await act(async () => resolve({ ...clip, imagePrompt: "Changed", version: 2 }));
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
