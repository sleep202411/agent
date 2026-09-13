import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { useCrewConversation } from "./use-crew-conversation";
import { useCrewCommunityConversation } from "./use-crew-community-conversation";
const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("@/app/(site)/crews/_hooks/api", async (original) => ({
  ...(await original<typeof import("@/app/(site)/crews/_hooks/api")>()),
  crewApi: { get: vi.fn() },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it.each([
  ["team", useCrewConversation],
  ["community", useCrewCommunityConversation],
] as const)("isolates %s chat lookup across logout and account switches", async (_kind, hook) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  const root = createRoot(host);
  let current!: ReturnType<typeof hook>;
  function Probe() {
    current = hook("crew");
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
    vi.mocked(crewApi.get).mockResolvedValue({ id: "alice-private" });
    render();
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(current.data?.id).toBe("alice-private");
    });
    session.id = null;
    render();
    expect(current.data).toBeUndefined();
    expect(crewApi.get).toHaveBeenCalledTimes(1);
    let resolve!: (value: unknown) => void;
    vi.mocked(crewApi.get).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    session.id = "bob";
    render();
    expect(current.data).toBeUndefined();
    await act(async () => resolve({ id: "bob-private" }));
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(current.data?.id).toBe("bob-private");
    });
  } finally {
    act(() => root.unmount());
    client.clear();
    session.id = "alice";
    vi.resetAllMocks();
  }
});
