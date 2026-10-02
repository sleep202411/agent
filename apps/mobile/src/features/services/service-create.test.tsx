import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ServiceCreate } from "./service-create";
const h = vi.hoisted(() => ({
  change: vi.fn(),
  refresh: vi.fn(),
  user: "owner",
  generation: 1,
  authenticated: true,
  active: true,
}));
vi.mock("./service-create-api", async (original) => ({
  ...(await original<typeof import("./service-create-api")>()),
  createServiceDraft: h.change,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.user },
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;

const render = () =>
  act(async () => root.render(<ServiceCreate key={h.generation} onCreated={h.refresh} />));
const click = (key: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === key)!
    .click();
const type = (label: string, text: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function fill() {
  await render();
  await act(async () => click("serviceCreate.title"));
  await act(async () => {
    type("serviceEdit.name", "Film");
    type("serviceEdit.summary", "Editing");
  });
}
it("serializes taps and freezes a failed request for identical retry", async () => {
  let fail!: (error: Error) => void;
  h.change
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    )
    .mockResolvedValue({ id: "created" });
  await fill();
  await act(async () => {
    click("serviceCreate.save");
    click("serviceCreate.save");
  });
  expect(h.change).toHaveBeenCalledOnce();
  await act(async () => fail(new Error("Network lost")));
  expect(host.textContent).toContain("serviceCreate.retryHint");
  expect(host.querySelector("input")?.disabled).toBe(true);
  await act(async () => click("common.retry"));
  expect(h.change.mock.calls[1]).toEqual(h.change.mock.calls[0]);
  expect(h.refresh).toHaveBeenCalledExactlyOnceWith("created");
});
it("ignores a create response after the account changes", async () => {
  let finish!: (value: { id: string }) => void;
  h.change.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await fill();
  await act(async () => click("serviceCreate.save"));
  h.generation++;
  await render();
  await act(async () => finish({ id: "old" }));
  expect(h.refresh).not.toHaveBeenCalled();
  expect(host.textContent).toBe("serviceCreate.title");
});

it("explains an unconfirmed background write and retries only on explicit action", async () => {
  let finish!: (value: { id: string }) => void;
  h.change
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ id: "created" });
  await fill();
  await act(async () => click("serviceCreate.save"));
  h.active = false;
  await render();
  await act(async () => finish({ id: "created" }));
  expect(h.refresh).not.toHaveBeenCalled();
  h.active = true;
  await render();
  expect(host.textContent).toContain("serviceCreate.retryHint");
  expect(host.querySelector("input")?.disabled).toBe(true);
  expect(h.change).toHaveBeenCalledOnce();
  await act(async () => click("common.retry"));
  expect(h.change.mock.calls[1]).toEqual(h.change.mock.calls[0]);
  expect(h.refresh).toHaveBeenCalledExactlyOnceWith("created");
});
