import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PrivateCases } from "./private-cases";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post },
  ApiRequestError: class extends Error {},
}));
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
  openedByUserId: "a",
  respondentUserId: "b",
  title: "Private case",
  status: "open",
  ownerAdminId: null,
  version: 2,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const history = {
  ...row,
  events: [
    {
      id: id(3),
      version: 2,
      actorId: "a",
      actorKind: "user",
      action: "message",
      message: "Existing discussion",
      submissionIds: [],
      attachmentIds: [],
      createdAt: row.createdAt,
    },
  ],
  nextBeforeVersion: null,
};
let root: Root, host: HTMLDivElement;
const mount = () => act(async () => root.render(<PrivateCases userId="a" generation={1} />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.records.clear();
  h.get.mockImplementation(async (path: string) =>
    path === "/crew-disputes" ? { items: [row], nextBeforeId: null } : history
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("opens a native case and clears private history after access is denied", async () => {
  await mount();
  await click("Private case");
  expect(host.textContent).toContain("Existing discussion");
  h.get.mockRejectedValue(Error("Access denied"));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Existing discussion");
  expect(host.textContent).toContain("Access denied");
});
it("restores a pending message and retries the exact version/key after a lost response", async () => {
  h.post.mockRejectedValueOnce(Error("Response lost")).mockResolvedValue({ ...row, version: 3 });
  await mount();
  await click("Private case");
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Please review"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("feedbackHistory.submit");
  expect(host.textContent).toContain("Response lost");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  await mount();
  await click("Private case");
  expect(host.querySelector("input")!.readOnly).toBe(true);
  expect(host.querySelector("input")!.value).toBe("Please review");
  await click("feedbackHistory.retry");
  expect(host.textContent).toContain("feedbackHistory.saved");
  expect(h.post.mock.calls[0]![1].data).toEqual(h.post.mock.calls[1]![1].data);
});
it("hands evidence to the exact authenticated case page and refreshes on return", async () => {
  await mount();
  await click("Private case");
  await click("privateCases.evidence");
  expect(host.textContent).toContain(`web:/crews/cases/${id(1)}`);
  await click("privateCases.backDetail");
  expect(host.textContent).toContain("Existing discussion");
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
