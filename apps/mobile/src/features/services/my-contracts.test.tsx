import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MyContracts } from "./my-contracts";
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

vi.mock("./my-agreements", () => ({ MyAgreements: () => <span>agreement inbox</span> }));
vi.mock("./task-contract", () => ({
  TaskContract: ({ assetId }: { assetId: string }) => <span>contract:{assetId}</span>,
}));
const task = {
  id: id(1),
  title: "Storyboard contract",
  number: 1,
  taskKind: "script",
  crew: { id: id(2), name: "River Crew" },
  status: "open",
  workflowState: { name: "Open", semantic: "open", systemKey: null },
  priority: "normal",
  dueAt: null,
  canSubmit: false,
  canReview: false,
  deadlineRisk: null,
  contractAssetNodeId: id(3),
};
const page = {
  items: [task],
  nextCursor: null,
  crews: [task.crew],
  categories: ["script"],
  stats: { dueSoon: 0, pendingReviews: 0 },
};
let root: Root, host: HTMLDivElement;
const mount = () => act(async () => root.render(<MyContracts userId="a" generation={1} />));
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  h.get.mockResolvedValue(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads only contracts after switching from agreements and preserves pagination", async () => {
  h.get.mockResolvedValueOnce({ ...page, nextCursor: id(1) });
  await mount();
  expect(host.textContent).toContain("agreement inbox");
  expect(h.get).not.toHaveBeenCalled();
  await click("myContracts.files");
  expect(host.textContent).toContain(`contract:${id(3)}`);
  expect(h.get.mock.calls[0][1].params).toMatchObject({
    hasContract: "true",
    scope: "all",
    status: "all",
  });
  h.get.mockResolvedValue({ ...page, items: [] });
  await click("crewFinance.more");
  expect(h.get.mock.calls.at(-1)![1].params.cursor).toBe(id(1));
  await click("myContracts.agreements");
  expect(host.textContent).not.toContain("Storyboard contract");
});
it("hides inaccessible files and recovers on refresh", async () => {
  await mount();
  await click("myContracts.files");
  h.get.mockRejectedValue(Error("Permission denied"));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("contract:");
  expect(host.textContent).toContain("Permission denied");
  h.get.mockResolvedValue({ ...page, items: [] });
  await click("common.retry");
  expect(host.textContent).toContain("myContracts.empty");
});
it("keeps the section but reloads after backgrounding; clears changed accounts", async () => {
  await mount();
  await click("myContracts.files");
  h.active = false;
  await mount();
  expect(host.textContent).not.toContain("Storyboard contract");
  h.get.mockResolvedValue({ ...page, items: [] });
  h.active = true;
  await mount();
  expect(host.textContent).toContain("myContracts.empty");
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
