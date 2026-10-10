import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CrewAgreementsScreen from "../../app/crew-agreements/[id]";
vi.mock("./agreement-detail", () => ({ AgreementDetail: () => <span>agreement detail</span> }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "crew" }),
  useRouter: () => ({ back: h.close }),
  useIsFocused: () => h.focused,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: "authenticated", user: { id: "user" } }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));

vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  focused: true,
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
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active && h.focused }));
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
const render = () => act(async () => root.render(<CrewAgreementsScreen />));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.detail.mockResolvedValue({
    items: [],
    nextCursor: null,
    capabilities: { create: true },
    summary: { all: 0, pending: 0, signed: 0, failed: 0 },
  });
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

async function openDraft() {
  await render();
  await act(async () => button("agreementCreate.title").click());
  await act(async () => button("agreementCreate.member").click());
  await act(async () => button("choose member").click());
  await enter("agreementCreate.signerEmail", "artist@example.com");
  await enter("agreementCreate.agreementTitle", "Production terms");
}
it("keeps a creation draft through background and failed access refresh", async () => {
  await openDraft();
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.detail.mockRejectedValueOnce(new Error("Access read failed"));
  h.active = true;
  await render();
  expect(host.textContent).toContain("Access read failed");
  expect(button("agreementCreate.review")).toBeUndefined();
  await act(async () => button("common.retry").click());
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="agreementCreate.agreementTitle"]')
      ?.value
  ).toBe("Production terms");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="agreementCreate.signerEmail"]')?.value
  ).toBe("artist@example.com");
  expect(h.sign).not.toHaveBeenCalled();
});
it("withholds a reviewed draft after creation permission is revoked", async () => {
  await openDraft();
  await act(async () => button("agreementCreate.review").click());
  h.active = false;
  await render();
  h.detail.mockResolvedValue({
    items: [],
    nextCursor: null,
    capabilities: { create: false },
    summary: {},
  });
  h.active = true;
  await render();
  expect(host.textContent).toContain("agreementCreate.denied");
  expect(button("agreementCreate.confirm")).toBeUndefined();
  expect(h.sign).not.toHaveBeenCalled();
});
it.each(["route", "account"])("retires an agreement draft on %s change", async (change) => {
  await openDraft();
  if (change === "route") h.focused = false;
  else h.generation++;
  await render();
  h.focused = true;
  await render();
  await act(async () => button("agreementCreate.title").click());
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="agreementCreate.agreementTitle"]')
      ?.value
  ).toBe("");
});

it("keeps an uncertain creation locked after foreground return", async () => {
  await openDraft();
  await act(async () => button("agreementCreate.review").click());
  h.sign.mockRejectedValue(new Error("Response lost"));
  await act(async () => button("agreementCreate.confirm").click());
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(button("agreementCreate.confirm").disabled).toBe(true);
  expect(host.textContent).toContain("Response lost");
  expect(h.sign).toHaveBeenCalledTimes(1);
});

it("keeps fallback navigation locked while creation is still pending", async () => {
  await openDraft();
  await act(async () => button("agreementCreate.review").click());
  let reject!: (error: Error) => void;
  h.sign.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await act(async () => button("agreementCreate.confirm").click());
  h.active = false;
  await render();
  h.detail.mockRejectedValueOnce(new Error("Access read failed"));
  h.active = true;
  await render();
  expect(button("crewAgreements.backToList").disabled).toBe(true);
  expect(button("common.retry").disabled).toBe(true);
  await act(async () => reject(new Error("Response lost")));
  expect(button("common.retry").disabled).toBe(false);
  await act(async () => button("common.retry").click());
  expect(button("agreementCreate.confirm").disabled).toBe(true);
  expect(h.sign).toHaveBeenCalledTimes(1);
});
