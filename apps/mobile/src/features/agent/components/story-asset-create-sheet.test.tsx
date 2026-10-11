import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AssetCreateSheet } from "./story-asset-create-sheet";
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000009" },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
  ActivityIndicator: () => <span>loading</span>,
  Alert: { alert: vi.fn() },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => (
    <input
      value={value}
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));

let root: Root, host: HTMLDivElement;
const submit = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async (locked = false, visible = true) => {
  await act(async () =>
    root.render(
      <AssetCreateSheet
        kind="prop"
        visible={visible}
        locked={locked}
        submit={submit}
        onClose={() => {}}
        recovery={<span>recovery</span>}
      />
    )
  );
};
const fill = async (value: string) => {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const create = () =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === "assetEdit.create")!;
it("rejects blank names", async () => {
  await render();
  expect(create().disabled).toBe(true);
  await fill("  ");
  expect(create().disabled).toBe(true);
});
it("uses the category and trimmed name for the initial prompt", async () => {
  await render();
  await fill("  Sword  ");
  await act(async () => create().click());
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "create",
      input: { kind: "prop", name: "Sword", imagePrompt: "Sword" },
    })
  );
});
it("locks edits during pending recovery and displays the recovery controls", async () => {
  await render(true);
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(create().disabled).toBe(true);
  expect(host.textContent).toContain("recovery");
});

it("retains an unsent name when the modal hides during an inactive visit", async () => {
  await render();
  await fill("Draft sword");
  await render(true, false);
  expect(host.querySelector("input")).toBeNull();
  await render(true);
  expect(host.querySelector("input")?.value).toBe("Draft sword");
  expect(create().disabled).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  await render();
  await act(async () => create().click());
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      input: { kind: "prop", name: "Draft sword", imagePrompt: "Draft sword" },
    })
  );
});
