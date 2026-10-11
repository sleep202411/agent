import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import TextAdventureLibraryScreen from "../../app/text-adventures";
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, useIsFocused: () => h.focused }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: h.status, user: { id: "1" } }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active && h.focused }));
vi.mock("./text-adventure-create", () => ({ TextAdventureCreate: () => null }));
vi.mock("./text-adventure-player", () => ({ TextAdventurePlayer: () => null }));
vi.mock("./text-adventure-preview", () => ({ TextAdventurePreview: () => null }));
const h = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  active: true,
  focused: true,
  status: "authenticated",
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
  listTextAdventures: h.list,
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
const render = () => act(async () => root.render(<TextAdventureLibraryScreen />));
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.status = "authenticated";
  h.list.mockResolvedValue([
    { gameId: GAME_ID, name: "World", status: "draft", synopsis: "Synopsis" },
  ]);
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

const open = async () => {
  await render();
  await act(async () => button("WorldtextAdventures.status.draftSynopsis").click());
};
it("keeps the Mine-route editor and pending picker through background", async () => {
  await open();
  await act(async () => h.fields["textAdventures.editor.name"]!("My unsaved title"));
  let resolve!: (value: unknown) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await act(async () => button("textAdventures.editor.uploadPoster").click());
  const signal = h.upload.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(false);
  h.active = true;
  await render();
  await act(async () => resolve({ url: "https://cdn.example.com/new-poster.jpg" }));
  expect(JSON.parse(h.raw!).patch).toEqual({
    name: "My unsaved title",
    posterUrl: "https://cdn.example.com/new-poster.jpg",
  });
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="textAdventures.editor.name"]')?.value
  ).toBe("My unsaved title");
  expect(h.update).not.toHaveBeenCalled();
  expect(h.transition).not.toHaveBeenCalled();
});
it.each(["route", "account", "signout"])("retires pending picker on %s change", async (change) => {
  await open();
  let resolve!: (value: unknown) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await act(async () => button("textAdventures.editor.uploadPoster").click());
  const signal = h.upload.mock.calls[0][2] as AbortSignal;
  if (change === "route") h.focused = false;
  else if (change === "account") h.generation++;
  else h.status = "anonymous";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ url: "https://cdn.example.com/retired.jpg" }));
  expect(h.raw).toBeNull();
  expect(h.update).not.toHaveBeenCalled();
});
