// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useProjectComputeLedger } from "./use-billing";
import { getComputeWalletLedger } from "../_lib/billing-api";
const state = vi.hoisted(() => ({ id: "a" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.id } }) }));
vi.mock("../_lib/billing-api", () => ({ getComputeWalletLedger: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("cancels abandoned scopes and uses the originating workspace, project and cursor", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  let signal!: AbortSignal;
  let finish!: (value: Awaited<ReturnType<typeof getComputeWalletLedger>>) => void;
  vi.mocked(getComputeWalletLedger)
    .mockImplementationOnce((_limit, options) => {
      signal = options!.signal!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue({ accounts: [], entries: [], nextCursor: "older" });
  let latest!: ReturnType<typeof useProjectComputeLedger>;
  function Probe({ workspace = "first", project = "project-a" }) {
    latest = useProjectComputeLedger(workspace, project);
    return <p>{latest.data?.pages.length ?? 0}</p>;
  }
  const render = async (workspace?: string, project?: string) =>
    act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe workspace={workspace} project={project} />
        </QueryClientProvider>
      );
    });
  try {
    await render();
    state.id = "b";
    await render("second", "project-b");
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ accounts: [], entries: [{ id: "abandoned" }] as never, nextCursor: null });
    });
    await act(async () => {
      await latest.refetch();
    });
    expect(latest.data?.pages.flatMap((p) => p.entries)).toEqual([]);
    await act(async () => {
      await latest.fetchNextPage();
    });
    expect(getComputeWalletLedger).toHaveBeenLastCalledWith(
      50,
      expect.objectContaining({ workspaceId: "second", projectId: "project-b", cursor: "older" })
    );
    vi.mocked(getComputeWalletLedger).mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await latest.fetchNextPage();
    });
    expect(latest.data?.pages.length).toBe(2);
  } finally {
    act(() => root.unmount());
    client.clear();
    state.id = "a";
  }
});
