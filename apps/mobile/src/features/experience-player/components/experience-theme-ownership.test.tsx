import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ExperienceRuntimeManifest,
  ExperienceThemeConfig,
} from "@repo/shared/experience-runtime";
import { ExperiencePlayer } from "./experience-player";
import type { ExperienceThemeLoader } from "../lib/experience-theme-loader";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Pressable: "button",
  ScrollView: "div",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "span" }));
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (uri: string) => uri }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-app-active", async () => {
  const { createContext } = await import("react");
  return { useScreenActive: () => true, ScreenActiveGateContext: createContext(true) };
});
vi.mock("../hooks/use-experience-audio-host", () => ({ useExperienceAudioHost: () => ({}) }));
vi.mock("../hooks/use-experience-preload", () => ({
  useExperiencePreload: () => ({ done: true }),
}));
vi.mock("../lib/experience-runtime-host", () => ({
  createExperienceRuntime: () => ({ state: () => ({ currentSceneId: "scene" }) }),
}));
vi.mock("./experience-spatial-layer", () => ({ ExperienceSpatialLayer: () => null }));
vi.mock("./experience-video-renderer", () => ({ ExperienceVideoRenderer: () => null }));
vi.mock("./experience-start-shell", () => ({
  EXPERIENCE_START_ACCENT: "red",
  ExperienceStartShell: ({ surface }: { surface: string }) => <div data-surface={surface} />,
}));
vi.mock("@repo/shared/experience-runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("@repo/shared/experience-runtime")>();
  return {
    ...original,
    ExperienceRuntimeManifestSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const runtime = {
  buildId: "fixture",
  graph: { nodes: [] },
  metadata: { title: { "en-US": "Fixture" } },
  assets: [],
  localization: { locales: ["en-US"], defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
const theme = (surface: string) =>
  ({ tokens: { "color.surface": surface } }) as unknown as ExperienceThemeConfig;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
async function render(loader: ExperienceThemeLoader) {
  await act(async () => {
    root.render(
      <ExperiencePlayer
        runtime={runtime}
        locale="en-US"
        randomSeed="fixed"
        copy={{} as ExperiencePlayerCopy}
        loadTheme={loader}
      />
    );
  });
}
it("keeps the replacement theme when an abandoned loader finishes later", async () => {
  let finish!: (value: ExperienceThemeConfig) => void;
  let oldSignal: AbortSignal | undefined;
  await render((_manifest, signal) => {
    oldSignal = signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render(() => Promise.resolve(theme("new")));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => finish(theme("old")));
  expect(container.querySelector("[data-surface]")?.getAttribute("data-surface")).toBe("new");
});
it("reports a synchronous loader failure through the existing warning path", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await render(() => {
    throw new Error("theme unavailable");
  });
  expect(warn).toHaveBeenCalledWith("[experience-player] theme load failed", "theme unavailable");
  expect(container.querySelector("[data-surface]")).not.toBeNull();
});
