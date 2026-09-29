import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AgreementActions } from "./agreement-actions";
import type { ActionAgreement } from "./agreement-actions-api";

vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  sign: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./agreement-actions-api", async (original) => ({
  ...(await original<typeof import("./agreement-actions-api")>()),
  runAgreementAction: h.sign,
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const record: ActionAgreement = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  memberUserId: "user",
  signerName: "Artist",
  signerEmail: "artist@example.com",
  title: "Production Agreement",
  provider: "boldsign" as const,
  providerStatus: null,
  providerDocumentId: "provider-document",
  status: "sent" as const,
  capabilities: { sign: true },
  canSync: true,
  delivery: { status: "completed" as const, error: null, attempt: 1, canRetry: false },
  archive: {
    status: "not_applicable" as const,
    canRetry: false,
    signedDocumentUrl: null,
    auditTrailUrl: null,
  },
  sentAt: "2026-09-30T00:00:00Z",
  signedAt: null,
  lastSyncedAt: null,
  voidedAt: null,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};

const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = (value = record) =>
  act(async () =>
    root.render(<AgreementActions record={value} generation={1} onSaved={h.close} />)
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
it("requires confirmation and submits once", async () => {
  await render();
  await act(async () => button("agreementActions.sync").click());
  expect(h.sign).not.toHaveBeenCalled();
  h.sign.mockResolvedValue(record);
  await act(async () => {
    button("agreementActions.confirm").click();
    button("agreementActions.confirm").click();
  });
  expect(h.sign).toHaveBeenCalledExactlyOnceWith(record, "sync", 1);
  expect(h.close).toHaveBeenCalledOnce();
});
it("names the recipient before retrying failed delivery", async () => {
  await render({
    ...record,
    providerDocumentId: null,
    status: "failed",
    delivery: { ...record.delivery, status: "failed", canRetry: true },
  });
  await act(async () => button("agreementActions.send").click());
  expect(host.textContent).toContain("Artist · artist@example.com");
  expect(host.textContent).toContain("agreementActions.help_send");
  expect(h.sign).not.toHaveBeenCalled();
});
it("locks after uncertain failure until parent refresh", async () => {
  await render();
  await act(async () => button("agreementActions.sync").click());
  h.sign.mockRejectedValue(new Error("Connection lost"));
  await act(async () => button("agreementActions.confirm").click());
  expect(host.textContent).toContain("Connection lost");
  expect(button("agreementActions.confirm").disabled).toBe(true);
  expect(host.textContent).toContain("agreementActions.refreshHelp");
  expect(h.close).not.toHaveBeenCalled();
});
it("hides actions without capabilities", async () => {
  await render({ ...record, canSync: false });
  expect(host.querySelectorAll("button")).toHaveLength(0);
});
it("does not apply a late action after account change", async () => {
  await render();
  await act(async () => button("agreementActions.sync").click());
  let finish!: (value: unknown) => void;
  h.sign.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await act(async () => button("agreementActions.confirm").click());
  h.generation = 2;
  await act(async () => finish(record));
  expect(h.close).not.toHaveBeenCalled();
});
it("can cancel before confirming without an action", async () => {
  await render();
  await act(async () => button("agreementActions.sync").click());
  await act(async () => button("common.cancel").click());
  expect(button("agreementActions.sync")).toBeDefined();
  expect(h.sign).not.toHaveBeenCalled();
});
