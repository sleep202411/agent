import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskFeedbackCreate } from "./task-feedback-create";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  detail: vi.fn(),
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
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
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

vi.mock("./task-detail-api", () => ({ fetchTaskDetail: h.detail }));
const task = {
  id: id(2),
  crewId: "crew",
  status: "approved",
  submissions: [
    {
      id: id(3),
      versionNumber: 1,
      submittedByUserId: "creator",
      reviewedByUserId: "reviewer",
      reviewedAt: "2026-10-01T00:00:00Z",
    },
  ],
} as import("./task-detail-api").TaskDetail;
let root: Root, host: HTMLDivElement;
const mount = () =>
  act(async () => root.render(<TaskFeedbackCreate task={task} userId="creator" generation={1} />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  h.records.clear();
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  h.detail.mockResolvedValue(task);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("restores the frozen rating after backgrounding and confirms a lost response without a second POST", async () => {
  h.post.mockImplementation(async (_path, { data }) => {
    h.get.mockResolvedValue({
      items: [
        {
          ...data,
          id: id(1),
          taskId: id(2),
          submissionId: id(3),
          authorUserId: "creator",
          response: null,
          respondedAt: null,
          createdAt: "2026-10-01T00:00:00Z",
        },
      ],
      nextCursor: null,
    });
    throw Error("Response lost");
  });
  await mount();
  await click("4");
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Good communication"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("feedbackHistory.submit");
  expect(host.textContent).toContain("Response lost");
  expect(host.querySelector("input")!.readOnly).toBe(true);
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  await mount();
  expect(host.querySelector("input")!.value).toBe("Good communication");
  await click("feedbackHistory.retry");
  expect(host.textContent).toContain("feedbackHistory.saved");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("hides the private form after account generation changes", async () => {
  await mount();
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});

it("retains unsubmitted scores and comment across background without posting", async () => {
  await mount();
  await click("4");
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Useful direction"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  await mount();
  expect(host.querySelector("input")!.value).toBe("Useful direction");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "feedbackHistory.submit")!
      .disabled
  ).toBe(false);
  expect(h.post).not.toHaveBeenCalled();
  h.detail.mockResolvedValueOnce({ ...task, status: "in_progress" });
  await click("feedbackHistory.submit");
  expect(host.textContent).toContain("approved submission or feedback participants have changed");
  expect(h.post).not.toHaveBeenCalled();
});
it("retires an unsubmitted feedback draft when the task route loses focus", async () => {
  await mount();
  await click("4");
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(host.querySelector("input")!.value).toBe("");
  expect(h.post).not.toHaveBeenCalled();
});
