import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewFinanceTrend } from "./crew-finance-trend";
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Line: () => <line />,
  Polygon: () => <polygon />,
  Polyline: () => <polyline />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const trend = {
  timezone: "UTC",
  from: "2026-09-01T00:00:00.000Z",
  through: "2026-09-30T11:00:00.000Z",
  days: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    amountMinor: String(i + 1),
  })),
};
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("expands exact daily values alongside the native chart", async () => {
  await act(async () => root.render(<CrewFinanceTrend value={trend} currency="CNY" />));
  expect(host.querySelector("polyline")).not.toBeNull();
  expect(host.textContent).toContain("CNY 0.30");
  expect(host.textContent).not.toContain("2026-09-15");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("2026-09-15");
  expect(host.textContent).toContain("CNY 0.15");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).not.toContain("2026-09-15");
});
it("shows missing and failed trends as unavailable, never zero income", async () => {
  await act(async () => root.render(<CrewFinanceTrend value={undefined} currency="USD" />));
  expect(host.textContent).toContain("trendUnavailable");
  expect(host.querySelector("svg")).toBeNull();
  await act(async () => root.render(<CrewFinanceTrend value={trend} currency="USD" failed />));
  expect(host.querySelector("svg")).toBeNull();
});
