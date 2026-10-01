import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskFeedbackHistory } from "./task-feedback";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put, post: h.post } }));
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
  uuid: { v4: () => "00000000-0000-4000-8000-000000000004" },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
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
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = {
  id: id(1),
  taskId: id(2),
  submissionId: id(3),
  authorUserId: "author",
  subjectUserId: "subject",
  ratings: { direction: "manager", managementAbility: 4 },
  comment: "Useful review",
  response: null,
  createdAt: "2026-10-01T00:00:00Z",
  respondedAt: null,
};
let root: Root, host: HTMLDivElement;
const mount = () =>
  act(async () => root.render(<TaskFeedbackHistory userId="subject" generation={1} />));
const click = (label: string, index = 0) =>
  act(async () => {
    [...host.querySelectorAll("button")].filter((b) => b.textContent === label)[index]!.click();
  });
const type = (label: string, text: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  h.records.clear();
  h.active = true;
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
it("renders personal history and clears it on a failed refresh or backgrounding", async () => {
  await mount();
  expect(host.textContent).toContain("Useful review");
  h.get.mockRejectedValueOnce(new Error("Access denied"));
  await click("thread.refresh");
  expect(host.textContent).toContain("Access denied");
  expect(host.textContent).not.toContain("Useful review");
  await click("thread.refresh");
  expect(host.textContent).toContain("Useful review");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
});
it("restores an unknown response and confirms it without a duplicate write", async () => {
  h.put.mockRejectedValueOnce(new Error("Response lost"));
  await mount();
  await type("feedbackHistory.response", "My response");
  await click("feedbackHistory.submit", 0);
  expect(host.textContent).toContain("Response lost");
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="feedbackHistory.response"]')!.readOnly
  ).toBe(true);
  h.get.mockResolvedValue({ items: [{ ...row, response: "My response" }], nextCursor: null });
  await click("feedbackHistory.retry");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("feedbackHistory.saved");
});
it("opens the exact confirmed appeal case and retains the native history on return", async () => {
  h.post.mockResolvedValue({ feedbackId: row.id, dispute: { id: id(4) } });
  await mount();
  await type("feedbackHistory.appeal", "Please review");
  await click("feedbackHistory.submit", 1);
  await click("feedbackHistory.viewCase");
  expect(host.textContent).toContain(`/crews/cases/${id(4)}`);
  await click("feedbackHistory.back");
  expect(host.textContent).toContain("Useful review");
});
