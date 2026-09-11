import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crewApi, CrewApiError } from "./api";
import { crewKeys } from "./shared";
import {
  useCreateCrewTask,
  useUpdateCrewTask,
  useSubmitCrewTask,
  useReviewCrewTask,
  useBatchUpdateCrewTasks,
  useUpdateCrewTaskView,
  useDeleteCrewTaskLabel,
  useDeleteCrewTaskCycle,
  useDeleteCrewTaskField,
  useUpdateCrewTaskWorkflowState,
} from "./use-tasks";
import { useCrewMembers } from "./use-members";
import { useApproveCrewEarning, useReverseCrewEarning } from "./use-earnings";
import { usePayCrewPayout, useVoidCrewPayout } from "./use-payouts";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, crewApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let client: QueryClient;
let container: HTMLDivElement;
function mount<T>(hook: () => T) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let result: T;
  function Probe() {
    result = hook();
    return null;
  }
  act(() =>
    root!.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  );
  return () => result!;
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  container?.remove();
  vi.resetAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe("crew roster pagination", () => {
  it("stops automatic pagination after a failed page and supports an explicit retry", async () => {
    vi.mocked(crewApi.get)
      .mockResolvedValueOnce({ items: [{ id: "member-1" }], nextCursor: "member-1", total: 2 })
      .mockRejectedValue(new CrewApiError(403, { message: "Roster access denied" }));
    const current = mount(() => useCrewMembers("crew-1"));
    await vi.waitFor(async () => {
      await settle();
      expect(current().isFetchNextPageError).toBe(true);
    });
    await settle();
    expect(crewApi.get).toHaveBeenCalledTimes(2);
    expect(current().data).toEqual([{ id: "member-1" }]);

    vi.mocked(crewApi.get).mockResolvedValueOnce({
      items: [{ id: "member-2" }],
      nextCursor: null,
      total: 2,
    });
    await act(async () => {
      await current().fetchNextPage();
    });
    await settle();
    expect(current().data).toEqual([{ id: "member-1" }, { id: "member-2" }]);
    expect(current().hasNextPage).toBe(false);
  });
});

