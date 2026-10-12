import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewComputeFinance } from "./crew-compute-finance";
const h = vi.hoisted(() => ({
  owner: false,
  consumed: "123",
  badData: undefined as unknown,
  failed: false,
  pending: false,
  refetch: vi.fn(),
  tasks: [] as {
    id: string;
    title: string;
    number: number;
    assignees?: { userId: string }[];
    topUpRequested?: boolean;
  }[],
  mutate: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: "creator", nickname: "Creator" } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("../_hooks/use-compute-requests", () => ({
  useComputeWorkspaceSetup: () => ({ mutate: vi.fn(), isPending: false }),
  useComputeRequestAction: () => ({ mutate: h.mutate, isPending: false }),
  useComputeRequests: () => ({
    isPending: h.pending,
    isError: h.failed,
    error: new Error("Finance service unavailable"),
    refetch: h.refetch,
    data: h.badData ?? {
      isOwner: h.owner,
      workspaceLinked: true,
      tasks: h.tasks,
      totals: { pending: 50, approved: 100 },
      consumedPoints: h.consumed,
      nextCursor: null,
      items: [
        {
          id: "request",
          taskId: "task",
          taskTitle: "Shot one",
          userId: "creator",
          points: 50,
          reason: "Render shot",
          status: "pending",
          createdAt: "2026-09-28T00:00:00Z",
        },
      ],
    },
  }),
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("task")}>
      chooseTask
    </button>
  ),
  NativeSelectOption: () => null,
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.owner = false;
  h.consumed = "123";
  h.badData = undefined;
  h.failed = false;
  h.pending = false;
  h.refetch.mockReset();
  h.tasks = [];
  h.mutate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<CrewComputeFinance crewId="crew" crewName="Film Crew" />));
}
it("shows recorded consumption and requires an assigned task", async () => {
  await render();
  expect(host.textContent).toContain("USD 1.23");
  expect(host.querySelector("form")).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "approve")
  ).toBe(false);
});
it("does not expose approval or rejection even to the Crew owner", async () => {
  h.owner = true;
  await render();
  const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
  expect(labels).not.toContain("approve");
  expect(labels).not.toContain("reject");
  expect(host.textContent).not.toContain("decisionNote");
  expect(h.mutate).not.toHaveBeenCalled();
});
it("keeps the submit key stable across retries until details change", async () => {
  h.owner = true;
  h.tasks = [{ id: "task", title: "Shot one", number: 1, assignees: [{ userId: "creator" }] }];
  await render();
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "chooseTask")!
      .click();
  });
  await act(async () => {
    const workload = host.querySelector('input[step="0.01"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(workload, "10");
    workload.dispatchEvent(new Event("input", { bubbles: true }));
    const input = host.querySelector('input[step="1"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "50");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const textarea = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      "Render shot"
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await act(async () => {
    submit();
  });
  await act(async () => {
    submit();
  });
  expect(h.mutate).toHaveBeenCalledTimes(2);
  expect(h.mutate.mock.calls[0][0]).toEqual(h.mutate.mock.calls[1][0]);
  expect(h.mutate.mock.calls[0][0]).toMatchObject({
    taskId: "task",
    points: 50,
    reason: "Render shot",
  });
});

it("can open Finance when randomUUID is unavailable in the browser", async () => {
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    await render();
    expect(host.querySelector("form")).not.toBeNull();
  } finally {
    if (original) Object.defineProperty(crypto, "randomUUID", original);
    else delete (crypto as Partial<Crypto>).randomUUID;
  }
});
it("does not crash or show a false zero for malformed consumption", async () => {
  h.consumed = "not-an-integer";
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain("USD 0.00");
});

it.each([{}, { items: null }, { items: [null] }, { consumedPoints: "0", items: [], tasks: null }])(
  "shows retry for malformed Finance payloads: %j",
  async (badData) => {
    h.badData = badData;
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("loadFailed");
    expect(host.querySelector("form")).toBeNull();
    await act(async () => host.querySelector("button")!.click());
    expect(h.refetch).toHaveBeenCalledOnce();
  }
);
it("shows server errors without displaying cached balances or request forms", async () => {
  h.failed = true;
  await render();
  expect(host.textContent).toContain("Finance service unavailable");
  expect(host.textContent).not.toContain("USD");
});
it("can render a loading state before Finance data is available", async () => {
  h.pending = true;
  h.badData = {};
  await render();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("loading");
});

it("shows the project allowance and the disclosed producer adjustment", async () => {
  h.badData = {
    isOwner: true,
    consumedPoints: "5000",
    totals: {},
    tasks: [],
    items: [],
    nextCursor: null,
    projectBudget: {
      version: 2,
      durationSeconds: 60,
      totalPoints: "4462",
      releasedPoints: "6000",
      closed: true,
      producerSettlement: {
        grossMinor: "10000",
        deductionMinor: "1000",
        currency: "CNY",
        note: "Approved CASE-12",
      },
    },
  };
  await render();
  expect(host.textContent).toContain("projectBudgetSummary");
  expect(host.textContent).toContain("projectBudgetClosed");
  expect(host.textContent).toContain("Approved CASE-12");
});

it("shows exact per-person task spending and keeps other task rows out of task view", async () => {
  h.badData = {
    isOwner: true,
    tasks: [],
    totals: {},
    consumedPoints: "7",
    nextCursor: null,
    items: [],
    taskUsage: [
      {
        taskId: "task",
        taskTitle: "Selected shot",
        userId: "alice",
        approvedPoints: "100",
        pendingPoints: "20",
        consumedPoints: "7",
        committedPoints: "10",
      },
      {
        taskId: "other",
        taskTitle: "Other shot",
        userId: "bob",
        approvedPoints: "50",
        pendingPoints: "0",
        consumedPoints: "0",
        committedPoints: "0",
      },
    ],
  };
  await act(async () =>
    root.render(<CrewComputeFinance crewId="crew" crewName="Film" initialTaskId="task" />)
  );
  expect(host.textContent).toContain("Selected shot");
  expect(host.textContent).toContain("alice");
  expect(host.textContent).not.toContain("Other shot");
  expect(host.textContent).toContain("committed");
});

it("allows creators to open their own points request form", async () => {
  h.tasks = [{ id: "task", title: "Shot", number: 1, assignees: [{ userId: "creator" }] }];
  await render();
  expect(host.querySelector("form")).not.toBeNull();
  expect(host.querySelector("form")).not.toBeNull();
});

it("requires assignment and blocks a second application independently of request-page pagination", async () => {
  h.owner = true;
  h.tasks = [{ id: "task", title: "Shot one", number: 1, assignees: [] }];
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "chooseTask")!.click()
  );
  expect(host.textContent).toContain("assignFirst");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  h.tasks = [
    {
      id: "task",
      title: "Shot one",
      number: 1,
      assignees: [{ userId: "creator" }],
      topUpRequested: true,
    },
  ];
  await render();
  expect(host.textContent).toContain("topUpAlreadyApplied");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[step="1"]')!.max).toBe("3000");
});
