import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasGenerationContext } from "@/features/ai-lab/panel";
import { StoryCanvasGenerationPanel } from "./story-canvas-generation-panel";
const h = vi.hoisted(() => ({
  project: vi.fn(),
  generation: 1,
  reader: null as null | { onResult(value: CanvasLoaded): void },
  composer: null as null | { canvas: CanvasGenerationContext; onBusyChange(value: boolean): void },
  beforeSubmit: vi.fn(),
  beforeRetry: vi.fn(),
  afterReceipt: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ background: "black" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/features/ai-lab/projects-api", () => ({ getStoryCanvasGenerationProject: h.project }));
vi.mock("@/features/ai-lab/panel", () => ({
  GenerationPanel: (props: NonNullable<typeof h.composer>) => {
    h.composer = props;
    return <span>Composer</span>;
  },
}));
vi.mock("./story-canvas-reader", () => ({
  StoryCanvasReader: (props: NonNullable<typeof h.reader>) => {
    h.reader = props;
    return null;
  },
}));
vi.mock("./use-canvas-submission-writer", () => ({
  useCanvasSubmissionWriter: () => ({
    beforeSubmit: h.beforeSubmit,
    beforeRetry: h.beforeRetry,
    afterReceipt: h.afterReceipt,
    bridge: null,
  }),
}));
const id = "11111111-1111-4111-8111-111111111111";
const scope = { projectId: id, documentId: id, generation: 1 };
const loaded = {
  documentId: id,
  snapshot: {
    nodes: {
      card: { id: "card", type: "prompt", data: { prompt: "Fresh lake", modelId: "model" } },
    },
  },
} as unknown as CanvasLoaded;
let root: Root, host: HTMLDivElement;
const close = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  h.generation = 1;
  h.reader = null;
  h.composer = null;
  h.project.mockResolvedValue({
    id,
    kind: "story",
    workspaceId: id,
    storyProjectId: id,
    title: "Story",
    canGenerate: true,
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(
      <StoryCanvasGenerationPanel
        scope={scope}
        userId="alice"
        nodeId="card"
        title="Lake card"
        close={close}
      />
    )
  );
it("loads fresh permission and card data before mounting the scoped composer", async () => {
  await render();
  expect(h.composer).toBeNull();
  await act(async () => h.reader!.onResult(loaded));
  expect(h.composer!.canvas).toMatchObject({
    documentId: id,
    nodeId: "card",
    mode: "image",
    seed: { prompt: "Fresh lake" },
    beforeSubmit: h.beforeSubmit,
    beforeRetry: h.beforeRetry,
    afterReceipt: h.afterReceipt,
  });
  expect(host.textContent).toContain("Lake card");
  await act(async () => h.composer!.onBusyChange(true));
  expect(host.querySelector("button")!.disabled).toBe(true);
  await act(async () => h.composer!.onBusyChange(false));
  await act(async () => host.querySelector("button")!.click());
  expect(close).toHaveBeenCalledOnce();
});
it("shows permission errors with retry and never opens a denied composer", async () => {
  h.project.mockResolvedValueOnce({ canGenerate: false });
  await render();
  expect(host.textContent).toContain("aiLab.projectReadOnly");
  expect(h.composer).toBeNull();
  await act(async () => host.querySelectorAll("button")[1]!.click());
  await act(async () => h.reader!.onResult(loaded));
  expect(h.composer).not.toBeNull();
});
it("rejects a changed document or locked card", async () => {
  await render();
  await act(async () => h.reader!.onResult({ ...loaded, documentId: "other" }));
  expect(host.textContent).toContain("document changed");
  expect(h.composer).toBeNull();
});

vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
