import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PurchaseReportCreate } from "./purchase-report-create";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
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
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => id(4) } }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string) => ({
    read: () => h.records.get(ns + user) ?? null,
    write: (value: string) => h.records.set(ns + user, value),
  }),
}));
const order = {
  id: id(1),
  orderNo: "ORDER-1",
  ipId: id(2),
  episodeId: id(3),
  targetType: "episode",
  currency: "USD",
  totalAmount: "1.00",
  status: "paid",
  createdAt: "2026-10-01T00:00:00Z",
};
let root: Root, host: HTMLDivElement;
const saved = vi.fn();
const mount = () =>
  act(async () =>
    root.render(
      <PurchaseReportCreate
        userId="alice"
        generation={1}
        active={h.active}
        onClose={() => {}}
        onSaved={saved}
      />
    )
  );
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.records.clear();
  h.get.mockResolvedValue({ items: [order], nextCursor: null });
  h.post.mockResolvedValue({
    report: {
      id: id(4),
      status: "submitted",
      targetType: "episode",
      targetId: id(3),
      reason: "payment",
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("links the owned episode purchase and resumes the same request after reopen", async () => {
  await mount();
  await click("ORDER-1");
  h.post.mockRejectedValueOnce(Error("Response lost"));
  await click("feedbackHistory.submit");
  expect(host.textContent).toContain("Response lost");
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  expect(host.textContent).toContain("ORDER-1");
  await click("feedbackHistory.retry");
  expect(h.post.mock.calls[1][1].data).toEqual(h.post.mock.calls[0][1].data);
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    targetType: "episode",
    targetId: id(3),
    purchaseOrderId: id(1),
    requestId: id(4),
  });
  expect(saved).toHaveBeenCalledOnce();
});
it("retries failed purchase lookup from a fresh first page", async () => {
  h.get.mockRejectedValueOnce(Error("Unavailable"));
  await mount();
  expect(host.textContent).toContain("Unavailable");
  await click("common.retry");
  await click("ORDER-1");
  expect(host.textContent).toContain("contentReports.purchaseReference");
});
it("rejects a replacement account's late receipt", async () => {
  let resolve!: (value: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await mount();
  await click("ORDER-1");
  await click("feedbackHistory.submit");
  h.generation = 2;
  await act(async () =>
    resolve({
      report: {
        id: id(4),
        status: "submitted",
        targetType: "episode",
        targetId: id(3),
        reason: "payment",
      },
    })
  );
  expect(saved).not.toHaveBeenCalled();
  expect([...h.records.values()].join()).toContain(id(4));
});
