import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewAgreements } from "./crew-agreements";
vi.mock("expo-router", () => ({ useIsFocused: () => true }));

vi.mock("./agreement-create", () => ({ AgreementCreate: () => <span>create form</span> }));
vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
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
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
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
const record = {
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

vi.mock("./agreement-detail", () => ({
  AgreementDetail: ({
    agreementId,
    memberUserId,
    onClose,
  }: {
    agreementId: string;
    memberUserId: string;
    onClose: () => void;
  }) => (
    <div>
      agreement {agreementId}:{memberUserId}
      <button onClick={onClose}>return list</button>
    </div>
  ),
}));
const page = {
  capabilities: { create: false },
  items: [record],
  nextCursor: null,
  total: 120,
  summary: { all: 120, active: 100, signed: 10, attention: 10 },
};
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const render = () =>
  act(async () =>
    root.render(<CrewAgreements crewId="crew" userId="user" generation={1} onClose={h.close} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.detail.mockResolvedValue(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("uses server summary and paginates without duplicate taps", async () => {
  h.detail.mockResolvedValueOnce({ ...page, nextCursor: "next" }).mockResolvedValueOnce({
    ...page,
    items: [{ ...record, id: "22222222-2222-4222-8222-222222222222", title: "Second" }],
  });
  await render();
  expect(host.textContent).toContain("crewAgreements.all · 120");
  await act(async () => {
    button("crewFinance.more").click();
    button("crewFinance.more").click();
  });
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(h.detail.mock.calls[1][2]).toBe("next");
  expect(host.textContent).toContain("Second");
  expect(host.textContent).toContain("Production Agreement");
});
it("resets pagination and rows when switching filters", async () => {
  await render();
  h.detail.mockResolvedValue({ ...page, items: [] });
  await act(async () => button("crewAgreements.signed").click());
  expect(h.detail.mock.calls.at(-1)?.slice(0, 3)).toEqual(["crew", "signed", null]);
  expect(host.textContent).not.toContain("Production Agreement");
  expect(host.textContent).toContain("crewAgreements.empty");
});
it("opens a selected agreement and refreshes the list on return", async () => {
  await render();
  await act(async () => button("Production Agreement · agreementDetail.open").click());
  expect(host.textContent).toContain(`agreement ${record.id}:user`);
  await act(async () => button("return list").click());
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Production Agreement");
});
it("clears loaded records if page access is revoked", async () => {
  h.detail
    .mockResolvedValueOnce({ ...page, nextCursor: "next" })
    .mockRejectedValueOnce(new Error("Forbidden"));
  await render();
  await act(async () => button("crewFinance.more").click());
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("Production Agreement");
  expect(host.textContent).not.toContain("120");
});
it("rejects duplicate records across pages", async () => {
  h.detail.mockResolvedValue({ ...page, nextCursor: "next" });
  await render();
  await act(async () => button("crewFinance.more").click());
  expect(host.textContent).toContain("pagination changed");
  expect(host.textContent).not.toContain("Production Agreement");
});
it("ignores late account results and aborts on unmount", async () => {
  let finish!: (value: unknown) => void;
  h.detail.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => finish(page));
  expect(host.textContent).not.toContain("Production Agreement");
  await act(async () => root.render(null));
  expect(h.detail.mock.calls[0][3].aborted).toBe(true);
});
it("blocks stale agreement selection after account switch", async () => {
  await render();
  h.generation = 2;
  await act(async () => button("Production Agreement · agreementDetail.open").click());
  expect(host.textContent).not.toContain(`agreement ${record.id}:user`);
});

it("only offers creation when server capability allows it", async () => {
  await render();
  expect(button("agreementCreate.title")).toBeUndefined();
  h.detail.mockResolvedValue({ ...page, capabilities: { create: true } });
  await act(async () => button("thread.refresh").click());
  await act(async () => button("agreementCreate.title").click());
  expect(host.textContent).toContain("create form");
});

it("opens a direct agreement without guessing its recipient and returns to the list", async () => {
  await act(async () =>
    root.render(
      <CrewAgreements
        crewId="crew"
        userId="user"
        generation={1}
        initialAgreementId={record.id}
        onClose={h.close}
      />
    )
  );
  expect(host.textContent).toContain(`agreement ${record.id}:`);
  expect(host.textContent).not.toContain(`agreement ${record.id}:user`);
  expect(h.detail).not.toHaveBeenCalled();
  await act(async () => button("return list").click());
  expect(h.detail).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Production Agreement");
});

it("returns to the selected agreement after background instead of resetting the list", async () => {
  await render();
  await act(async () => button("Production Agreement · agreementDetail.open").click());
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.textContent).toContain(`agreement ${record.id}:user`);
  expect(h.detail).toHaveBeenCalledTimes(1);
  await act(async () => button("return list").click());
  expect(h.detail).toHaveBeenCalledTimes(2);
});
