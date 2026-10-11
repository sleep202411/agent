import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryCandidatePlayback } from "./story-candidate-playback";
const h = vi.hoisted(() => ({ load: vi.fn(), active: true, generation: 1 }));
vi.mock("../api/story-candidate-playback", () => ({ fetchStoryCandidatePlayback: h.load }));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: h.generation }) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/features/services/conversation-audio", () => ({
  ConversationAudio: ({ url }: { url: string }) => <span data-audio={url}>Audio</span>,
}));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: ({ url }: { url: string }) => <span data-video={url}>Video</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.load.mockResolvedValue("https://fresh.test/media");
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const render = async (kind: "audio" | "video" = "audio") => {
  await act(async () =>
    root.render(
      <StoryCandidatePlayback
        scope={{ projectId: "project", generation: 1 }}
        mediaAssetId="media"
        kind={kind}
        name="Candidate"
      />
    )
  );
};
const click = async (label: string) => {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
};
it.each(["audio", "video"] as const)(
  "opens %s on demand and removes playback on close",
  async (kind) => {
    await render(kind);
    expect(h.load).not.toHaveBeenCalled();
    await click("storyCandidates.preview");
    expect(host.querySelector(`[data-${kind}]`)).not.toBeNull();
    await click("thread.closePreview");
    expect(host.querySelector(`[data-${kind}]`)).toBeNull();
    await click("storyCandidates.preview");
    expect(h.load).toHaveBeenCalledTimes(2);
  }
);
it("keeps denied access retryable", async () => {
  h.load.mockRejectedValueOnce(Error("Access revoked"));
  await render();
  await click("storyCandidates.preview");
  expect(host.textContent).toContain("Access revoked");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click("storyCandidates.preview");
  expect(host.querySelector("[data-audio]")).not.toBeNull();
});
it.each(["account", "background"])("unmounts a player on %s change", async (reason) => {
  await render();
  await click("storyCandidates.preview");
  if (reason === "account") h.generation++;
  else h.active = false;
  await render();
  expect(host.querySelector("[data-audio]")).toBeNull();
});
it("aborts in-flight work and ignores late results after leaving", async () => {
  let finish!: (value: string) => void;
  h.load.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("storyCandidates.preview");
  const signal = h.load.mock.calls[0][3] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish("https://late.test/media"));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
