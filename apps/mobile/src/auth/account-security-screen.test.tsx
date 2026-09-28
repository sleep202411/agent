import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountSecurityScreen from "@/app/account-security";
const h = vi.hoisted(() => ({
  focused: true,
  generation: 1,
  save: vi.fn(),
  alert: vi.fn(),
  back: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: h.back }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = h.focused;
    useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
vi.mock("@/auth", () => ({
  isValidAccountPassword: (p: string) => p.length >= 8,
  useAuth: () => ({ generation: h.generation, saveAccountPassword: h.save }),
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Alert: { alert: h.alert },
    StyleSheet: { create: (v: unknown) => v },
    Platform: { OS: "web", select: (v: Record<string, unknown>) => v.web ?? v.default },
    ActivityIndicator: () => null,
    View: Box,
    Text: Box,
    ScrollView: Box,
    KeyboardAvoidingView: Box,
    TextInput: ({
      value,
      onChangeText,
      editable,
      placeholder,
    }: {
      value: string;
      onChangeText: (v: string) => void;
      editable?: boolean;
      placeholder: string;
    }) => (
      <input
        value={value}
        onChange={(e) => onChangeText(e.target.value)}
        disabled={editable === false}
        placeholder={placeholder}
      />
    ),
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
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let resolve: () => void, reject: (e: Error) => void;
beforeEach(async () => {
  vi.clearAllMocks();
  h.focused = true;
  h.generation = 1;
  h.save.mockImplementation(
    () =>
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      })
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
  await act(async () => {
    for (const input of Array.from(host.querySelectorAll("input")).slice(1)) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "test-secret"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<AccountSecurityScreen />));
}
async function submit() {
  await act(async () => host.querySelector("button")!.click());
}
it.each(["success", "failure"])("ignores late %s after leaving the screen", async (outcome) => {
  await submit();
  h.focused = false;
  await render();
  await act(async () => (outcome === "success" ? resolve() : reject(new Error("failed"))));
  expect(h.alert).not.toHaveBeenCalled();
});
it("invalidates an already-visible alert's navigation callback after departure", async () => {
  await submit();
  await act(async () => resolve());
  const ok = h.alert.mock.calls[0][2][0].onPress;
  h.focused = false;
  await render();
  h.focused = true;
  await render();
  ok();
  expect(h.back).not.toHaveBeenCalled();
});
it("does not duplicate submissions or allow editing the pending password", async () => {
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(Array.from(host.querySelectorAll("input")).every((i) => i.disabled)).toBe(true);
});
it("preserves normal failure retry and successful navigation", async () => {
  await submit();
  await act(async () => reject(new Error("try again")));
  expect(host.textContent).toContain("try again");
  expect(host.querySelector("input")!.disabled).toBe(false);
  await submit();
  await act(async () => resolve());
  const ok = h.alert.mock.calls.at(-1)![2][0].onPress;
  ok();
  expect(h.back).toHaveBeenCalledOnce();
});
it("suppresses results after the authenticated session changes", async () => {
  await submit();
  h.generation++;
  await render();
  await act(async () => resolve());
  expect(h.alert).not.toHaveBeenCalled();
});
