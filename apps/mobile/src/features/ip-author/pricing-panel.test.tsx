import type { PricingSnapshot } from "./pricing-api";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpPricingPanel } from "./pricing-panel";
const h = vi.hoisted(() => ({
  signedIn: true,
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  push: vi.fn(),
  key: 10,
  open: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, patch: h.patch, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => `00000000-0000-4000-8000-${String(++h.key).padStart(12, "0")}` },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children, style }: { children: ReactNode; style?: { display: "none" } }) => (
    <div style={style}>{children}</div>
  ),
  ActivityIndicator: () => null,
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
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      readOnly={!editable}
      aria-label={accessibilityLabel}
    />
  ),
}));

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: h.push }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => (
      <>{options.headerRight?.()}</>
    ),
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.signedIn ? "authenticated" : "anonymous",
    user: { userId: "alice" },
    generation: 1,
  }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/features/ip-author/contributors-panel", () => ({ IpContributorsPanel: () => null }));
const id = "11111111-1111-4111-8111-111111111111",
  episodeId = "22222222-2222-4222-8222-222222222222",
  ruleId = "33333333-3333-4333-8333-333333333333";
let snapshot: PricingSnapshot, root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpPricingPanel ipId={id} userId="alice" generation={1} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const input = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (label: string, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input(label),
      value
    );
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  snapshot = {
    id,
    title: "Story",
    version: 1,
    price: null,
    priceRules: [],
    episodes: [
      {
        id: episodeId,
        title: "Public episode",
        status: "published",
        isFreePreview: true,
        price: null,
      },
      { id: ruleId, title: "Private draft", status: "draft", isFreePreview: false, price: null },
    ],
  };
  h.get.mockImplementation(async () => ({ ip: snapshot }));
  h.put.mockImplementation(async (path, { data }) => {
    snapshot = {
      ...snapshot,
      version: snapshot.version + 1,
      episodes: snapshot.episodes.map((item) => ({ ...item })),
    };
    if (path.endsWith("/price-rules")) {
      const rule = data.status === "disabled" ? null : { id: ruleId, campaignId: null, ...data };
      snapshot.priceRules = rule ? [rule] : [];
      if (data.targetType === "ip") snapshot.price = rule;
      else snapshot.episodes[0].price = rule;
    } else snapshot.episodes[0].isFreePreview = data.isFreePreview;
    return { ip: snapshot };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("prices a bundle with optional comparison and schedule, rejecting invalid windows", async () => {
  await mount();
  await click("ipPricing.bundle");
  await type("ipPricing.amount", "100");
  await click("ipPricing.schedule");
  await type("ipPricing.originalAmount", "90");
  expect(button("ipPricing.save").disabled).toBe(true);
  await type("ipPricing.originalAmount", "120");
  await type("ipPricing.startsAt", "2030-01-02 12:00");
  await type("ipPricing.endsAt", "2030-01-01 12:00");
  expect(button("ipPricing.save").disabled).toBe(true);
  await type("ipPricing.endsAt", "2030-01-03 12:00");
  await click("ipPricing.save");
  expect(h.put.mock.calls[0][1].data).toMatchObject({
    targetType: "ip",
    amount: "100",
    originalAmount: "120",
    expectedVersion: 1,
  });
  expect(host.textContent).toContain("ipPricing.saved");
});
it("shows only sellable episodes and coordinates preview-to-paid changes", async () => {
  await mount();
  await click("ipPricing.episodes");
  expect(host.textContent).toContain("Public episode");
  expect(host.textContent).not.toContain("Private draft");
  await type("ipPricing.amount", "80");
  await click("ipPricing.save");
  expect(h.put).toHaveBeenCalledTimes(2);
  expect(snapshot.episodes[0].isFreePreview).toBe(false);
  expect(snapshot.episodes[0].price?.amount).toBe("80");
});
it("returns paid episodes to free preview and then unpriced", async () => {
  await mount();
  await click("ipPricing.episodes");
  await type("ipPricing.amount", "80");
  await click("ipPricing.save");
  await click("ipPricing.setPreview");
  expect(snapshot.episodes[0].isFreePreview).toBe(true);
  expect(snapshot.episodes[0].price).toBeNull();
  await click("ipPricing.clearPrice");
  expect(snapshot.episodes[0].isFreePreview).toBe(false);
});
it("freezes pending values and resumes a saved checkpoint after remount", async () => {
  const apply = h.put.getMockImplementation()!;
  h.put.mockImplementationOnce(apply).mockRejectedValueOnce(new Error("Offline"));
  await mount();
  await click("ipPricing.episodes");
  await type("ipPricing.amount", "80");
  await click("ipPricing.save");
  expect(host.textContent).toContain("ipPricing.stepsDone: 1");
  expect(button("ipPricing.save").disabled).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  await click("common.retry");
  expect(h.put).toHaveBeenCalledTimes(3);
  expect(h.put.mock.calls[2][1].data.expectedVersion).toBe(2);
  expect(host.textContent).not.toContain("ipPricing.pending");
});
it("requires refreshed review and confirmation before discarding an unresolved local record", async () => {
  await mount();
  await click("ipPricing.bundle");
  await type("ipPricing.amount", "50");
  snapshot = { ...snapshot, version: 9 };
  await click("ipPricing.save");
  expect(h.put).not.toHaveBeenCalled();
  expect(button("ipPricing.reviewed")).toBeUndefined();
  await click("thread.refresh");
  await click("ipPricing.reviewed");
  await click("common.cancel");
  expect(host.textContent).toContain("ipPricing.pending");
  await click("ipPricing.reviewed");
  await click("ipPricing.confirmClear");
  expect(host.textContent).not.toContain("ipPricing.pending");
  expect(h.put).not.toHaveBeenCalled();
});
it("clears private details on revoked access and hides during inactivity", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  await mount();
  await click("ipPricing.episodes");
  h.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "Access removed", 403));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Public episode");
  h.active = false;
  await mount();
  expect(host.querySelector<HTMLElement>("div")?.style.display).toBe("none");
});

it("loads after Strict Mode effect cleanup and restart", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <IpPricingPanel ipId={id} userId="alice" generation={1} />
      </StrictMode>
    )
  );
  await click("ipPricing.episodes");
  expect(host.textContent).toContain("Public episode");
});

it("keeps an unsaved price and schedule through backgrounding without sending a write", async () => {
  await mount();
  await click("ipPricing.bundle");
  await type("ipPricing.amount", "100");
  await click("ipPricing.schedule");
  await type("ipPricing.originalAmount", "120");
  h.active = false;
  await mount();
  expect(host.querySelector<HTMLElement>("div")?.style.display).toBe("none");
  h.active = true;
  await mount();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipPricing.amount"]')?.value).toBe(
    "100"
  );
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipPricing.originalAmount"]')?.value
  ).toBe("120");
  expect(h.put).not.toHaveBeenCalled();
  await click("ipPricing.save");
  expect(h.put).toHaveBeenCalledOnce();
  expect(h.put.mock.calls[0][1].data).toMatchObject({
    amount: "100",
    originalAmount: "120",
    expectedVersion: 1,
  });
});
it("retires unsaved price fields on route exit", async () => {
  await mount();
  await click("ipPricing.bundle");
  await type("ipPricing.amount", "999");
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  await click("ipPricing.bundle");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipPricing.amount"]')?.value
  ).not.toBe("999");
  expect(h.put).not.toHaveBeenCalled();
});
