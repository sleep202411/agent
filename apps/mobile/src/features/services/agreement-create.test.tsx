import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AgreementCreate } from "./agreement-create";

vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  sign: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./crew-agreements-api", async (original) => ({
  ...(await original<typeof import("./crew-agreements-api")>()),
  fetchCrewAgreements: h.detail,
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
  Linking: { openURL: h.open },
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
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

vi.mock("./agreement-create-api", async (original) => ({
  ...(await original<typeof import("./agreement-create-api")>()),
  createAgreement: h.sign,
}));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({
    onSelect,
  }: {
    onSelect: (m: { userId: string; label: string }) => void;
  }) => (
    <button onClick={() => onSelect({ userId: "member", label: "Artist" })}>choose member</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const render = () =>
  act(async () =>
    root.render(
      <AgreementCreate
        crewId="crew"
        userId="user"
        generation={1}
        onClose={h.close}
        onSaved={h.open}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function enter(label: string, value: string) {
  await act(async () => {
    const node = host.querySelector(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function review() {
  await render();
  await act(async () => button("agreementCreate.member").click());
  await act(async () => button("choose member").click());
  await enter("agreementCreate.signerEmail", "artist@example.com");
  await enter("agreementCreate.agreementTitle", "Terms");
  await act(async () => button("agreementCreate.review").click());
}
it("requires valid fields before review", async () => {
  await render();
  await act(async () => button("agreementCreate.review").click());
  expect(host.textContent).toContain("agreementCreate.invalid");
  expect(h.sign).not.toHaveBeenCalled();
});
it("reviews recipient and admits one confirmation", async () => {
  await review();
  expect(host.textContent).toContain("member · Artist · artist@example.com");
  expect(h.sign).not.toHaveBeenCalled();
  await act(async () => {
    button("agreementCreate.confirm").click();
    button("agreementCreate.confirm").click();
  });
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.open).toHaveBeenCalledTimes(1);
});
it("locks uncertain request and allows returning to list", async () => {
  h.sign.mockRejectedValue(new Error("Network unavailable"));
  await review();
  await act(async () => button("agreementCreate.confirm").click());
  expect(host.textContent).toContain("Network unavailable");
  expect(button("agreementCreate.confirm").disabled).toBe(true);
  expect(host.textContent).toContain("agreementCreate.checkList");
  await act(async () => button("crewAgreements.backToList").click());
  expect(h.close).toHaveBeenCalledOnce();
});
it("suppresses callbacks after account change", async () => {
  let resolve!: () => void;
  h.sign.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await review();
  await act(async () => button("agreementCreate.confirm").click());
  h.generation = 2;
  await act(async () => resolve());
  expect(h.open).not.toHaveBeenCalled();
});
