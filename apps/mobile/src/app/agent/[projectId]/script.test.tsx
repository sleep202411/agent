import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Script from "./script";
const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  imported: undefined as (() => void) | undefined,
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/features/agent/context/story-chapter-context", () => ({
  useStoryChapterContext: () => ({
    projectId: "project-a",
    chapterId: "chapter-b",
    capabilities: ["story.edit"],
    loading: false,
    refresh: h.refresh,
  }),
}));
vi.mock("@/features/agent/components/story-script-editor", () => ({
  StoryScriptEditor: () => null,
}));
vi.mock("@/features/agent/components/story-plot-import", () => ({
  StoryPlotImportAction: ({ onImported }: { onImported: () => void }) => {
    h.imported = onImported;
    return null;
  },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: () => null }));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Pressable: () => null,
  View: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("opens the imported chapter's existing plot editor only after confirmed completion", async () => {
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Script />));
    expect(h.push).not.toHaveBeenCalled();
    await act(async () => h.imported!());
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(h.push).toHaveBeenCalledWith({
      pathname: "/agent/[projectId]/assets",
      params: { projectId: "project-a", chapterId: "chapter-b", mode: "story", graph: "1" },
    });
  } finally {
    await act(async () => root.unmount());
  }
});
