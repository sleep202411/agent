import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCaseCreate } from "./task-case-create";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  detail: vi.fn(),
  push: vi.fn(),
  pick: vi.fn(),
  fetch: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
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

vi.mock("./task-detail-api", () => ({ fetchTaskDetail: h.detail }));

vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
const task = {
  id: id(1),
  crewId: "crew",
  createdByUserId: "creator",
  approvedByUserId: null,
  assignees: [],
  submissions: [
    { id: id(2), versionNumber: 1, submittedByUserId: "creator", reviewedByUserId: "reviewer" },
  ],
};
const row = {
  id: id(4),
  taskId: id(1),
  openedByUserId: "creator",
  respondentUserId: "reviewer",
  title: "Delivery issue",
  category: "payment",
  status: "open",
  version: 1,
  ownerAdminId: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
let root: Root, host: HTMLDivElement;
const mount = () =>
  act(async () =>
    root.render(<TaskCaseCreate crewId="crew" taskId={id(1)} userId="creator" generation={1} />)
  );
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
const type = (label: string, text: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.records.clear();
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue({ ok: true });
  h.get.mockImplementation(async (path: string) =>
    path.startsWith("/crews/") ? { id: "crew", ownerUserId: "owner" } : task
  );
  h.post.mockResolvedValue(row);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("creates from selected task participants/evidence and opens the returned native case route", async () => {
  await mount();
  await click("taskCase.open");
  await click("○ reviewer");
  await click("○ crewTaskDispute.categories.payment");
  await type("taskCase.subject", "Delivery issue");
  await type("privateCases.message", "Please review");
  await click(`☐ 1 · ${id(2)}`);
  await click("feedbackHistory.submit");
  expect(h.post.mock.calls[0]![1].data.submissionIds).toEqual([id(2)]);
  await click("feedbackHistory.viewCase");
  expect(h.push).toHaveBeenCalledWith({ pathname: "/private-cases", params: { caseId: id(4) } });
});
it("restores the exact creation intent after a lost response and backgrounding", async () => {
  h.post.mockRejectedValueOnce(Error("Response lost")).mockResolvedValue(row);
  await mount();
  await click("taskCase.open");
  await click("○ reviewer");
  await click("○ crewTaskDispute.categories.payment");
  await type("taskCase.subject", "Delivery issue");
  await type("privateCases.message", "Please review");
  await click("feedbackHistory.submit");
  expect(host.textContent).toContain("Response lost");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  await mount();
  await click("taskCase.open");
  expect(host.querySelector("input")!.readOnly).toBe(true);
  await click("feedbackHistory.retry");
  expect(h.post.mock.calls[0]![1].data).toEqual(h.post.mock.calls[1]![1].data);
  expect(host.textContent).toContain("feedbackHistory.saved");
});
it("does not offer creation when fresh context cannot be read", async () => {
  h.get.mockRejectedValue(Error("Access denied"));
  await mount();
  await click("taskCase.open");
  expect(host.textContent).toContain("Access denied");
  expect(host.querySelector("input")).toBeNull();
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});

it("lets the user clear submission evidence removed during a refresh", async () => {
  await mount();
  await click("taskCase.open");
  await click(`☐ 1 · ${id(2)}`);
  h.get.mockImplementation(async (path: string) =>
    path.startsWith("/crews/") ? { id: "crew", ownerUserId: "owner" } : { ...task, submissions: [] }
  );
  await click("thread.refresh");
  expect(host.textContent).toContain("taskCase.clearEvidence");
  await click("taskCase.clearEvidence");
  expect(host.textContent).not.toContain("taskCase.clearEvidence");
});

it("opens existing private cases even when task participation cannot be loaded", async () => {
  h.get.mockRejectedValue(Error("Access denied"));
  await mount();
  await click("taskCase.open");
  await click("feedbackHistory.cases");
  expect(h.push).toHaveBeenCalledWith("/private-cases");
});

it("restores incomplete initial evidence and confirms stored bytes before opening the exact case", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [
      {
        name: "private.pdf",
        mimeType: "application/pdf",
        size: 3,
        file: new Blob(["pdf"], { type: "application/pdf" }),
      },
    ],
  });
  let confirm = false;
  h.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/confirm")) {
      if (!confirm) throw Error("Confirmation lost");
      return { id: id(4) };
    }
    if (path.includes("/attachments/"))
      return {
        url: "https://files.test/put",
        method: "PUT",
        headers: {},
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    return row;
  });
  await mount();
  await click("taskCase.open");
  await click("crewTaskDispute.initialEvidence");
  expect(host.textContent).toContain("Confirmation lost");
  expect(h.post.mock.calls[0][0]).toBe(
    `/crew-tasks/${id(1)}/dispute-drafts/${id(4)}/attachments/${id(4)}`
  );
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  await click("taskCase.open");
  expect(host.textContent).toContain("private.pdf");
  confirm = true;
  await click("crewEvidence.confirmStored");
  expect(h.fetch).toHaveBeenCalledTimes(1);
  await click("○ reviewer");
  await click("○ crewTaskDispute.categories.payment");
  await type("taskCase.subject", "Delivery issue");
  await type("privateCases.message", "Please review");
  await click("feedbackHistory.submit");
  expect(h.post.mock.calls.at(-1)![1].data).toMatchObject({
    id: id(4),
    attachmentIds: [id(4)],
    category: "payment",
  });
  expect(host.textContent).toContain("feedbackHistory.saved");
  expect(h.records.get(`task-case-initial-evidence:creator:${id(1)}`)).toBe("");
});
it("requires classification before sending and preserves the optional requested outcome", async () => {
  await mount();
  await click("taskCase.open");
  await click("○ reviewer");
  await type("taskCase.subject", "Delivery issue");
  await type("privateCases.message", "Please review");
  await click("feedbackHistory.submit");
  expect(h.post).not.toHaveBeenCalled();
  await click("○ crewTaskDispute.categories.payment");
  await click("○ crewTaskDispute.resolutions.warning");
  h.post.mockResolvedValue({ ...row, desiredResolution: "warning" });
  await click("feedbackHistory.submit");
  expect(h.post.mock.calls[0][1].data.desiredResolution).toBe("warning");
  expect(host.textContent).toContain("feedbackHistory.saved");
});

it("preserves unsubmitted complaint text and choices when collapsing the form", async () => {
  await mount();
  await click("taskCase.open");
  await click("○ reviewer");
  await click("○ crewTaskDispute.categories.payment");
  await type("taskCase.subject", "Keep my draft");
  await click("taskCase.open");
  await click("taskCase.open");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="taskCase.subject"]')!.value).toBe(
    "Keep my draft"
  );
  expect(host.textContent).toContain("● crewTaskDispute.categories.payment");
});
