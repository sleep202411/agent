import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { StoryboardMutation } from "./storyboard-mutation";
import { storyboardPending } from "../lib/storyboard-pending";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
const h = vi.hoisted(() => ({
  generation: 1,
  submit: vi.fn(),
  pending: null as unknown,
  rows: [] as unknown[],
  read: undefined as undefined | ((v: unknown) => void),
  encode: undefined as undefined | ((v: string) => void),
}));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
}));
vi.mock("../api/story-canvas-update", () => ({
  canvasUpdatePending: () => ({ read: () => h.pending, submit: h.submit }),
}));
vi.mock("../api/platform-canvas-document", () => ({
  openPlatformCanvasDocument: vi.fn(),
  platformCanvasUpdatePending: () => ({ read: () => h.pending, submit: h.submit }),
}));
vi.mock("../lib/canvas-storyboard", () => ({ canvasStoryboard: () => ({ rows: h.rows }) }));
vi.mock("./story-canvas-reader", () => ({
  StoryCanvasReader: ({ onResult }: { onResult: (v: unknown) => void }) => {
    h.read = onResult;
    return <span>reader</span>;
  },
}));
vi.mock("./story-canvas-encoder", () => ({
  StoryCanvasEncoder: ({ onResult }: { onResult: (v: string) => void }) => {
    h.encode = onResult;
    return <span>encoder</span>;
  },
}));
const scope = { projectId: "project", documentId: "doc", generation: 1 };
const command = { clientKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", yjsUpdateBase64: "AAA=" };
const loaded = { documentId: "doc", snapshot: { nodes: {}, edges: {} } } as CanvasLoaded;
const edit = {
  nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  type: "shot" as const,
  position: { x: 0, y: 0 },
};
let root: Root, host: HTMLDivElement;
const saved = vi.fn();
beforeEach(() => {
  h.generation = 1;
  h.pending = null;
  h.rows = [];
  h.read = undefined;
  h.encode = undefined;
  h.submit.mockReset().mockResolvedValue({});
  window.localStorage.clear();
  saved.mockClear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const render = () =>
  act(async () =>
    root.render(
      <StoryboardMutation scope={scope} userId="u" edit={edit} onlyIfEmpty saved={saved} />
    )
  );
it("does not create another default shot if a fresh read already contains one", async () => {
  h.rows = [{ id: "existing" }];
  await render();
  await act(async () => h.read!(loaded));
  expect(saved).toHaveBeenCalledWith(loaded);
  expect(h.submit).not.toHaveBeenCalled();
});
it("persists exact bytes before sending and resumes the same operation after remount", async () => {
  h.submit.mockRejectedValueOnce(Error("offline"));
  await render();
  await act(async () => h.read!(loaded));
  await act(async () => h.encode!("AAA="));
  const receipt = storyboardPending(scope, "u").read();
  expect(receipt?.yjsUpdateBase64).toBe("AAA=");
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  await act(async () => h.read!(loaded));
  expect(h.submit.mock.calls[1][0]).toEqual(receipt);
  expect(storyboardPending(scope, "u").read()).toBeNull();
  await act(async () => h.read!(loaded));
  expect(saved).toHaveBeenCalledWith(loaded);
});
it("never replaces a pending operation from another canvas workflow", async () => {
  h.pending = command;
  await render();
  await act(async () => h.read!(loaded));
  expect(host.textContent).toContain("storyboard.pending");
  expect(h.submit).not.toHaveBeenCalled();
});
it("does not submit encoder output after the account changes", async () => {
  await render();
  await act(async () => h.read!(loaded));
  h.generation = 2;
  await act(async () => h.encode!("AAA="));
  expect(h.submit).not.toHaveBeenCalled();
});
