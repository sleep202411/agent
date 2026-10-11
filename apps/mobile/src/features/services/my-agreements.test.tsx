import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MyAgreements } from "./my-agreements";
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

vi.mock("./agreement-detail", () => ({
  AgreementDetail: ({
    crewId,
    agreementId,
    onClose,
  }: {
    crewId: string;
    agreementId: string;
    onClose: () => void;
  }) => (
    <button onClick={onClose}>
      detail:{crewId}:{agreementId}
    </button>
  ),
}));
const row = {
  id: id(1),
  crewId: "crew",
  title: "Agreement one",
  status: "sent",
  updatedAt: "2026-10-04T00:00:00Z",
  crew: { name: "River Crew" },
};
let root: Root, host: HTMLDivElement;
const mount = () => act(async () => root.render(<MyAgreements userId="a" generation={1} />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!.click();
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
it("opens the existing agreement flow and refreshes the selected view on return", async () => {
  await mount();
  await click("crewAgreements.active");
  await click("Agreement one");
  expect(host.textContent).toContain(`detail:crew:${id(1)}`);
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("detail:");
  expect(host.textContent).toContain("crewAgreements.empty");
  expect(h.get).toHaveBeenLastCalledWith(
    "/me/crew-agreements",
    expect.objectContaining({ params: { view: "active", limit: 30 } })
  );
});
it("handles empty intermediate pages and resets pagination with filters", async () => {
  h.get
    .mockResolvedValueOnce({ items: [], nextCursor: id(3) })
    .mockResolvedValue({ items: [row], nextCursor: null });
  await mount();
  await click("crewFinance.more");
  expect(host.textContent).toContain("Agreement one");
  h.get.mockResolvedValue({ items: [{ ...row, status: "signed" }], nextCursor: null });
  await click("crewAgreements.signed");
  expect(h.get).toHaveBeenLastCalledWith(
    "/me/crew-agreements",
    expect.objectContaining({ params: { view: "signed", limit: 30 } })
  );
});
it("clears failed reads and recovers with refresh; rechecks after foreground return", async () => {
  await mount();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.get.mockRejectedValue(Error("Permission changed"));
  h.active = true;
  await mount();
  expect(host.textContent).not.toContain("Agreement one");
  expect(host.textContent).toContain("Permission changed");
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  await click("thread.refresh");
  expect(host.textContent).toContain("Agreement one");
});
it("discards late responses after changing filters or accounts", async () => {
  let resolve!: (v: unknown) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await mount();
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("crewAgreements.signed");
  await act(async () => resolve({ items: [row], nextCursor: null }));
  expect(host.textContent).not.toContain("Agreement one");
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