describe("crew finance cache refresh", () => {
  it.each([
    ["approve", useApproveCrewEarning],
    ["reverse", useReverseCrewEarning],
  ] as const)("refreshes payout balances and the audit trail after %s", async (_action, hook) => {
    const current = mount(() => hook("crew-1"));
    const detailKey = crewKeys.earning("earning-1");
    const ownPayouts = [...crewKeys.payouts("crew-1", "mine"), "all", "USD"];
    const crewPayouts = [...crewKeys.payouts("crew-1", "crew"), "all", "USD"];
    const otherCrew = crewKeys.payouts("crew-2", "crew");
    for (const key of [detailKey, ownPayouts, crewPayouts, otherCrew]) {
      client.setQueryData(key, { events: [] });
    }
    vi.mocked(crewApi.post).mockResolvedValue({ id: "earning-1", status: "posted", version: 2 });
    await act(async () => {
      await current().mutateAsync({ earningId: "earning-1", expectedVersion: 1 });
    });
    for (const key of [detailKey, ownPayouts, crewPayouts]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(otherCrew)?.isInvalidated).toBe(false);
  });

  it.each([
    ["pay", usePayCrewPayout],
    ["void", useVoidCrewPayout],
  ] as const)("refreshes payout details and audit events after %s", async (_action, hook) => {
    const current = mount(() => hook("crew-1"));
    const detailKey = crewKeys.payout("payout-1");
    const listKey = crewKeys.payouts("crew-1", "crew");
    client.setQueryData(detailKey, { events: [] });
    client.setQueryData(listKey, {});
    vi.mocked(crewApi.post).mockResolvedValue({ id: "payout-1", version: 2 });
    await act(async () => {
      await current().mutateAsync({ payoutId: "payout-1", expectedVersion: 1 });
    });
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("refreshes the earning detail and available balance after a conflicting decision", async () => {
    const current = mount(() => useReverseCrewEarning("crew-1"));
    const detailKey = crewKeys.earning("earning-1");
    const payoutKey = crewKeys.payouts("crew-1", "mine");
    client.setQueryData(detailKey, { version: 1 });
    client.setQueryData(payoutKey, {});
    vi.mocked(crewApi.post).mockRejectedValue(new Error("Earning already allocated"));
    await act(async () => {
      await expect(
        current().mutateAsync({ earningId: "earning-1", expectedVersion: 1 })
      ).rejects.toThrow("Earning already allocated");
    });
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(payoutKey)?.isInvalidated).toBe(true);
  });
});

describe("task metadata cache refresh", () => {
  it.each([
    ["label", useDeleteCrewTaskLabel],
    ["cycle", useDeleteCrewTaskCycle],
    ["field", useDeleteCrewTaskField],
  ] as const)("refreshes cached task details after deleting a %s", async (_name, hook) => {
    const current = mount(() => hook("crew-1"));
    const detail = crewKeys.task("task-1");
    const unrelated = crewKeys.task("task-2");
    client.setQueryData(detail, { crewId: "crew-1" });
    client.setQueryData(unrelated, { crewId: "crew-2" });
    vi.mocked(crewApi.delete).mockResolvedValue(undefined);
    await act(async () => {
      await current().mutateAsync("metadata-1");
    });
    expect(client.getQueryState(detail)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });
  it("refreshes task details after replacing an archived workflow state", async () => {
    const current = mount(() => useUpdateCrewTaskWorkflowState("crew-1"));
    const detail = crewKeys.task("task-1");
    client.setQueryData(detail, { crewId: "crew-1", workflowStateId: "old" });
    vi.mocked(crewApi.patch).mockResolvedValue({});
    await act(async () => {
      await current().mutateAsync({
        stateId: "old",
        input: {
          expectedVersion: 1,
          archived: true,
          replacementStateId: "new",
        },
      });
    });
    expect(client.getQueryState(detail)?.isInvalidated).toBe(true);
  });
});

it("refreshes saved-view results when its filters change without a new view ID", async () => {
  const current = mount(() => useUpdateCrewTaskView("crew-1"));
  const view = crewKeys.taskView("crew-1", { viewId: "view-1" });
  const other = crewKeys.taskView("crew-2", { viewId: "view-2" });
  client.setQueryData(view, { pages: [{ items: [{ id: "old-result" }] }] });
  client.setQueryData(other, { pages: [] });
  vi.mocked(crewApi.patch).mockResolvedValue({ id: "view-1" });
  await act(async () => {
    await current().mutateAsync({
      viewId: "view-1",
      input: {
        expectedUpdatedAt: "2026-09-11T00:00:00.000Z",
        filters: { priorities: ["high"] },
      },
    });
  });
  expect(client.getQueryState(view)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

it("updates cached task versions and details after a bulk edit without relying on realtime", async () => {
  const current = mount(() => useBatchUpdateCrewTasks("crew-1"));
  const detail = crewKeys.task("task-1");
  const other = crewKeys.task("task-2");
  const updated = { id: "task-1", crewId: "crew-1", version: 2, priority: "high" };
  client.setQueryData(detail, { ...updated, version: 1, priority: "low" });
  client.setQueryData(other, { id: "task-2", version: 1 });
  vi.mocked(crewApi.patch).mockResolvedValue([updated]);
  await act(async () => {
    await current().mutateAsync({ taskIds: ["task-1"], priority: "high" });
  });
  expect(client.getQueryData(detail)).toEqual(updated);
  expect(client.getQueryData(other)).toEqual({ id: "task-2", version: 1 });
});

it.each(["create", "update", "submit", "review"] as const)(
  "refreshes related task details after %s while preserving the returned task",
  async (action) => {
    const current = mount(() => ({
      create: useCreateCrewTask("crew-1"),
      update: useUpdateCrewTask("crew-1"),
      submit: useSubmitCrewTask("crew-1"),
      review: useReviewCrewTask("crew-1"),
    }));
    const parent = crewKeys.task("parent");
    const other = crewKeys.task("unrelated");
    client.setQueryData(parent, { id: "parent", crewId: "crew-1", children: [] });
    client.setQueryData(other, { id: "unrelated", crewId: "crew-2" });
    const updated = { id: "child", crewId: "crew-1", version: 2 };
    vi.mocked(crewApi.post).mockResolvedValue(updated);
    vi.mocked(crewApi.patch).mockResolvedValue(updated);
    await act(async () => {
      if (action === "create")
        await current().create.mutateAsync({ title: "Child", parentId: "parent" } as Parameters<
          ReturnType<typeof useCreateCrewTask>["mutateAsync"]
        >[0]);
      if (action === "update")
        await current().update.mutateAsync({
          taskId: "child",
          input: { expectedVersion: 1, title: "New title" },
        });
      if (action === "submit")
        await current().submit.mutateAsync({ taskId: "child", note: "Ready" });
      if (action === "review")
        await current().review.mutateAsync({
          taskId: "child",
          decision: "approve",
          note: "Accepted",
        });
    });
    expect(client.getQueryState(parent)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(client.getQueryData(crewKeys.task("child"))).toEqual(updated);
    expect(client.getQueryState(crewKeys.task("child"))?.isInvalidated).toBe(false);
  }
);
