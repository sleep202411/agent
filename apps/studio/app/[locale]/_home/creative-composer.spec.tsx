// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreativeComposer } from "./creative-composer";
const state = vi.hoisted(() => ({ push: vi.fn(), requireAuth: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ requireAuth: state.requireAuth }),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<CreativeComposer theme={{} as never} />));
}
async function prompt(value: string) {
  const input = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function enter(options: KeyboardEventInit = {}) {
  await act(async () =>
    host
      .querySelector("textarea")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options })
      )
  );
}
it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { shiftKey: true }])(
  "keeps composition, repeat and newline keys in the editor (%j)",
  async (options) => {
    await render();
    await prompt("测试 prompt");
    await enter(options);
    expect(state.requireAuth).not.toHaveBeenCalled();
    await enter();
    expect(state.requireAuth).toHaveBeenCalledTimes(1);
  }
);
it("hands the current prompt to Studio once after sign-in", async () => {
  await render();
  await prompt("hello & world");
  await enter();
  const complete = state.requireAuth.mock.calls[0]![0] as () => void;
  await act(async () => {
    complete();
    complete();
  });
  expect(state.push).toHaveBeenCalledExactlyOnceWith("/images?prompt=hello%20%26%20world");
});
it.each(["edit", "unmount"])("abandons pending sign-in navigation after %s", async (change) => {
  await render();
  await prompt("old");
  await enter();
  const complete = state.requireAuth.mock.calls[0]![0] as () => void;
  if (change === "edit") await prompt("new");
  else await act(async () => root.render(null));
  await act(async () => complete());
  expect(state.push).not.toHaveBeenCalled();
  if (change === "edit") {
    await enter();
    await act(async () => state.requireAuth.mock.calls[1]![0]());
    expect(state.push).toHaveBeenCalledExactlyOnceWith("/images?prompt=new");
  }
});
it("permits another navigation attempt if the router throws", async () => {
  await render();
  await prompt("retry");
  await enter();
  const complete = state.requireAuth.mock.calls[0]![0] as () => void;
  state.push.mockImplementationOnce(() => {
    throw new Error("router unavailable");
  });
  expect(complete).toThrow("router unavailable");
  complete();
  expect(state.push).toHaveBeenCalledTimes(2);
});
