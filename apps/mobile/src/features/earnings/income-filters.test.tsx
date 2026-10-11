import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IncomeFilterFields } from "./income-filters";
const h = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText(value: string): void;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const click = (label: string, last = false) =>
  act(async () => {
    const matches = [...host.querySelectorAll("button")].filter((b) => b.textContent === label);
    (last ? matches.at(-1) : matches[0])!.click();
  });
const input = (index: number, value: string) =>
  act(async () => {
    const el = host.querySelectorAll("input")[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(async () => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<IncomeFilterFields value={{}} onApply={h.apply} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("applies source/status filters only after explicit apply", async () => {
  await click("crewPersonalIncome.applyFilters");
  await click("crewIncome.sources.revenue_share");
  await click("crewPersonalIncome.posted");
  expect(h.apply).not.toHaveBeenCalled();
  await click("crewPersonalIncome.applyFilters", true);
  expect(h.apply).toHaveBeenCalledWith({ sourceType: "revenue_share", status: "posted" });
  expect(host.querySelector("input")).toBeNull();
});
it("rejects impossible dates and reversed ranges, then accepts a corrected interval", async () => {
  await click("crewPersonalIncome.applyFilters");
  await input(0, "2026-02-30");
  await click("crewPersonalIncome.applyFilters", true);
  expect(h.apply).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewPersonalIncome.invalidDate");
  await input(0, "2026-10-10");
  await input(1, "2026-10-01");
  expect(host.textContent).toContain("crewPersonalIncome.invalidDateRange");
  await input(1, "2026-10-31");
  await click("crewPersonalIncome.applyFilters", true);
  expect(h.apply).toHaveBeenCalledWith({
    recordedFrom: "2026-10-10",
    recordedThrough: "2026-10-31",
  });
});
