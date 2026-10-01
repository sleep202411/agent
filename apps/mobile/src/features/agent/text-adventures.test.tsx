import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TextAdventures } from "./text-adventures";
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
const click = (name: string) => act(async () => button(name).click());
const render = () => act(async () => root.render(<TextAdventures onClose={() => {}} />));
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
it("creates from an uploaded document and adopts the returned ID for future saves", async () => {
  await render();
  await click("textAdventure.create");
  expect(button("textAdventure.save").disabled).toBe(true);
  await click("textAdventure.document");
  await click("textAdventure.save");
  expect(h.create).toHaveBeenCalledWith(
    expect.objectContaining({ worldviewDocxUrl: "https://example.com/upload.docx" }),
    { userId: "123", generation: 1 },
    expect.any(AbortSignal)
  );
  await click("textAdventure.save");
  expect(h.update).toHaveBeenCalledWith(
    detail.gameId,
    expect.anything(),
    expect.anything(),
    expect.anything()
  );
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("locks editing and review actions during review", async () => {
  h.get.mockResolvedValue({ ...detail, status: "reviewing" });
  await render();
  await click("Adventure");
  expect(button("textAdventure.save").disabled).toBe(true);
  expect(button("textAdventure.document").disabled).toBe(true);
  expect(button("textAdventure.submit")).toBeUndefined();
});
it("blocks another write after an ambiguous failure until a reload", async () => {
  h.update.mockRejectedValue(new Error("connection lost"));
  await render();
  await click("Adventure");
  await click("textAdventure.save");
  expect(host.textContent).toContain("connection lost");
  expect(button("textAdventure.save").disabled).toBe(true);
  expect(button("textAdventure.submit").disabled).toBe(true);
  await click("textAdventure.refresh");
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("ignores a late result after the account changes", async () => {
  let finish!: (rows: unknown[]) => void;
  h.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  h.generation = 2;
  h.list.mockResolvedValue([]);
  await render();
  await act(async () => finish([{ ...detail, name: "Private old account" }]));
  expect(host.textContent).not.toContain("Private old account");
});
it("uses the selected saved adventure for a native preview", async () => {
  h.preview.mockResolvedValue({
    sessionId: "ts_0123456789abcdef",
    gameId: detail.gameId,
    messages: [{ id: "1", role: "assistant", content: "You enter the forest." }],
  });
  await render();
  await click("Adventure");
  await click("textAdventure.preview");
  expect(h.preview).toHaveBeenCalledWith(
    detail.gameId,
    "en-US",
    expect.anything(),
    expect.anything()
  );
  expect(host.textContent).toContain("You enter the forest.");
});
