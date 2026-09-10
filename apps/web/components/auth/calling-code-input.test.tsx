// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  AuthDialog,
  type AuthMode,
  type AuthRequest,
  clearPendingCode,
  clearResendDeadline,
} from "@repo/auth-flow";
import { CallingCodeInput } from "./calling-code-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.releasePointerCapture = vi.fn();
let root: Root;
const request = vi.fn<
  (request: AuthRequest) => Promise<{ status: number; body: { code: number; data: boolean } }>
>(async () => ({
  status: 200,
  body: { code: 200, data: true },
}));
async function mount(initialMode: AuthMode = "signin") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  sessionStorage.clear();
  clearPendingCode();
  clearResendDeadline();
  await act(async () =>
    root.render(
      <AuthDialog
        open
        initialMode={initialMode}
        onOpenChange={() => {}}
        onSuccess={() => {}}
        t={(key) => key}
        transport={{ request }}
        renderSignInIdentifier={(props) => <CallingCodeInput {...props} codeLabel="Calling code" />}
      />
    )
  );
}
function input(value: string, selector = "input") {
  const element = document.querySelector<HTMLInputElement>(selector)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(value: string) {
  await act(async () => {
    document
      .querySelector<HTMLElement>('[role="combobox"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .find((el) => el.textContent === value)!
      .click();
  });
}
async function submit() {
  await act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.clearAllMocks();
});
it.each([
  ["+86", "13800138000", "13800138000"],
  ["+65", "91234567", "+6591234567"],
  ["+1", "4155550123", "+14155550123"],
])("submits %s using existing Java formatting", async (code, number, account) => {
  await mount();
  await select(code);
  input(number);
  await submit();
  expect(request.mock.calls[0]?.[0]).toMatchObject({ query: { account, type: "phone" } });
});
it("keeps digit-first email login intact after selecting a code", async () => {
  await mount();
  await select("+65");
  input("505421473");
  input("505421473@qq.com");
  await submit();
  expect(request.mock.calls[0]?.[0]).toMatchObject({
    query: { account: "505421473@qq.com", type: "email" },
  });
});
it("recognizes pasted prefixes and replaces the selected code without duplicating it", async () => {
  await mount();
  await select("+86");
  input("+65 91234567");
  expect(document.querySelector('[role="combobox"]')!.textContent).toBe("+65");
  await select("+1");
  input("4155550123");
  await submit();
  expect(request.mock.calls[0]?.[0]).toMatchObject({ query: { account: "+14155550123" } });
});
it("preserves unlisted international numbers", async () => {
  await mount();
  input("+44 7700 900123");
  await submit();
  expect(request.mock.calls[0]?.[0]).toMatchObject({ query: { account: "+447700900123" } });
});
it("does not render the selector for password reset", async () => {
  await mount("reset");
  expect(document.querySelector('[role="combobox"]')).toBeNull();
});

it("uses the selected code for password login", async () => {
  await mount();
  await select("+65");
  input("91234567");
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((el) => el.textContent === "usePasswordInstead")!
      .click();
  });
  expect(document.querySelector('[role="combobox"]')!.textContent).toBe("+65");
  input("password123", "input[type=password]");
  await submit();
  expect(request.mock.calls[0]?.[0]).toMatchObject({
    form: { account: "+6591234567", type: "pwd" },
  });
});
it("preserves an existing number when selecting a code after typing", async () => {
  await mount();
  input("91234567");
  await select("+65");
  expect(document.querySelector("input")!.value).toBe("91234567");
  await submit();
  expect(request.mock.calls[0]?.[0]).toMatchObject({ query: { account: "+6591234567" } });
});

it("closes only the dropdown on Escape and keeps the dialog open", async () => {
  await mount();
  await act(async () => {
    document
      .querySelector<HTMLElement>('[role="combobox"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () => {
    document
      .querySelector('[role="listbox"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
