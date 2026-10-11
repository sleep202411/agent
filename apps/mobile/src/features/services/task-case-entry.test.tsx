import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCaseEntry } from "./task-case-entry";
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
vi.mock("./task-case-create", () => ({
  TaskCaseCreate: ({
    taskId,
    crewId,
    initiallyOpen,
  }: {
    taskId: string;
    crewId: string;
    initiallyOpen: boolean;
  }) => (
    <span>
      case:{taskId}:{crewId}:{String(initiallyOpen)}
    </span>
  ),
}));
const task = {
  id: id(1),
  title: "Pilot task",
  number: 1,
  taskKind: null,
  crew: { id: id(2), name: "River Crew" },
  status: "open",
  workflowState: { name: "Open", semantic: "open", systemKey: null },
  priority: "normal",
  dueAt: null,
  canSubmit: false,
  canReview: false,
  deadlineRisk: null,
};
const page = {
  items: [task],
  nextCursor: null,
  crews: [task.crew],
  categories: [],
  stats: { dueSoon: 0, pendingReviews: 0 },
};
let root: Root, host: HTMLDivElement;
const mount = () => act(async () => root.render(<TaskCaseEntry userId="alice" generation={1} />));
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
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
it("finds owned tasks and retires the selected case when scope or search changes", async () => {
  await mount();
  expect(h.get.mock.calls[0][1].params.scope).toBe("mine");
  await click("○ River Crew · Pilot task");
  expect(host.textContent).toContain(`case:${id(1)}:${id(2)}:true`);
  await click("○ crewCases.producer");
  expect(host.textContent).not.toContain("case:");
  expect(h.get.mock.calls.at(-1)![1].params.scope).toBe("managed");
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Payment"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("crewCases.searchRecords");
  expect(h.get.mock.calls.at(-1)![1].params.query).toBe("Payment");
});
it("pages task options and hides selected context on denied refresh", async () => {
  h.get.mockResolvedValueOnce({ ...page, nextCursor: id(1) });
  await mount();
  await click("crewCases.moreTasks");
  expect(h.get.mock.calls.at(-1)![1].params.cursor).toBe(id(1));
  await click("○ River Crew · Pilot task");
  h.active = false;
  await mount();
  expect(host.textContent).not.toContain("case:");
  h.get.mockRejectedValue(Error("Access denied"));
  h.active = true;
  await mount();
  expect(host.textContent).toContain("Access denied");
  expect(host.textContent).not.toContain("case:");
});
