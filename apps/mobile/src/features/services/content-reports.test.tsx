import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ContentReports } from "./content-reports";
vi.mock("./content-report-create", () => ({ ContentReportCreate: () => null }));
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
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

const row = {
  id: id(1),
  targetType: "ip",
  targetId: id(2),
  reason: "copyright",
  status: "submitted",
  createdAt: "2026-10-04T00:00:00Z",
  description: "Private evidence",
  resolutionNote: null,
};
let root: Root, host: HTMLDivElement;
const mount = () => act(async () => root.render(<ContentReports userId="a" generation={1} />));
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows submitted details but only outcomes in the respondent view and resets cursors", async () => {
  h.get.mockResolvedValueOnce({ items: [row], nextCursor: id(1) });
  await mount();
  expect(host.textContent).toContain("Private evidence");
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("crewFinance.more");
  h.get.mockResolvedValue({
    items: [{ ...row, status: "actioned", resolutionNote: "Content removed" }],
    nextCursor: null,
  });
  await click("contentReports.responses");
  expect(host.textContent).toContain("Content removed");
  expect(host.textContent).not.toContain("Private evidence");
  expect(h.get.mock.calls.at(-1)![1].params).toEqual({ view: "responses", limit: 20 });
});
it("rechecks on foreground return and clears failed reads before refresh recovery", async () => {
  await mount();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.get.mockRejectedValue(Error("Access denied"));
  h.active = true;
  await mount();
  expect(host.textContent).not.toContain("Private evidence");
  expect(host.textContent).toContain("Access denied");
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("thread.refresh");
  expect(host.textContent).toContain("contentReports.empty");
});
it("ignores an old-view response and hides data after account change", async () => {
  let resolve!: (v: unknown) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await mount();
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("contentReports.responses");
  await act(async () => resolve({ items: [row], nextCursor: null }));
  expect(host.textContent).not.toContain("Private evidence");
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
