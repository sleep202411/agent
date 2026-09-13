/* eslint-disable no-restricted-syntax -- Native select adapter for deterministic control tests. */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Trial from "./page";
import en from "@/messages/en-US.json";
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) =>
    en.crewPolicyTrial[key as keyof typeof en.crewPolicyTrial],
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    value,
    onChange,
    children,
  }: {
    value: string;
    onChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  vi.unstubAllGlobals();
});
function mount() {
  node = document.createElement("div");
  root = createRoot(node);
  act(() => root.render(<Trial />));
}
function select(label: string, value: string) {
  const el = [...node.querySelectorAll("label")]
    .find((n) => n.textContent?.startsWith(label))!
    .querySelector("select")!;
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("compares delivery rules, scopes sample perspectives and resets without API calls", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mount();
  expect(node.textContent).toContain("Sample data only");
  expect(node.querySelectorAll("tbody tr")).toHaveLength(1);
  const checkbox = node.querySelector('input[type="checkbox"]') as HTMLInputElement;
  act(() => checkbox.click());
  expect(node.querySelector("tbody tr")?.textContent).toContain("$100.00$100.00");
  select("Delivery rule", "client");
  expect(node.querySelector("tbody tr")?.textContent).toContain("$100.00$0.00");
  select("Sample perspective", "admin");
  expect(node.querySelectorAll("tbody tr")).toHaveLength(3);
  act(() =>
    [...node.querySelectorAll("button")].find((b) => b.textContent === "Reset trial")!.click()
  );
  expect(node.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(node.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("shows alternatives and requires two approvals before simulated reimbursement", () => {
  mount();
  select("Trial ordering", "feedback");
  expect(node.querySelector("ul li")?.textContent).toContain("Sample creator B");
  select("Trial approval policy", "two");
  select("Distinct non-claimant approvals", "1");
  const checkboxes = node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  act(() => checkboxes[3].click());
  expect(node.querySelector('[role="status"]')?.textContent).toContain(
    "Awaiting required approval"
  );
  select("Distinct non-claimant approvals", "2");
  expect(node.querySelector('[role="status"]')?.textContent).toContain("Approved and reimbursed");
});
