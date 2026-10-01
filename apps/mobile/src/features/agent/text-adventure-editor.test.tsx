import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TextAdventureEditor } from "./text-adventure-editor";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  transition: vi.fn(),
  upload: vi.fn(),
  generation: 1,
  back: vi.fn(),
  raw: null as string | null,
  fields: {} as Record<string, (s: string) => void>,
}));
vi.mock("./text-adventure-media", () => ({
  TextAdventureMedia: () => null,
  TextAdventureMusic: () => null,
}));
vi.mock("./api/text-adventure-api", () => ({
  getTextAdventure: h.get,
  updateTextAdventure: h.update,
  transitionTextAdventure: h.transition,
}));
vi.mock("./text-adventure-upload", () => ({ pickAndUploadTextAdventureMedia: h.upload }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({ read: () => h.raw, write: (v: string) => (h.raw = v) }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Image: () => null,
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    accessibilityLabel: string;
    editable: boolean;
  }) => {
    h.fields[accessibilityLabel] = onChangeText;
    return <input value={value} readOnly disabled={!editable} aria-label={accessibilityLabel} />;
  },
}));
const GAME_ID = "tg_0123456789abcdef";

function detail(status: "draft" | "reviewing" | "published" | "offline" = "draft") {
  return {
    gameId: GAME_ID,
    projectId: null,
    status,
    rejectReason: null,
    draftVersionId: "1",
    publishedVersionId: status === "published" ? "1" : null,
    publishedAt: status === "published" ? "2026-08-09T12:00:00Z" : null,
    offlineAt: status === "offline" ? "2026-08-09T12:00:00Z" : null,
    createdAt: "2026-08-09T12:00:00Z",
    updatedAt: "2026-08-09T12:00:00Z",
    content: {
      versionId: "1",
      versionNo: 1,
      name: "World",
      posterUrl: "https://cdn.example.com/poster.jpg",
      synopsis: "Synopsis",
      worldviewDocxUrl: "https://cdn.example.com/world.docx",
      bgmUrl: null,
      characters: [],
      stillUrls: [],
    },
  };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const session = { userId: "1", generation: 1 };
const render = () =>
  act(async () =>
    root.render(<TextAdventureEditor gameId={GAME_ID} session={session} onBack={h.back} />)
  );
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.raw = null;
  h.fields = {};
  h.get.mockResolvedValue(detail());
  h.update.mockResolvedValue(detail());
  h.transition.mockResolvedValue(detail("reviewing"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("persists edits and sends only their patch with the reviewed server version", async () => {
  await render();
  await act(async () => h.fields["textAdventures.editor.name"]!("Renamed"));
  expect(JSON.parse(h.raw!).patch).toEqual({ name: "Renamed" });
  await act(async () => button("textAdventures.actions.save").click());
  expect(h.update).toHaveBeenCalledWith(
    GAME_ID,
    { name: "Renamed" },
    session,
    expect.any(AbortSignal),
    expect.objectContaining({ draftVersionId: "1" })
  );
  expect(h.raw).toBe("null");
});
it("restores local edits but blocks save when the server baseline changed", async () => {
  h.raw = JSON.stringify({
    gameId: GAME_ID,
    version: "old",
    updatedAt: "old",
    patch: { name: "Local" },
  });
  await render();
  expect((host.querySelector("input") as HTMLInputElement).value).toBe("Local");
  expect(button("textAdventures.actions.save").disabled).toBe(true);
  expect(host.textContent).toContain("textAdventures.mobile.conflict");
  await act(async () => button("textAdventures.mobile.discard").click());
  expect((host.querySelector("input") as HTMLInputElement).value).toBe("World");
});
it("requires explicit confirmation before submitting and locks editing during review", async () => {
  await render();
  await act(async () => button("textAdventures.publish.submit").click());
  expect(h.transition).not.toHaveBeenCalled();
  await act(async () => button("textAdventures.publish.submitConfirm").click());
  expect(h.transition).toHaveBeenCalledWith(GAME_ID, "submit", session, expect.any(AbortSignal));
  h.get.mockResolvedValue(detail("reviewing"));
  await act(async () => root.render(null));
  await render();
  expect((host.querySelector("input") as HTMLInputElement).disabled).toBe(true);
  expect(button("textAdventures.publish.submit")).toBeUndefined();
  expect(button("textAdventures.publish.takeOffline")).toBeTruthy();
});
it("keeps edits after an uncertain save and blocks a blind retry", async () => {
  h.update.mockRejectedValue(new Error("Response lost"));
  await render();
  await act(async () => h.fields["textAdventures.editor.name"]!("Local"));
  await act(async () => button("textAdventures.actions.save").click());
  expect(host.textContent).toContain("Response lost");
  expect(button("textAdventures.actions.save").disabled).toBe(true);
  expect(JSON.parse(h.raw!).patch.name).toBe("Local");
});
it("stages uploaded media locally without saving or publishing automatically", async () => {
  h.upload.mockResolvedValue({ url: "https://cdn.example/new.png", name: "new.png" });
  await render();
  await act(async () => button("textAdventures.editor.uploadPoster").click());
  expect(JSON.parse(h.raw!).patch.posterUrl).toBe("https://cdn.example/new.png");
  expect(h.update).not.toHaveBeenCalled();
  expect(button("textAdventures.publish.submit").disabled).toBe(true);
});
it("aborts pending reads when leaving and ignores late results", async () => {
  let finish!: (v: unknown) => void;
  h.get.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.get.mock.calls[0][2];
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(detail()));
  expect(host.textContent).toBe("");
});
