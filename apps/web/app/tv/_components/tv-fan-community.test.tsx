// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { TvFanCommunity } from "./tv-fan-community";
import { api } from "@/src/lib/api";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
const state = vi.hoisted(() => ({ id: "viewer" as string | null, push: vi.fn(), open: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.id ? { id: state.id } : null, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.open }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { post: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  state.id = "viewer";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  root = createRoot(container);
  vi.mocked(api.get).mockResolvedValue({ crew: { id: "crew", name: "Crew" } });
  vi.mocked(crewApi.post).mockResolvedValue({ conversationId: "fans" });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  vi.resetAllMocks();
});
async function render(ipId = "ip") {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TvFanCommunity ipId={ipId} />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
function click() {
  container.querySelector("button")!.click();
}
it("joins only the linked community, refreshes My Crews and opens the community workspace", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await render();
  await act(async () => click());
  expect(crewApi.post).toHaveBeenCalledWith(
    "/crews/crew/fan-community",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(invalidate).toHaveBeenCalled();
  expect(state.push).toHaveBeenCalledWith(
    "/en-US/crews?view=mine&crew=crew&tab=chat&channel=community"
  );
});
it("hides unlinked IPs and requires sign-in for linked IPs", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ crew: null });
  await render("unlinked");
  expect(container.querySelector("button")).toBeNull();
  state.id = null;
  await render("linked");
  act(click);
  expect(state.open).toHaveBeenCalledOnce();
  expect(crewApi.post).not.toHaveBeenCalled();
});
it.each(["account", "ip"])(
  "cancels duplicate and abandoned joins on %s replacement",
  async (kind) => {
    let finish!: () => void;
    vi.mocked(crewApi.post).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        })
    );
    await render();
    act(() => {
      click();
      click();
    });
    expect(crewApi.post).toHaveBeenCalledOnce();
    const signal = vi.mocked(crewApi.post).mock.calls[0]![1]!.signal!;
    if (kind === "account") state.id = "replacement";
    await render(kind === "ip" ? "replacement" : "ip");
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    expect(state.push).not.toHaveBeenCalled();
  }
);
it("retains join errors and allows a successful retry", async () => {
  await render();
  vi.mocked(crewApi.post).mockRejectedValueOnce(new Error("Crew unavailable"));
  await act(async () => click());
  expect(container.textContent).toContain("Crew unavailable");
  expect(state.push).not.toHaveBeenCalled();
  await act(async () => click());
  expect(state.push).toHaveBeenCalledOnce();
});
it("does not join a cached Crew when its current IP association cannot be verified", async () => {
  client.setQueryData(["tv", "crew-origin", "ip", "viewer"], {
    crew: { id: "former", name: "Former Crew" },
  });
  vi.mocked(api.get).mockRejectedValue(new Error("Association unavailable"));
  await render();
  await act(async () => click());
  expect(crewApi.post).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Association unavailable");
});
