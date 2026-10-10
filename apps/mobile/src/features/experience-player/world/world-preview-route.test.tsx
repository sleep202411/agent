import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StoryPreviewScreen from "@/app/play/story-preview/[projectId]";
import { worldManifestFixture } from "./__fixtures__/world-manifest";
const h = vi.hoisted(() => ({
  generation: 1,
  status: "authenticated",
  preview: vi.fn(),
  get: vi.fn(),
  props: null as any,
  t: (k: string) => k,
  projectId: "21111111-1111-4111-8111-111111111111",
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ status: h.status, generation: h.generation }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/features/agent/api/story-working-preview-api", () => ({
  getStoryWorkingPreview: h.preview,
}));
vi.mock("@/features/agent/api/story-production-api", () => ({
  fillMessageTemplate: (s: string) => s,
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ projectId: h.projectId }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
vi.mock("@/hooks/use-screen-orientation", () => ({
  usePlayScreenOrientation: () => ({
    landscapeReady: true,
    exiting: false,
    onStageLayout: () => {},
  }),
}));
vi.mock("@/hooks/play-orientation", () => ({ PLAY_ROUTE_SCREEN_OPTIONS: {} }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t, useLocale: () => "en-US" }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@tabler/icons-react-native", () => ({
  IconAlertTriangle: () => null,
  IconRefresh: () => null,
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ScrollView: ({ children }: any) => <div>{children}</div>,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
  ActivityIndicator: () => null,
  StyleSheet: { create: (v: any) => v },
}));
vi.mock("@/features/experience-player", () => ({
  ExperiencePlayerWithAccess: (props: any) => {
    h.props = props;
    return <div data-testid="player">Private player</div>;
  },
  ExperienceStartShell: () => <div>Preview shell</div>,
  localize: () => "Fixture world",
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.status = "authenticated";
  h.props = null;
  h.projectId = "21111111-1111-4111-8111-111111111111";
  h.preview.mockResolvedValue({
    runtime: worldManifestFixture(),
    draftRevision: 1,
    diagnostics: [],
    coverUrl: null,
  });
  h.get.mockResolvedValue({
    project: {
      id: h.projectId,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      status: "active",
      capabilities: ["story.read", "story.generate"],
    },
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const render = () => act(async () => root.render(<StoryPreviewScreen />));
it("passes the server-resolved scope only after permission lookup", async () => {
  await render();
  expect(h.props.worldScope).toEqual({
    projectId: h.projectId,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    generation: 1,
  });
  expect(h.props.accessMode).toBe("preview");
  expect(h.get).toHaveBeenCalledOnce();
});
it("removes the old account's player on sign-out and never resolves its late preview", async () => {
  await render();
  expect(host.querySelector('[data-testid="player"]')).not.toBeNull();
  h.status = "anonymous";
  h.generation = 2;
  await render();
  expect(host.querySelector('[data-testid="player"]')).toBeNull();
  expect(host.textContent).toContain("agent.signInToLoadProjects");
  expect(h.preview).toHaveBeenCalledOnce();
});
it("does not apply a preview response from a previous account", async () => {
  let finish!: (value: unknown) => void;
  h.preview.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  h.status = "anonymous";
  h.generation = 2;
  await render();
  await act(async () =>
    finish({ runtime: worldManifestFixture(), draftRevision: 1, diagnostics: [] })
  );
  expect(h.get).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="player"]')).toBeNull();
});
it("shows permission errors instead of mounting a stream for a read-only project", async () => {
  h.get.mockResolvedValue({
    project: {
      id: h.projectId,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      status: "active",
      capabilities: ["story.read"],
    },
  });
  await render();
  expect(host.textContent).toContain("generation permission");
  expect(host.querySelector('[data-testid="player"]')).toBeNull();
});
