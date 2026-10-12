import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EarningCreate } from "./earning-create";

const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), decide: vi.fn(), saved: vi.fn() }));
vi.mock("./earning-create-api", async (original) => ({
  ...(await original<typeof import("./earning-create-api")>()),
  fetchEarningCreateAccess: h.access,
  createEarning: h.decide,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
      aria-label={accessibilityLabel}
      value={value}
      disabled={editable === false}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = () =>
  act(async () =>
    root.render(<EarningCreate crewId="crew" userId="manager" generation={1} onSaved={h.saved} />)
  );
const click = (name: string) => act(async () => button(name).click());
async function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({ onSelectMember }: { onSelectMember: (m: unknown) => void }) => (
    <button
      onClick={() =>
        onSelectMember({ crewMemberId: "member", userId: "recipient", label: "Artist" })
      }
    >
      choose member
    </button>
  ),
}));
async function fill() {
  await render();
  await click("earningCreate.add");
  await click("crewFinance.recipient * · earningCreate.select");
  await click("choose member");
  await enter("earningCreate.title", " Bonus ");
  await enter("earningCreate.amount", "1.01");
}
it("requires recipient and valid amount, then review and explicit save", async () => {
  await render();
  await click("earningCreate.add");
  expect(button("earningCreate.review").disabled).toBe(true);
  await click("crewFinance.recipient * · earningCreate.select");
  await click("choose member");
  await enter("earningCreate.title", " Bonus ");
  await enter("earningCreate.amount", "1.001");
  expect(button("earningCreate.review").disabled).toBe(true);
  await enter("earningCreate.amount", "1.01");
  await click("earningCreate.review");
  expect(host.textContent).toContain("USD 1.01");
  expect(h.decide).not.toHaveBeenCalled();
  h.decide.mockResolvedValue({});
  await act(async () => {
    button("earningCreate.confirm").click();
    button("earningCreate.confirm").click();
  });
  expect(h.decide).toHaveBeenCalledExactlyOnceWith(
    "crew",
    "recipient",
    expect.objectContaining({
      title: "Bonus",
      amountMinor: "101",
      crewMemberId: "member",
      currency: "USD",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }),
    "manager",
    1
  );
  expect(h.saved).toHaveBeenCalledTimes(1);
});
it("freezes terms and reuses original request after uncertain failure", async () => {
  await fill();
  await click("earningCreate.review");
  h.decide.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({});
  await click("earningCreate.confirm");
  expect(host.textContent).toContain("Connection lost");
  expect(button("earningCreate.edit")).toBeUndefined();
  expect(host.querySelector("input")).toBeNull();
  await click("earningCreate.retry");
  expect(h.decide.mock.calls[1]).toEqual(h.decide.mock.calls[0]);
  expect(h.saved).toHaveBeenCalledTimes(1);
});
it("hides creation when access is denied and displays permission read failure", async () => {
  h.access.mockResolvedValueOnce(false);
  await render();
  expect(button("earningCreate.add")).toBeUndefined();
  await act(async () => root.render(null));
  h.access.mockRejectedValueOnce(new Error("Forbidden"));
  await render();
  expect(host.textContent).toContain("Forbidden");
  expect(button("earningCreate.add")).toBeUndefined();
});
it("ignores stale access and stale save completions", async () => {
  await fill();
  await click("earningCreate.review");
  let finish!: (v: unknown) => void;
  h.decide.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await click("earningCreate.confirm");
  h.generation = 2;
  await act(async () => finish({}));
  expect(h.saved).not.toHaveBeenCalled();
});
it("prevents creation after account changes", async () => {
  await fill();
  await click("earningCreate.review");
  h.generation = 2;
  await click("earningCreate.confirm");
  expect(h.decide).not.toHaveBeenCalled();
});
it("allows editing before submitting without writing", async () => {
  await fill();
  await click("earningCreate.review");
  await click("earningCreate.edit");
  await enter("earningCreate.amount", "2.50");
  await click("earningCreate.review");
  expect(host.textContent).toContain("USD 2.50");
  expect(h.decide).not.toHaveBeenCalled();
});
