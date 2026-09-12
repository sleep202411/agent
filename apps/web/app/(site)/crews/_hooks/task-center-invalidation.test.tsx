// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useCreateCrewTask, useUpdateCrewTask, useDeleteCrewTask } from "./use-tasks";
import { crewKeys } from "./shared";
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "alice" } }) }));
vi.mock("./api", () => ({
  crewApi: {
    post: vi.fn().mockResolvedValue({ id: "task-a" }),
    patch: vi.fn().mockResolvedValue({ id: "task-a" }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it.each(["create", "update", "delete"])(
  "invalidates every task-center filter after %s",
  async (action) => {
    const client = new QueryClient();
    const keys = [
      [...crewKeys.taskCenter, "alice", "all", "active", ""],
      [...crewKeys.taskCenter, "alice", "mine", "all", "review"],
    ];
    for (const key of keys) client.setQueryData(key, { pages: [] });
    client.setQueryData(["unrelated"], "keep");
    let run!: () => Promise<unknown>;
    function Harness() {
      const create = useCreateCrewTask("crew-a");
      const update = useUpdateCrewTask("crew-a");
      const remove = useDeleteCrewTask("crew-a");
      run = () =>
        action === "create"
          ? create.mutateAsync({ title: "Task" } as never)
          : action === "update"
            ? update.mutateAsync({ taskId: "task-a", input: { title: "Edited" } } as never)
            : remove.mutateAsync({ taskId: "task-a", expectedVersion: 1 });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Harness />
          </QueryClientProvider>
        )
      );
      await act(async () => {
        await run();
      });
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
    } finally {
      act(() => root.unmount());
      client.clear();
    }
  }
);
