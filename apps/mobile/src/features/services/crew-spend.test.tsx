import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewSpendSummary } from "./crew-spend";

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

vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./crew-spend-api", () => ({ fetchCrewSpend: h.detail }));
const summary = {
  taskRewardsByCurrency: { USD: "9007199254740993", CNY: "100" },
  reimbursementsByCurrency: { USD: "7", CNY: "200" },
  totalByCurrency: { USD: "9007199254741000", CNY: "300" },
};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = () =>
  act(async () => root.render(<CrewSpendSummary crewId="crew" generation={1} onClose={h.close} />));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue(summary);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows both currencies without lossy conversion", async () => {
  await render();
  expect(host.textContent).toContain("USD 90071992547410.00");
  expect(host.textContent).toContain("CNY 3.00");
  expect(host.textContent).toContain("crewSpend.help");
});
it("clears old summary during refresh and shows permission failure", async () => {
  await render();
  h.detail.mockRejectedValue(new Error("Forbidden"));
  await act(async () => button("thread.refresh").click());
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("90071992547410.00");
});
it("ignores response after account switch", async () => {
  let resolve!: (x: unknown) => void;
  h.detail.mockImplementation(() => new Promise((r) => (resolve = r)));
  await render();
  h.generation = 2;
  await act(async () => resolve(summary));
  expect(host.textContent).not.toContain("90071992547410.00");
});
it("renders a genuine zero summary", async () => {
  h.detail.mockResolvedValue({
    taskRewardsByCurrency: { USD: "0", CNY: "0" },
    reimbursementsByCurrency: { USD: "0", CNY: "0" },
    totalByCurrency: { USD: "0", CNY: "0" },
  });
  await render();
  expect(host.textContent).toContain("USD 0.00");
  expect(host.textContent).toContain("CNY 0.00");
});
