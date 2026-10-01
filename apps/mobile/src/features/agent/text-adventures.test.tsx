import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TextAdventurePreview } from "./text-adventure-preview";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  transition: vi.fn(),
  upload: vi.fn(),
  preview: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: h.generation, user: { id: "123" } }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("./api/text-adventure-api", () => ({
  listTextAdventures: h.list,
  getTextAdventure: h.get,
  createTextAdventure: h.create,
  updateTextAdventure: h.update,
  transitionTextAdventure: h.transition,
}));
vi.mock("./api/text-adventure-preview-api", () => ({
  loadTextAdventurePreview: h.preview,
  sendTextAdventurePreview: h.send,
}));
vi.mock("./text-adventure-upload", () => ({ pickAndUploadTextAdventureMedia: h.upload }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Image: () => null,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
      disabled={!editable}
    />
  ),
}));
const detail = {
  gameId: "tg_0123456789abcdef",
  status: "draft",
  content: {
    name: "Adventure",
    synopsis: "Story",
    worldviewDocxUrl: "https://example.com/world.docx",
    posterUrl: null,
    bgmUrl: null,
    stillUrls: [],
  },
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent === name)!;
const session = { userId: "123", generation: 1 };
const render = () =>
  act(async () =>
    root.render(<TextAdventurePreview gameId={detail.gameId} session={session} onBack={() => {}} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.list.mockResolvedValue([{ ...detail, name: "Adventure" }]);
  h.get.mockResolvedValue(detail);
  h.create.mockResolvedValue(detail);
  h.update.mockResolvedValue(detail);
  h.upload.mockResolvedValue({ url: "https://example.com/upload.docx" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads the selected saved adventure", async () => {
  h.preview.mockResolvedValue({
    sessionId: "ts_0123456789abcdef",
    gameId: detail.gameId,
    messages: [{ id: "1", role: "assistant", content: "You enter the forest." }],
  });
  await render();
  expect(h.preview).toHaveBeenCalledWith(detail.gameId, "en-US", session, expect.any(AbortSignal));
  expect(host.textContent).toContain("You enter the forest.");
});
it("reports interrupted requests and blocks sending", async () => {
  h.preview.mockRejectedValue(new Error("Interrupted"));
  await render();
  expect(host.textContent).toContain("Interrupted");
  expect(button("textAdventure.send").disabled).toBe(true);
});
it("aborts on unmount and ignores late data", async () => {
  let finish!: (value: unknown) => void;
  h.preview.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.preview.mock.calls[0][3];
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ messages: [{ id: "1", content: "old account" }] }));
  expect(host.textContent).not.toContain("old account");
});
