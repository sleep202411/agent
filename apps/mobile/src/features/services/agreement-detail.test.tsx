import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AgreementDetail } from "./agreement-detail";

vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  sign: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./agreement-detail-api", async (original) => ({
  ...(await original<typeof import("./agreement-detail-api")>()),
  fetchLinkedAgreement: h.detail,
  openAgreementSigning: h.sign,
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
const record = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  memberUserId: "user",
  signerName: "Artist",
  signerEmail: "artist@example.com",
  title: "Production Agreement",
  provider: "boldsign" as const,
  providerStatus: null,
  status: "sent" as const,
  capabilities: { sign: true },
  delivery: { status: "completed" as const, error: null, attempt: 1 },
  archive: { status: "not_applicable" as const, signedDocumentUrl: null, auditTrailUrl: null },
  sentAt: "2026-09-30T00:00:00Z",
  signedAt: null,
  lastSyncedAt: null,
  voidedAt: null,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};

vi.mock("./conversation-file", () => ({
  ConversationFile: ({ mediaAssetId, name }: { mediaAssetId: string; name: string }) => (
    <span>
      {name}:{mediaAssetId}
    </span>
  ),
}));
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = () =>
  act(async () =>
    root.render(
      <AgreementDetail
        crewId="crew"
        agreementId={record.id}
        memberUserId="user"
        userId="user"
        generation={1}
        onClose={h.close}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue(record);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows authoritative signer, delivery and status without automatic signing", async () => {
  await render();
  expect(host.textContent).toContain("Production Agreement");
  expect(host.textContent).toContain("Artist");
  expect(host.textContent).toContain("agreementDetail.status_sent");
  expect(h.sign).not.toHaveBeenCalled();
});
it("uses explicit signing and prevents duplicate taps", async () => {
  await render();
  h.sign.mockResolvedValue("https://app.boldsign.com/sign/test");
  h.open.mockResolvedValue(undefined);
  await act(async () => {
    button("agreementDetail.sign").click();
    button("agreementDetail.sign").click();
  });
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.open).toHaveBeenCalledExactlyOnceWith("https://app.boldsign.com/sign/test");
});
it("does not offer signing for another recipient", async () => {
  h.detail.mockResolvedValue({ ...record, memberUserId: "other" });
  await render();
  expect(button("agreementDetail.sign")).toBeUndefined();
});
it("uses authenticated media widgets for signed documents and audit trails", async () => {
  h.detail.mockResolvedValue({
    ...record,
    status: "signed",
    archive: {
      status: "ready",
      signedDocumentUrl: "/aurora/media/assets/22222222-2222-4222-8222-222222222222/content",
      auditTrailUrl: "/aurora/media/assets/33333333-3333-4333-8333-333333333333/content",
    },
  });
  await render();
  expect(host.textContent).toContain("agreementDetail.signedDocument:22222222");
  expect(host.textContent).toContain("agreementDetail.auditTrail:33333333");
  expect(button("agreementDetail.sign")).toBeUndefined();
});
it("clears agreement when refreshed access fails", async () => {
  await render();
  h.detail.mockRejectedValue(new Error("Forbidden"));
  await act(async () => button("thread.refresh").click());
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("Production Agreement");
});
it("shows inaccessible reference without stale details", async () => {
  h.detail.mockResolvedValue(null);
  await render();
  expect(host.textContent).toContain("agreementDetail.unavailable");
});
it("does not launch a late signing link after unmount", async () => {
  await render();
  let finish!: (url: string) => void;
  h.sign.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await act(async () => button("agreementDetail.sign").click());
  await act(async () => root.render(null));
  expect(h.sign.mock.calls[0][3].aborted).toBe(true);
  await act(async () => finish("https://app.boldsign.com/sign/test"));
  expect(h.open).not.toHaveBeenCalled();
});
it("does not launch a signing link after switching accounts", async () => {
  await render();
  let finish!: (url: string) => void;
  h.sign.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await act(async () => button("agreementDetail.sign").click());
  h.generation = 2;
  await act(async () => finish("https://app.boldsign.com/sign/test"));
  expect(h.open).not.toHaveBeenCalled();
});
it("surfaces signing failure and allows another explicit attempt", async () => {
  await render();
  h.sign.mockRejectedValue(new Error("Provider unavailable"));
  await act(async () => button("agreementDetail.sign").click());
  expect(host.textContent).toContain("Provider unavailable");
  expect(button("agreementDetail.sign").disabled).toBe(false);
});
