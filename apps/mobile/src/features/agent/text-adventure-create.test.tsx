import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextAdventureCreate } from "./text-adventure-create";
const h = vi.hoisted(() => ({
  record: null as null | { id: string; phase: string; name: string; gameId?: string },
  select: vi.fn(),
  create: vi.fn(),
  recover: vi.fn(),
  discard: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
vi.mock("./text-adventure-creation", () => ({
  textAdventureCreation: () => ({
    read: () => h.record,
    select: h.select,
    create: h.create,
    recover: h.recover,
    discard: h.discard,
  }),
}));
vi.mock("./text-adventure-editor", () => ({
  Action: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (suffix: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.endsWith(suffix))!;
const render = () =>
  act(async () =>
    root.render(
      <TextAdventureCreate
        session={{ userId: "1", generation: 1 }}
        onOpen={h.open}
        onRefresh={h.refresh}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.record = null;
  h.generation = 1;
  h.select.mockImplementation(async () => {
    h.record = { id: "intent", phase: "ready", name: "world.docx" };
    return h.record;
  });
  h.create.mockImplementation(async () => {
    h.record = { ...h.record!, phase: "created", gameId: "tg_0123456789abcdef" };
    return h.record;
  });
  h.discard.mockImplementation(async () => {
    h.record = null;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires explicit creation after upload and opens the persisted successful result", async () => {
  await render();
  await act(async () => button("uploadFirst").click());
  expect(host.textContent).toContain("world.docx");
  expect(h.create).not.toHaveBeenCalled();
  await act(async () => button("library.create").click());
  expect(h.open).toHaveBeenCalledWith("tg_0123456789abcdef");
});
it("shows lost-response recovery instead of allowing another creation", async () => {
  h.record = { id: "intent", phase: "ready", name: "world.docx" };
  h.create.mockImplementation(async () => {
    h.record!.phase = "creating";
    throw new Error("Response lost");
  });
  await render();
  await act(async () => button("library.create").click());
  expect(host.textContent).toContain("Response lost");
  expect(button("library.create")).toBeUndefined();
  h.recover.mockResolvedValue({ ...h.record, gameId: "tg_0123456789abcdef", phase: "created" });
  await act(async () => button("checkCreation").click());
  expect(h.open).toHaveBeenCalledWith("tg_0123456789abcdef");
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("requires a separate acknowledgement before clearing an unknown request", async () => {
  h.record = { id: "intent", phase: "creating", name: "world.docx" };
  await render();
  await act(async () => button("clearCreation").click());
  expect(host.textContent).toContain("discardUnknown");
  expect(h.discard).not.toHaveBeenCalled();
  const buttons = [...host.querySelectorAll("button")].filter((b) =>
    b.textContent?.endsWith("clearCreation")
  );
  await act(async () => buttons[1]!.click());
  expect(h.discard).toHaveBeenCalledWith("intent", true);
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("prevents a stale account from starting upload", async () => {
  await render();
  h.generation = 2;
  await act(async () => button("uploadFirst").click());
  expect(h.select).not.toHaveBeenCalled();
});
