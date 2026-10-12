import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewCompute } from "./crew-compute";

vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  sign: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./crew-agreements-api", async (original) => ({
  ...(await original<typeof import("./crew-agreements-api")>()),
  fetchCrewAgreements: h.detail,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
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
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "33333333-3333-4333-8333-333333333333" },
}));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./crew-compute-api", async (original) => ({
  ...(await original<typeof import("./crew-compute-api")>()),
  fetchCompute: h.detail,
  createCompute: h.sign,
}));
const id = "11111111-1111-4111-8111-111111111111",
  next = "22222222-2222-4222-8222-222222222222";
const row = {
  id,
  crewId: "crew",
  userId: "user",
  kind: "top_up",
  requestedByUserId: "user",
  remainingWorkload: "1.5",
  workloadUnit: "hours",
  taskId: id,
  taskTitle: "Scene",
  points: 20,
  reason: "Render",
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
  decidedByAdminId: null,
  decidedByUserId: null,
  decisionNote: null,
  requestKey: next,
};
const page = {
  isOwner: true,
  workspaceLinked: true,
  projectBudget: null,
  taskUsage: [],
  consumedPoints: "9007199254740993",
  totals: { pending: 20 },
  tasks: [
    { id, title: "Scene", number: 1, topUpRequested: false, assignees: [{ userId: "user" }] },
  ],
  items: [row],
  nextCursor: null,
};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const render = () =>
  act(async () =>
    root.render(<CrewCompute crewId="crew" userId="user" generation={1} onClose={h.close} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function enter(label: string, value: string) {
  await act(async () => {
    const node = host.querySelector(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function fill() {
  await render();
  await act(async () => button("TASK-1").click());
  await enter("crewComputeFinance.points", "20");
  await enter("crewComputeFinance.reason", "Render");
  await enter("crewComputeFinance.remainingWorkload", "1.5");
}
it("shows authoritative usage, applicant and no approval control", async () => {
  await render();
  expect(host.textContent).toContain("9007199254740993");
  expect(host.textContent).toContain("crewComputeFinance.applicant · user");
  expect(button("approve")).toBeUndefined();
});
it("validates before sending", async () => {
  await render();
  await act(async () => button("crewComputeFinance.request").click());
  expect(h.sign).not.toHaveBeenCalled();
  expect(host.textContent).toContain("mobileCompute.invalid");
});
it("blocks duplicate taps and refreshes on success", async () => {
  await fill();
  await act(async () => {
    button("crewComputeFinance.request").click();
    button("crewComputeFinance.request").click();
  });
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.detail).toHaveBeenCalledTimes(2);
});
it("retries frozen request terms and key after network failure", async () => {
  h.sign.mockRejectedValueOnce(new Error("Offline"));
  await fill();
  await act(async () => button("crewComputeFinance.request").click());
  const first = h.sign.mock.calls[0];
  expect(host.textContent).toContain("Offline");
  expect([...host.querySelectorAll("input")].every((i) => i.disabled)).toBe(true);
  await act(async () => button("mobileCompute.retry").click());
  expect(h.sign.mock.calls[1]).toEqual(first);
});
it("clears history when next page loses access", async () => {
  h.detail
    .mockResolvedValueOnce({ ...page, nextCursor: next })
    .mockRejectedValueOnce(new Error("Membership required"));
  await render();
  await act(async () => button("crewComputeFinance.older").click());
  expect(host.textContent).toContain("Membership required");
  expect(host.textContent).not.toContain("Render");
});
it("does not refresh stale account on completion", async () => {
  let resolve!: () => void;
  h.sign.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  await fill();
  await act(async () => button("crewComputeFinance.request").click());
  h.generation = 2;
  await act(async () => resolve());
  expect(h.detail).toHaveBeenCalledTimes(1);
});

it("lets assigned creators apply for themselves", async () => {
  h.detail.mockResolvedValue({ ...page, isOwner: false });
  await render();
  expect(host.textContent).not.toContain("crewComputeFinance.ownerOnly");
  expect(button("crewComputeFinance.request")).toBeDefined();
});
it("blocks a second application even after rejection", async () => {
  h.detail.mockResolvedValue({ ...page, tasks: [{ ...page.tasks[0], topUpRequested: true }] });
  await render();
  await act(async () => button("TASK-1").click());
  expect(host.textContent).toContain("crewComputeFinance.topUpAlreadyApplied");
  expect(button("crewComputeFinance.request").disabled).toBe(true);
});
it("sends self-bound beneficiary and workload", async () => {
  await fill();
  await act(async () => button("crewComputeFinance.request").click());
  expect(h.sign).toHaveBeenCalledWith(
    "crew",
    "user",
    expect.objectContaining({
      beneficiaryUserId: "user",
      remainingWorkload: 1.5,
      workloadUnit: "minutes",
    }),
    1
  );
});

it("shows the stored budget rate and separates credited points from allowance", async () => {
  h.detail.mockResolvedValue({
    ...page,
    projectBudget: {
      pointsPerMinute: 4460,
      totalPoints: "44600",
      releasedPoints: "22300",
      closed: false,
    },
    taskUsage: [
      {
        taskId: id,
        taskTitle: "Scene",
        userId: "user",
        approvedPoints: "900",
        creditedPoints: "400",
        pendingPoints: "0",
        consumedPoints: "100",
        committedPoints: "200",
      },
    ],
  });
  await render();
  expect(host.textContent).toContain("crewComputeFinance.approvedTotal · 900");
  expect(host.textContent).toContain("mobileProduction.credited · 400");
  expect(host.textContent).toContain("crewComputeFinance.committed · 200");
});

it("submits an assigned creator request without manual workspace setup", async () => {
  h.detail.mockResolvedValue({ ...page, workspaceLinked: false, isOwner: false });
  await fill();
  expect(host.textContent).not.toContain("crewComputeFinance.setupWorkspace");
  await act(async () => button("crewComputeFinance.request").click());
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.sign).toHaveBeenCalledWith(
    "crew",
    "user",
    expect.objectContaining({ beneficiaryUserId: "user", points: 20 }),
    1
  );
});
