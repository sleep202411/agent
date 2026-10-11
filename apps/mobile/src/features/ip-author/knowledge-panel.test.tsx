import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpKnowledgePanel } from "./knowledge-panel";
const state = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("./knowledge-api", () => ({ fetchKnowledge: state.get, saveKnowledge: state.save }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Switch: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled: boolean;
  }) => (
    <input
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.checked)}
    />
  ),
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
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
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      readOnly={!editable}
      aria-label={accessibilityLabel}
    />
  ),
}));
let root: Root, host: HTMLDivElement;
const doc = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Official",
  content: "Approved material",
  isPublished: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  state.get.mockResolvedValue({ documents: [doc], version: 5 });
  state.save.mockImplementation((_id, _generation, value) =>
    Promise.resolve({ ...value, version: 6 })
  );
});
afterEach(() => act(() => root.unmount()));
async function mount() {
  await act(async () => root.render(<IpKnowledgePanel ipId="film" generation={1} />));
}
async function click(label: string) {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === `ipKnowledgeAdmin.${label}`)!
      .click()
  );
}
it("keeps new materials unpublished and prevents saving blank documents", async () => {
  await mount();
  await click("add");
  expect(
    [...host.querySelectorAll<HTMLInputElement>('[type="checkbox"]')].map((item) => item.checked)
  ).toEqual([false, false]);
  await click("save");
  expect(state.save).not.toHaveBeenCalled();
});
it("publishes only explicitly selected documents", async () => {
  await mount();
  await act(async () => host.querySelector<HTMLInputElement>('[type="checkbox"]')!.click());
  await click("save");
  expect(state.save).toHaveBeenCalledWith(
    "film",
    1,
    { documents: [{ ...doc, isPublished: true }], version: 5 },
    expect.any(AbortSignal)
  );
});
it("retains the draft and requires reload after a version conflict", async () => {
  await mount();
  state.save.mockRejectedValueOnce(Object.assign(new Error("Conflict"), { status: 409 }));
  await click("save");
  await click("save");
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(host.querySelector("input")!.value).toBe(doc.title);
  state.get.mockResolvedValue({ documents: [doc], version: 8 });
  await click("reload");
  await click("save");
  expect(state.save.mock.calls[1][2].version).toBe(8);
});
it("blocks saves after an access failure", async () => {
  state.get.mockRejectedValue(new Error("Forbidden"));
  await mount();
  await click("save");
  expect(state.save).not.toHaveBeenCalled();
});
