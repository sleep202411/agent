import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationAmendments } from "./application-amendments";
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000003" },
}));
vi.mock("./application-amendments-api", async (original) => ({
  ...(await original<object>()),
  fetchAmendmentContext: h.context,
}));
const h = vi.hoisted(() => ({
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  close: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white", border: "gray" }) }));
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
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
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
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
vi.mock("./crew-finance-api", () => ({
  formatFinanceMoney: (amount: string, currency: string) => `${currency} ${amount}`,
}));

const taskId = "00000000-0000-4000-8000-000000000002";
const proposal = {
  id: "00000000-0000-4000-8000-000000000001",
  expectedVersion: 2,
  expectedTaskVersion: 4,
  scope: "Shots",
  feeAmount: "10000",
  currency: "CNY",
  feePeriod: "project",
  revenueShareBp: 250,
  shareBasis: "Net receipts",
  reason: "Extra shots",
};
const row = {
  id: proposal.id,
  applicationId: "app",
  applicantId: "creator",
  taskId,
  proposedByUserId: "manager",
  proposal,
  status: "pending",
  confirmedAt: null,
  settledAt: null,
  settledByUserId: null,
};
const effective = {
  applicationId: "app",
  version: 2,
  ...proposal,
  proposedByUserId: "manager",
  createdAt: "2026-10-01T00:00:00Z",
  confirmedAt: "2026-10-01T00:00:00Z",
};
const context = {
  scope: { applicationId: "app", applicantId: "creator", taskId },
  terms: { currentVersion: 2, items: [effective], nextBeforeVersion: null },
  canPropose: false,
  canWithdraw: false,
  taskVersion: null as number | null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async (reviewer = false) => {
  await act(async () =>
    root.render(
      <ApplicationAmendments
        crewId="crew"
        applicationId="app"
        applicantId="creator"
        taskId={taskId}
        userId={reviewer ? "manager" : "creator"}
        reviewer={reviewer}
        generation={1}
        onClose={h.close}
      />
    )
  );
};
const type = async (key: string, value: string) => {
  await act(async () => {
    const input = host.querySelector(`textarea[aria-label="${key}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.context.mockResolvedValue(context);
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  h.post.mockResolvedValue({ ...row, status: "effective", confirmedAt: "2026-10-02T00:00:00Z" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires explicit confirmation of the reviewed amendment", async () => {
  await render();
  await click("crewAmendments.confirm");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("nativeAmendments.confirmDecision");
  await click("applicationReview.confirm");
  expect(h.post).toHaveBeenCalledWith(`/applications/app/amendments/${row.id}/decision`, {
    service: "aurora",
    data: { action: "confirm" },
  });
  expect(host.textContent).toContain("crewAmendments.status.effective");
  expect(button("crewAmendments.confirm")).toBeUndefined();
});
it("allows cancel before a decision is sent", async () => {
  await render();
  await click("crewAmendments.reject");
  await click("report.cancel");
  expect(h.post).not.toHaveBeenCalled();
});
it("retries the identical decision after response loss and prevents competing actions", async () => {
  h.post.mockRejectedValueOnce(new Error("Network"));
  await render();
  await click("crewAmendments.confirm");
  await click("applicationReview.confirm");
  expect(button("crewAmendments.refresh").disabled).toBe(true);
  expect(button("crewAmendments.reject").disabled).toBe(true);
  await click("crewAmendments.retry");
  expect(h.post.mock.calls[1]).toEqual(h.post.mock.calls[0]);
});
it("requires reload after baseline conflict", async () => {
  h.post.mockRejectedValueOnce(Object.assign(new Error("Settlement changed"), { status: 409 }));
  await render();
  await click("crewAmendments.confirm");
  await click("applicationReview.confirm");
  expect(button("crewAmendments.confirm").disabled).toBe(true);
  expect(button("crewAmendments.retry")).toBeUndefined();
  await click("crewAmendments.refresh");
  expect(button("crewAmendments.confirm").disabled).toBe(false);
});
it("locks duplicate taps and back while writing", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await click("crewAmendments.confirm");
  await act(async () => {
    button("applicationReview.confirm").click();
    button("applicationReview.confirm").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("nativeApplications.back").disabled).toBe(true);
  await act(async () =>
    resolve({ ...row, status: "effective", confirmedAt: "2026-10-02T00:00:00Z" })
  );
});
it("rejects an awaiting-settlement amendment without reconfirming it", async () => {
  h.get.mockResolvedValue({
    items: [{ ...row, status: "awaiting_settlement", confirmedAt: "2026-10-02T00:00:00Z" }],
    nextCursor: null,
  });
  await render();
  expect(button("crewAmendments.confirm")).toBeUndefined();
  expect(button("crewAmendments.reject")).toBeTruthy();
});
it("lets only the proposer withdraw", async () => {
  h.context.mockResolvedValue({ ...context, canWithdraw: true });
  h.post.mockResolvedValue({ ...row, status: "withdrawn" });
  await render(true);
  expect(button("crewAmendments.confirm")).toBeUndefined();
  await click("crewAmendments.withdraw");
  await click("applicationReview.confirm");
  expect(h.post).toHaveBeenCalledWith(expect.stringContaining("/decision"), {
    service: "aurora",
    data: { action: "withdraw" },
  });
});
async function beginProposal() {
  h.context.mockResolvedValue({ ...context, canPropose: true, canWithdraw: true, taskVersion: 4 });
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await render(true);
  await click("crewAmendments.propose");
}
it("captures terms/task versions and preserves CNY when proposing from a global build", async () => {
  h.post.mockImplementation(async (_path, options) => ({
    ...row,
    id: options.data.id,
    proposal: options.data,
  }));
  await beginProposal();
  expect(
    host.querySelector('textarea[aria-label="crewAmendments.fee"]')!.getAttribute("aria-label")
  ).toBeTruthy();
  await type("crewAmendments.reason", "Additional shots");
  await type("crewAmendments.fee", "150.25");
  await click("crewAmendments.sendProposal");
  expect(h.post).toHaveBeenCalledWith(
    "/applications/app/amendments",
    expect.objectContaining({
      data: expect.objectContaining({
        expectedVersion: 2,
        expectedTaskVersion: 4,
        currency: "CNY",
        feeAmount: "15025",
        reason: "Additional shots",
      }),
    })
  );
});
it("validates the reason and fee without sending", async () => {
  await beginProposal();
  await click("crewAmendments.sendProposal");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("nativeAmendments.invalid");
});
it("reuses the proposal UUID and captured body on retry", async () => {
  h.post.mockRejectedValueOnce(new Error("Network")).mockImplementation(async (_path, options) => ({
    ...row,
    id: options.data.id,
    proposal: options.data,
  }));
  await beginProposal();
  await type("crewAmendments.reason", "Additional shots");
  await click("crewAmendments.sendProposal");
  expect([...host.querySelectorAll("textarea")].every((i) => i.disabled)).toBe(true);
  await click("crewAmendments.retry");
  expect(h.post.mock.calls[1]).toEqual(h.post.mock.calls[0]);
});
it("does not offer another proposal while one awaits consent", async () => {
  h.context.mockResolvedValue({ ...context, canPropose: true, canWithdraw: true, taskVersion: 4 });
  await render(true);
  expect(button("crewAmendments.propose")).toBeUndefined();
});
it("loads the next history page using its UUID cursor", async () => {
  h.get
    .mockResolvedValueOnce({ items: [row], nextCursor: row.id })
    .mockResolvedValue({ items: [], nextCursor: null });
  await render();
  await click("crewAmendments.more");
  expect(h.get).toHaveBeenLastCalledWith(
    "/applications/app/amendments",
    expect.objectContaining({ params: { limit: 20, cursor: row.id } })
  );
});
it("does not submit after account switch", async () => {
  await render();
  await click("crewAmendments.confirm");
  h.generation = 2;
  await click("applicationReview.confirm");
  expect(h.post).not.toHaveBeenCalled();
});
it("ignores late success after leaving", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await click("crewAmendments.confirm");
  await click("applicationReview.confirm");
  await act(async () => root.render(null));
  await act(async () =>
    resolve({ ...row, status: "effective", confirmedAt: "2026-10-02T00:00:00Z" })
  );
  expect(host.textContent).toBe("");
});
