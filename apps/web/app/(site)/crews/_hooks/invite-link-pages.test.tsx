import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCrewInviteLinkPages } from "./use-invite-links";
const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("./api", () => ({ crewApi: { get: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it.each([false, true])("reads scoped links and isolates accounts (legacy=%s)", async (legacy) => {
  const get = vi.mocked(crewApi.get);
  get.mockReset();
  get.mockResolvedValueOnce(
    legacy ? [{ id: "first" }] : { items: [{ id: "first" }], nextCursor: "cursor" }
  );
  get.mockResolvedValue({ items: [{ id: "second" }], nextCursor: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.createElement("div"));
  let taskId: string | undefined = "task";
  let result: ReturnType<typeof useCrewInviteLinkPages>;
  function Probe() {
    result = useCrewInviteLinkPages("crew", true, taskId);
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  try {
    render();
    await settle();
    expect(result!.data?.map((item) => item.id)).toEqual(["first"]);
    expect(get.mock.calls[0][0]).toContain("taskId=task");
    expect(result!.hasNextPage).toBe(!legacy);
    if (!legacy) {
      await act(async () => {
        await result!.fetchNextPage();
      });
      await settle();
      expect(result!.data?.map((item) => item.id)).toEqual(["first", "second"]);
      expect(get.mock.calls[1][0]).toContain("cursor=cursor");
      expect(result!.hasNextPage).toBe(false);
    }
    taskId = undefined;
    render();
    await settle();
    expect(get.mock.calls.at(-1)![0]).toContain("scope=general");
    session.id = null;
    render();
    expect(result!.data).toBeUndefined();
    get.mockImplementation(() => new Promise(() => {}));
    session.id = "bob";
    render();
    expect(result!.data).toBeUndefined();
  } finally {
    act(() => root.unmount());
    client.clear();
    session.id = "alice";
  }
});
