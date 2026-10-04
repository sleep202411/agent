import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PrivateCases } from "./private-cases";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
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
vi.mock("./case-evidence", () => ({
  CaseEvidence: ({
    caseId,
    selected,
    onSelect,
    disabled,
  }: {
    caseId: string;
    selected: string[];
    onSelect: (ids: string[]) => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={() => onSelect(["00000000-0000-4000-8000-000000000007"])}>
      evidence:{caseId}:{selected.length}
    </button>
  ),
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
  h.focused = true;
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
  expect(host.querySelector("input")!.value).toBe("Please review");
  h.active = true;
  await mount();
  expect(host.querySelector("input")!.readOnly).toBe(true);
  expect(host.querySelector("input")!.value).toBe("Please review");
  await click("feedbackHistory.retry");
  expect(host.textContent).toContain("feedbackHistory.saved");
  expect(h.post.mock.calls[0]![1].data).toEqual(h.post.mock.calls[1]![1].data);
});
it("uses native evidence selection in the case and hides it after account changes", async () => {
  await mount();
  await click("Private case");
  expect(host.textContent).toContain(`evidence:${id(1)}:0`);
  await click(`evidence:${id(1)}:0`);
  expect(host.textContent).toContain(`evidence:${id(1)}:1`);
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});

it("keeps an unsent case message and evidence selected across background return", async () => {
  await mount();
  await click("Private case");
  await click(`evidence:${id(1)}:0`);
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Unsent evidence explanation"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const reads = h.get.mock.calls.length;
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(h.get.mock.calls.length).toBeGreaterThan(reads);
  expect(host.querySelector("input")!.value).toBe("Unsent evidence explanation");
  expect(host.textContent).toContain(`evidence:${id(1)}:1`);
  expect(h.post).not.toHaveBeenCalled();
});
it("keeps the draft locked after foreground access failure until the user refreshes", async () => {
  await mount();
  await click("Private case");
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Unsent message"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  h.active = false;
  await mount();
  h.get.mockRejectedValueOnce(Error("Case access denied"));
  h.active = true;
  await mount();
  expect(host.textContent).toContain("Case access denied");
  expect(host.querySelector("input")!.value).toBe("Unsent message");
  expect(host.querySelector("input")!.readOnly).toBe(true);
  await click("feedbackHistory.submit");
  expect(h.post).not.toHaveBeenCalled();
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
});
